import CoreMedia
import CoreMediaIO
import Foundation
import MirrorCore

final class CameraSink {
    private let deviceID: CMIODeviceID
    private let streamID: CMIOStreamID
    private let queue: CMSimpleQueue
    private var running = true

    init() throws {
        // VERIFY-ON-MAC: confirm the camera's public UID, output scope, and queue API.
        let devices = try Self.objectIDs(on: CMIOObjectID(kCMIOObjectSystemObject),
                                         selector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices))
        guard let device = devices.first(where: {
            guard let uid = Self.deviceUID($0) else { return false }
            return CameraFormat.matchesDeviceUID(uid)
        }) else { throw SinkError.notPublished }

        let streams = try Self.objectIDs(on: device,
                                         selector: CMIOObjectPropertySelector(kCMIODevicePropertyStreams),
                                         scope: CMIOObjectPropertyScope(kCMIODevicePropertyScopeOutput))
        guard streams.count == 1, let stream = streams.first else { throw SinkError.missingSink }

        var bufferQueue: Unmanaged<CMSimpleQueue>?
        let copyStatus = CMIOStreamCopyBufferQueue(stream, { _, _, _ in }, nil, &bufferQueue)
        guard copyStatus == noErr, let queue = bufferQueue?.takeRetainedValue() else {
            throw SinkError.operation("open the camera sink queue", copyStatus)
        }
        let startStatus = CMIODeviceStartStream(device, stream)
        guard startStatus == noErr else {
            throw SinkError.operation("start the camera sink", startStatus)
        }

        self.deviceID = device
        self.streamID = stream
        self.queue = queue
    }

    var canEnqueue: Bool {
        running && CMSimpleQueueGetCount(queue) < CMSimpleQueueGetCapacity(queue)
    }

    func enqueue(_ sample: CMSampleBuffer) throws {
        guard canEnqueue else { return }
        // VERIFY-ON-MAC: CMIO must take the queued retain for samples it consumes or
        // discards while stopping. CMSimpleQueue itself does not own its elements.
        let retained = Unmanaged.passRetained(sample)
        let status = CMSimpleQueueEnqueue(queue, element: retained.toOpaque())
        if status != noErr {
            retained.release()
            throw SinkError.operation("queue a video frame", status)
        }
    }

    func stop() {
        guard running else { return }
        running = false
        CMIODeviceStopStream(deviceID, streamID)
    }

    deinit {
        stop()
    }

    private static func objectIDs(
        on object: CMIOObjectID, selector: CMIOObjectPropertySelector,
        scope: CMIOObjectPropertyScope = CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal)
    ) throws -> [CMIOObjectID] {
        var address = CMIOObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: 0)
        var byteCount: UInt32 = 0
        let sizeStatus = CMIOObjectGetPropertyDataSize(object, &address, 0, nil, &byteCount)
        guard sizeStatus == noErr else { throw SinkError.operation("read the camera list size", sizeStatus) }
        guard byteCount > 0 else { return [] }
        let stride = MemoryLayout<CMIOObjectID>.stride
        guard Int(byteCount).isMultiple(of: stride) else { throw SinkError.invalidObjectList }
        var ids = [CMIOObjectID](repeating: 0, count: Int(byteCount) / stride)
        var used: UInt32 = 0
        let status = ids.withUnsafeMutableBytes {
            CMIOObjectGetPropertyData(object, &address, 0, nil, byteCount, &used, $0.baseAddress!)
        }
        guard status == noErr else { throw SinkError.operation("read the camera list", status) }
        guard used <= byteCount, Int(used).isMultiple(of: stride) else { throw SinkError.invalidObjectList }
        return Array(ids.prefix(Int(used) / stride))
    }

    private static func deviceUID(_ object: CMIOObjectID) -> String? {
        var address = CMIOObjectPropertyAddress(
            mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceUID),
            mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: 0
        )
        var uid: Unmanaged<CFString>?
        let size = UInt32(MemoryLayout.size(ofValue: uid))
        var used: UInt32 = 0
        let status = CMIOObjectGetPropertyData(object, &address, 0, nil, size, &used, &uid)
        guard status == noErr, used == size, let uid = uid else { return nil }
        return uid.takeRetainedValue() as String
    }
}

enum SinkError: LocalizedError {
    case notPublished
    case missingSink
    case invalidObjectList
    case operation(String, OSStatus)

    var errorDescription: String? {
        switch self {
        case .notPublished: return "The Mirro camera isn’t visible to CoreMediaIO yet."
        case .missingSink: return "The Mirro camera doesn’t expose its input stream."
        case .invalidObjectList: return "CoreMediaIO returned an invalid device or stream list."
        case .operation(let operation, let status): return "Could not \(operation) (\(status))."
        }
    }
}
