import AppKit
import Combine
import SwiftUI

@main
struct MirroApp: App {
    @NSApplicationDelegateAdaptor(MenuBarDelegate.self) private var delegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

@MainActor
final class MenuBarDelegate: NSObject, NSApplicationDelegate {
    private let controller = MirroController()
    private let popover = NSPopover()
    private var item: NSStatusItem?
    private var statusObserver: AnyCancellable?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        self.item = item
        item.button?.target = self
        item.button?.action = #selector(togglePopover)
        item.button?.toolTip = "Mirro"
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: MirroMenu(controller: controller))
        statusObserver = controller.$phase.sink { [weak self] phase in
            self?.item?.button?.image = NSImage(systemSymbolName: phase == .active ? "video.fill" : "video",
                                                accessibilityDescription: "Mirro")
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller.stop()
    }

    @objc private func togglePopover() {
        guard let button = item?.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            controller.refreshCameras()
            controller.refreshLogin()
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
    }
}

@MainActor
private struct MirroMenu: View {
    @ObservedObject var controller: MirroController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Mirro").font(.headline)
                Spacer()
                Text(controller.phase.rawValue).foregroundColor(.secondary)
                    .accessibilityLabel("Virtual camera status: \(controller.phase.rawValue)")
            }

            if let note = controller.statusNote {
                Text(note).font(.caption).fixedSize(horizontal: false, vertical: true)
            }

            if controller.cameras.isEmpty {
                Text("No camera sources available").foregroundColor(.secondary)
            } else {
                Picker("Camera source", selection: Binding(
                    get: { controller.selectedCameraID }, set: controller.selectCamera
                )) {
                    ForEach(controller.cameras, id: \.uniqueID) { camera in
                        Text(camera.localizedName).tag(camera.uniqueID)
                    }
                }
            }

            Toggle("Mirror horizontally", isOn: Binding(
                get: { controller.mirrorHorizontally }, set: controller.setMirroring
            ))
            Toggle("Launch at login", isOn: Binding(
                get: { controller.launchAtLogin }, set: controller.setLaunchAtLogin
            ))
            if let note = controller.loginNote {
                Text(note).font(.caption).fixedSize(horizontal: false, vertical: true)
            }

            Divider()
            HStack {
                if controller.phase == .stopped {
                    Button("Start virtual camera", action: controller.start)
                        .disabled(controller.cameras.isEmpty)
                } else {
                    Button("Stop virtual camera", action: controller.stop)
                }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }
        }
        .padding(14)
        .frame(width: 310)
        .fixedSize(horizontal: false, vertical: true)
    }
}
