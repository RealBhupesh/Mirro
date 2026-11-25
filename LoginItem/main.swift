import AppKit

// Resolve Mirro.app from Contents/Library/LoginItems/MirroLoginItem.app.
let host = Bundle.main.bundleURL
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

let application = NSApplication.shared
DispatchQueue.main.async {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    NSWorkspace.shared.openApplication(at: host, configuration: configuration) { _, _ in
        DispatchQueue.main.async { application.terminate(nil) }
    }
}
application.run()
