import Foundation
import ServiceManagement

struct LoginPreference {
    let defaults: UserDefaults
    let helperIdentifier: String?
    private let legacyKey = "legacyLoginItemEnabled"

    var enabled: Bool {
        if defaults.bool(forKey: legacyKey) { return true }
        if #available(macOS 13.0, *) {
            let status = SMAppService.mainApp.status
            return status == .enabled || status == .requiresApproval
        }
        return false
    }

    var requiresApproval: Bool {
        if #available(macOS 13.0, *), !defaults.bool(forKey: legacyKey) {
            return SMAppService.mainApp.status == .requiresApproval
        }
        return false
    }

    func setEnabled(_ enabled: Bool) throws {
        if #available(macOS 13.0, *), !defaults.bool(forKey: legacyKey) {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            return
        }

        // VERIFY-ON-MAC: exercise the embedded helper and legacy registration on macOS 12.
        guard let identifier = helperIdentifier, SMLoginItemSetEnabled(identifier as CFString, enabled) else {
            throw LoginError.registrationFailed
        }
        defaults.set(enabled, forKey: legacyKey)
    }
}

private enum LoginError: LocalizedError {
    case registrationFailed

    var errorDescription: String? { "Could not update the Mirro login item." }
}
