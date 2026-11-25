import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import MirrorCore

final class CapturePipeline: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    enum Event {
        case started
        case failed(Error)
    }

    private let queue = DispatchQueue(label: "Mirro.capture", qos: .userInitiated)
    private let clock = CMClockGetHostTimeClock()
    private var runID: UUID?
    private var session: AVCaptureSession?
    private var output: AVCaptureVideoDataOutput?
    private var runtimeObserver: NSObjectProtocol?
    private var sink: CameraSink?
    private var renderer: FrameRenderer?
    private var descriptionForFrames: CMVideoFormatDescription?
    private var timing = FrameTiming()
    private var mirrored = true
    private var onEvent: ((Event) -> Void)?

    func start(id: UUID, device: AVCaptureDevice, mirrored: Bool, onEvent: @escaping (Event) -> Void) {
        queue.async {
            self.tearDown()
            self.runID = id
            self.mirrored = mirrored
            self.onEvent = onEvent
            self.openSink(id: id, device: device, retries: 48)
        }
    }

    func stop() {
        queue.async { self.tearDown() }
    }

    func setMirroring(_ enabled: Bool) {
        queue.async { self.mirrored = enabled }
    }

    private func openSink(id: UUID, device: AVCaptureDevice, retries: Int) {
        guard runID == id else { return }
        do {
            sink = try CameraSink()
        } catch {
            guard retries > 0 else {
                fail(error)
                return
            }
            queue.asyncAfter(deadline: .now() + .milliseconds(250)) { [weak self] in
                self?.openSink(id: id, device: device, retries: retries - 1)
            }
            return
        }

        do {
            renderer = try FrameRenderer()
            descriptionForFrames = try CameraFormat.makeDescription()
            let session = try configureSession(device: device)
            self.session = session
            runtimeObserver = NotificationCenter.default.addObserver(
                forName: .AVCaptureSessionRuntimeError, object: session, queue: nil
            ) { [weak self] notification in
                let error = notification.userInfo?[AVCaptureSessionErrorKey] as? NSError
                self?.queue.async { [weak self] in
                    guard let self = self, self.runID == id else { return }
                    self.fail(error ?? CaptureError.sessionDidNotStart)
                }
            }
            session.startRunning()
            guard session.isRunning else { throw CaptureError.sessionDidNotStart }
            onEvent?(.started)
        } catch {
            fail(error)
        }
    }

    private func configureSession(device: AVCaptureDevice) throws -> AVCaptureSession {
        let session = AVCaptureSession()
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: CameraFormat.pixelFormat]
        output.alwaysDiscardsLateVideoFrames = true

        session.beginConfiguration()
        guard session.canAddInput(input) else {
            session.commitConfiguration()
            throw CaptureError.inputUnavailable
        }
        session.addInput(input)
        if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            throw CaptureError.outputUnavailable
        }
        session.addOutput(output)
        session.commitConfiguration()

        // VERIFY-ON-MAC: check the negotiated rate and connection orientation on real cameras.
        let rate = Double(CameraFormat.framesPerSecond)
        if device.activeFormat.videoSupportedFrameRateRanges.contains(where: {
            $0.minFrameRate <= rate && rate <= $0.maxFrameRate
        }) {
            try device.lockForConfiguration()
            device.activeVideoMinFrameDuration = CameraFormat.frameDuration
            device.activeVideoMaxFrameDuration = CameraFormat.frameDuration
            device.unlockForConfiguration()
        }
        if let connection = output.connection(with: .video), connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = false
        }
        output.setSampleBufferDelegate(self, queue: queue)
        self.output = output
        return session
    }

    func captureOutput(
        _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection
    ) {
        guard output === self.output, let sink = sink, sink.canEnqueue,
              let renderer = renderer, let description = descriptionForFrames,
              let image = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let timestamp = CMClockGetTime(clock)
        guard timing.accept(timestamp) else { return }
        do {
            guard let frame = try renderer.render(image, mirrored: mirrored) else { return }
            let sample = try FrameRenderer.makeSampleBuffer(image: frame, description: description,
                                                            timestamp: timestamp)
            try sink.enqueue(sample)
        } catch {
            // Let AVFoundation finish the current delegate callback before stopping the session.
            guard let id = runID else { return }
            queue.async {
                guard self.runID == id else { return }
                self.fail(error)
            }
        }
    }

    private func fail(_ error: Error) {
        let callback = onEvent
        tearDown()
        callback?(.failed(error))
    }

    private func tearDown() {
        runID = nil
        onEvent = nil
        if let observer = runtimeObserver { NotificationCenter.default.removeObserver(observer) }
        runtimeObserver = nil
        output?.setSampleBufferDelegate(nil, queue: nil)
        session?.stopRunning()
        session = nil
        output = nil
        sink?.stop()
        sink = nil
        renderer = nil
        descriptionForFrames = nil
        timing = FrameTiming()
    }
}

private enum CaptureError: LocalizedError {
    case inputUnavailable
    case outputUnavailable
    case sessionDidNotStart

    var errorDescription: String? {
        switch self {
        case .inputUnavailable: return "AVFoundation could not open the selected camera."
        case .outputUnavailable: return "AVFoundation could not create a video output."
        case .sessionDidNotStart: return "The camera capture session did not start."
        }
    }
}
