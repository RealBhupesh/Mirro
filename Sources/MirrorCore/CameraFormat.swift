import CoreMedia
import CoreVideo
import Foundation

public enum CameraFormat {
    public static let name = "Mirro"
    public static let deviceID = UUID(uuidString: "3FECD1DB-5172-407D-B63C-37C7DB2DD48D")!
    public static let sourceID = UUID(uuidString: "11C38CF7-40D5-4305-9A8D-E08937389E12")!
    public static let sinkID = UUID(uuidString: "AF8A2DDE-F8F7-4F96-93B5-81BE7FED9E39")!

    public static let width = 1280
    public static let height = 720
    public static let pixelFormat = kCVPixelFormatType_32BGRA
    public static let framesPerSecond: Int32 = 30
    public static let frameDuration = CMTime(value: 1, timescale: framesPerSecond)
    public static let hostTimescale: CMTimeScale = 1_000_000_000

    public static func matchesDeviceUID(_ uid: String) -> Bool {
        UUID(uuidString: uid) == deviceID
    }

    public static func makeDescription() throws -> CMVideoFormatDescription {
        var description: CMVideoFormatDescription?
        let status = CMVideoFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            codecType: pixelFormat,
            width: Int32(width),
            height: Int32(height),
            extensions: nil,
            formatDescriptionOut: &description
        )
        guard status == noErr, let description = description else {
            throw FrameError.formatDescription(status)
        }
        return description
    }

    public static func hostNanoseconds(for timestamp: CMTime) -> UInt64? {
        guard timestamp.isNumeric, timestamp.epoch == 0 else { return nil }
        let scaled = CMTimeConvertScale(timestamp, timescale: hostTimescale, method: .roundTowardZero)
        guard scaled.isNumeric, scaled.value >= 0 else { return nil }
        return UInt64(scaled.value)
    }
}

public enum FrameError: LocalizedError {
    case formatDescription(OSStatus)
    case pixelBufferPool(CVReturn)
    case pixelBuffer(CVReturn)
    case sampleBuffer(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .formatDescription(let status): return "Could not describe the video format (\(status))."
        case .pixelBufferPool(let status): return "Could not create the frame pool (\(status))."
        case .pixelBuffer(let status): return "Could not allocate a video frame (\(status))."
        case .sampleBuffer(let status): return "Could not prepare a video frame (\(status))."
        }
    }
}
