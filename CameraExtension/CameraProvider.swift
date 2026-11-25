import CoreMedia
import CoreMediaIO
import Foundation
import MirrorCore

final class CameraProvider: NSObject, CMIOExtensionProviderSource {
    private let camera: VirtualCamera
    private(set) lazy var provider = CMIOExtensionProvider(source: self, clientQueue: nil)

    init(camera: VirtualCamera) {
        self.camera = camera
        super.init()
    }

    func registerCamera() throws {
        try camera.registerStreams()
        try provider.addDevice(camera.device)
    }

    var availableProperties: Set<CMIOExtensionProperty> { [.providerManufacturer] }

    func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {
        let result = CMIOExtensionProviderProperties(dictionary: [:])
        if properties.contains(.providerManufacturer) { result.manufacturer = "Mirro" }
        return result
    }

    func setProviderProperties(_ providerProperties: CMIOExtensionProviderProperties) throws {}
    func connect(to client: CMIOExtensionClient) throws {}
    func disconnect(from client: CMIOExtensionClient) { camera.relay.disconnect(client) }
}

final class VirtualCamera: NSObject, CMIOExtensionDeviceSource {
    let relay: FrameRelay
    private let source: CameraStream
    private let sink: CameraStream

    // VERIFY-ON-MAC: confirm CoreMediaIO and AVFoundation expose the UUID used for discovery.
    private(set) lazy var device = CMIOExtensionDevice(
        localizedName: CameraFormat.name, deviceID: CameraFormat.deviceID, legacyDeviceID: nil, source: self
    )

    init(format: CMIOExtensionStreamFormat) {
        let relay = FrameRelay()
        self.relay = relay
        source = CameraStream(direction: .source, format: format, relay: relay)
        sink = CameraStream(direction: .sink, format: format, relay: relay)
        super.init()
    }

    func registerStreams() throws {
        // Source is listed first so readers see it as the primary video stream.
        relay.bind(source: source.stream, sink: sink.stream)
        try device.addStream(source.stream)
        try device.addStream(sink.stream)
    }

    var availableProperties: Set<CMIOExtensionProperty> { [.deviceModel, .deviceTransportType] }

    func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {
        let result = CMIOExtensionDeviceProperties(dictionary: [:])
        if properties.contains(.deviceModel) { result.model = "Mirro Virtual Camera" }
        if properties.contains(.deviceTransportType) { result.transportType = 0x7669_7274 } // 'virt'
        return result
    }

    func setDeviceProperties(_ deviceProperties: CMIOExtensionDeviceProperties) throws {}
}

final class CameraStream: NSObject, CMIOExtensionStreamSource {
    private let direction: CMIOExtensionStream.Direction
    private let relay: FrameRelay
    let formats: [CMIOExtensionStreamFormat]
    let activeFormatIndex = 0

    private(set) lazy var stream = CMIOExtensionStream(
        localizedName: direction == .source ? "Mirro Video" : "Mirro Input",
        streamID: direction == .source ? CameraFormat.sourceID : CameraFormat.sinkID,
        direction: direction, clockType: .hostTime, source: self
    )

    init(direction: CMIOExtensionStream.Direction, format: CMIOExtensionStreamFormat, relay: FrameRelay) {
        self.direction = direction
        self.relay = relay
        self.formats = [format]
        super.init()
    }

    var availableProperties: Set<CMIOExtensionProperty> {
        var properties: Set<CMIOExtensionProperty> = [.streamActiveFormatIndex, .streamFrameDuration]
        if direction == .sink {
            properties.formUnion([.streamSinkBufferQueueSize, .streamSinkBuffersRequiredForStartup])
        }
        return properties
    }

    // VERIFY-ON-MAC: compile-check the fixed-format and sink queue properties against the macOS SDK.
    func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let result = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) { result.activeFormatIndex = activeFormatIndex }
        if properties.contains(.streamFrameDuration) { result.frameDuration = CameraFormat.frameDuration }
        if direction == .sink {
            if properties.contains(.streamSinkBufferQueueSize) { result.sinkBufferQueueSize = 3 }
            if properties.contains(.streamSinkBuffersRequiredForStartup) { result.sinkBuffersRequiredForStartup = 1 }
        }
        return result
    }

    func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {
        if let index = streamProperties.activeFormatIndex, index != activeFormatIndex {
            throw StreamError.unsupportedFormat
        }
        if let duration = streamProperties.frameDuration,
           CMTimeCompare(duration, CameraFormat.frameDuration) != 0 {
            throw StreamError.unsupportedFormat
        }
    }

    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {
        direction == .source || relay.reserveSink(for: client)
    }

    func startStream() throws {
        if direction == .source {
            relay.startSource()
        } else {
            try relay.startSink()
        }
    }

    func stopStream() throws {
        if direction == .source {
            relay.stopSource()
        } else {
            relay.stopSink()
        }
    }
}

enum StreamError: LocalizedError {
    case unsupportedFormat
    case missingProducer

    var errorDescription: String? {
        switch self {
        case .unsupportedFormat: return "Mirro publishes a single 720p, 30 FPS format."
        case .missingProducer: return "No client was authorized to feed Mirro’s sink."
        }
    }
}
