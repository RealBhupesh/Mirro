import AVFoundation
import Combine
import Foundation
import MirrorCore

@MainActor
final class MirroController: ObservableObject {
    enum Phase: String {
        case stopped = "Stopped"
        case starting = "Starting"
        case active = "Active"
    }

    @Published private(set) var phase = Phase.stopped
    @Published private(set) var statusNote: String?
    @Published private(set) var cameras: [AVCaptureDevice] = []
    @Published private(set) var selectedCameraID = ""
    @Published private(set) var mirrorHorizontally = true
    @Published private(set) var launchAtLogin = false
    @Published private(set) var loginNote: String?

    private let defaults: UserDefaults
    private let extensionIdentifier: String?
    private let loginPreference: LoginPreference
    private var settings: MirrorSettings
    private let activator = ExtensionActivator()
    private let pipeline = CapturePipeline()
    private var runID: UUID?
    private var runningCameraID: String?
    private var observers: Set<AnyCancellable> = []

    init(defaults: UserDefaults = .standard, bundle: Bundle = .main) {
        self.defaults = defaults
        settings = MirrorSettings(defaults: defaults)
        mirrorHorizontally = settings.mirrorHorizontally
        extensionIdentifier = bundle.object(forInfoDictionaryKey: "MirroCameraExtensionIdentifier") as? String
        loginPreference = LoginPreference(defaults: defaults,
            helperIdentifier: bundle.object(forInfoDictionaryKey: "MirroLoginItemIdentifier") as? String)

        let changes: [Notification.Name] = [.AVCaptureDeviceWasConnected, .AVCaptureDeviceWasDisconnected]
        for name in changes {
            NotificationCenter.default.publisher(for: name).sink { [weak self] _ in
                Task { @MainActor in self?.refreshCameras() }
            }.store(in: &observers)
        }
        refreshCameras()
        refreshLogin()
    }

    func refreshCameras() {
        let deviceTypes: [AVCaptureDevice.DeviceType]
        if #available(macOS 14.0, *) {
            deviceTypes = [.builtInWideAngleCamera, .external]
        } else {
            deviceTypes = [.builtInWideAngleCamera, .externalUnknown]
        }
        // VERIFY-ON-MAC: confirm how AVCaptureDevice identifies physical and virtual devices.
        let virtualTransport = 0x7669_7274 // 'virt'
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: deviceTypes, mediaType: .video, position: .unspecified
        ).devices.filter {
            Int($0.transportType) != virtualTransport && !CameraFormat.matchesDeviceUID($0.uniqueID)
        }

        cameras = devices
        let preferred = devices.first { $0.uniqueID == settings.selectedCameraID }
        let builtIn = devices.first { $0.deviceType == .builtInWideAngleCamera }
        selectedCameraID = (preferred ?? builtIn ?? devices.first)?.uniqueID ?? ""

        if let runningCameraID = runningCameraID {
            if !devices.contains(where: { $0.uniqueID == runningCameraID }) {
                stop()
                statusNote = "The selected camera was disconnected."
            } else {
                selectedCameraID = runningCameraID
            }
        }
    }

    func selectCamera(_ id: String) {
        guard selectedCameraID != id, cameras.contains(where: { $0.uniqueID == id }) else { return }
        let restart = phase != .stopped
        settings.selectedCameraID = id
        settings.save(to: defaults)
        selectedCameraID = id
        if restart {
            stop()
            start()
        }
    }

    func setMirroring(_ enabled: Bool) {
        mirrorHorizontally = enabled
        settings.mirrorHorizontally = enabled
        settings.save(to: defaults)
        pipeline.setMirroring(enabled)
    }

    func refreshLogin() {
        launchAtLogin = loginPreference.enabled
        loginNote = loginPreference.requiresApproval ? "Allow Mirro in System Settings > General > Login Items." : nil
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            try loginPreference.setEnabled(enabled)
            refreshLogin()
        } catch {
            refreshLogin()
            loginNote = error.localizedDescription
        }
    }

    func start() {
        guard phase == .stopped else { return }
        refreshCameras()
        guard let device = cameras.first(where: { $0.uniqueID == selectedCameraID }) else {
            statusNote = "Connect a camera and try again."
            return
        }
        guard let extensionIdentifier = extensionIdentifier, !extensionIdentifier.isEmpty else {
            statusNote = "The Mirro camera extension identifier is missing."
            return
        }

        let id = UUID()
        runID = id
        runningCameraID = device.uniqueID
        phase = .starting
        statusNote = "Checking camera access…"

        Task { [weak self] in
            let authorized: Bool
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: authorized = true
            case .notDetermined: authorized = await AVCaptureDevice.requestAccess(for: .video)
            default: authorized = false
            }
            guard let self = self, self.runID == id else { return }
            guard authorized else {
                self.fail("Allow Mirro in System Settings > Privacy & Security > Camera.")
                return
            }
            self.statusNote = "Enabling the camera extension…"
            self.activator.activate(identifier: extensionIdentifier) { [weak self] event in
                Task { @MainActor in self?.handleActivation(event, id: id, device: device) }
            }
        }
    }

    func stop() {
        runID = nil
        runningCameraID = nil
        activator.detach()
        pipeline.stop()
        phase = .stopped
        statusNote = nil
    }

    private func handleActivation(_ event: ExtensionActivator.Event, id: UUID, device: AVCaptureDevice) {
        guard runID == id else { return }
        switch event {
        case .needsApproval:
            statusNote = "Approve the camera extension in System Settings > Privacy & Security."
        case .ready:
            statusNote = "Opening the virtual camera and video source…"
            pipeline.start(id: id, device: device, mirrored: mirrorHorizontally) { [weak self] event in
                DispatchQueue.main.async { self?.handleCapture(event, id: id) }
            }
        case .failed(let message):
            fail(message)
        }
    }

    private func handleCapture(_ event: CapturePipeline.Event, id: UUID) {
        guard runID == id else { return }
        switch event {
        case .started:
            phase = .active
            statusNote = nil
        case .failed(let error):
            fail(error.localizedDescription)
        }
    }

    private func fail(_ message: String) {
        stop()
        statusNote = message
    }
}
