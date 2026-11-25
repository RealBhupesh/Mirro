import CoreFoundation
import CoreMediaIO
import Darwin
import Foundation
import MirrorCore
import os

let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "MirroCamera", category: "service")
do {
    let description = try CameraFormat.makeDescription()
    let format = CMIOExtensionStreamFormat(
        formatDescription: description,
        maxFrameDuration: CameraFormat.frameDuration,
        minFrameDuration: CameraFormat.frameDuration,
        validFrameDurations: nil
    )
    let service = CameraProvider(camera: VirtualCamera(format: format))
    try service.registerCamera()
    CMIOExtensionProvider.startService(provider: service.provider)
    withExtendedLifetime(service) { CFRunLoopRun() }
} catch {
    logger.fault("Camera extension startup failed: \(error.localizedDescription, privacy: .public)")
    exit(EXIT_FAILURE)
}
