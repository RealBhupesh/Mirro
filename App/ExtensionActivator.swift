import Foundation
import SystemExtensions

final class ExtensionActivator: NSObject, OSSystemExtensionRequestDelegate {
    enum Event {
        case needsApproval
        case ready
        case failed(String)
    }

    private var request: OSSystemExtensionRequest?
    private var needsApproval = false
    private var observer: ((Event) -> Void)?

    func activate(identifier: String, onEvent: @escaping (Event) -> Void) {
        observer = onEvent
        if request != nil {
            if needsApproval { onEvent(.needsApproval) }
            return
        }
        let request = OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: identifier,
                                                                 queue: .main)
        self.request = request
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func detach() {
        observer = nil
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        needsApproval = true
        observer?(.needsApproval)
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        switch result {
        case .completed: finish(.ready)
        case .willCompleteAfterReboot: finish(.failed("Restart your Mac to finish enabling the camera extension."))
        @unknown default: finish(.failed("The camera extension returned an unknown activation result."))
        }
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        finish(.failed(error.localizedDescription))
    }

    func request(
        _ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties,
        withExtension replacement: OSSystemExtensionProperties
    ) -> OSSystemExtensionRequest.ReplacementAction {
        .replace
    }

    private func finish(_ event: Event) {
        let callback = observer
        observer = nil
        request = nil
        needsApproval = false
        callback?(event)
    }
}
