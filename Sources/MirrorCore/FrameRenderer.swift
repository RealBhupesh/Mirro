import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Foundation

public final class FrameRenderer {
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()
    private let pool: CVPixelBufferPool
    private let allocationOptions = [kCVPixelBufferPoolAllocationThresholdKey as String: 6]
    private let bounds = CGRect(x: 0, y: 0, width: CameraFormat.width, height: CameraFormat.height)

    public init() throws {
        let attributes: [String: Any] = [
            kCVPixelBufferWidthKey as String: CameraFormat.width,
            kCVPixelBufferHeightKey as String: CameraFormat.height,
            kCVPixelBufferPixelFormatTypeKey as String: CameraFormat.pixelFormat,
            kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
            kCVPixelBufferMetalCompatibilityKey as String: true
        ]
        var pool: CVPixelBufferPool?
        let status = CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attributes as CFDictionary, &pool)
        guard status == kCVReturnSuccess, let pool = pool else {
            throw FrameError.pixelBufferPool(status)
        }
        self.pool = pool
    }

    // When all surfaces are in flight, drop the incoming frame.
    public func render(_ input: CVPixelBuffer, mirrored: Bool) throws -> CVPixelBuffer? {
        var output: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(
            kCFAllocatorDefault, pool, allocationOptions as CFDictionary, &output
        )
        if status == kCVReturnWouldExceedAllocationThreshold { return nil }
        guard status == kCVReturnSuccess, let output = output else {
            throw FrameError.pixelBuffer(status)
        }

        let image = CIImage(cvPixelBuffer: input)
        let transform = Self.transform(from: image.extent, into: bounds, mirrored: mirrored)
        context.render(image.clampedToExtent().transformed(by: transform).cropped(to: bounds),
                       to: output, bounds: bounds, colorSpace: colorSpace)
        return output
    }

    static func transform(from input: CGRect, into output: CGRect, mirrored: Bool) -> CGAffineTransform {
        let scale = max(output.width / input.width, output.height / input.height)
        let xScale = mirrored ? -scale : scale
        return CGAffineTransform(a: xScale, b: 0, c: 0, d: scale,
                                 tx: output.midX - input.midX * xScale,
                                 ty: output.midY - input.midY * scale)
    }

    public static func makeSampleBuffer(
        image: CVPixelBuffer, description: CMVideoFormatDescription, timestamp: CMTime
    ) throws -> CMSampleBuffer {
        var timing = CMSampleTimingInfo(
            duration: CameraFormat.frameDuration,
            presentationTimeStamp: timestamp,
            decodeTimeStamp: .invalid
        )
        var sample: CMSampleBuffer?
        let status = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: image,
            formatDescription: description,
            sampleTiming: &timing,
            sampleBufferOut: &sample
        )
        guard status == noErr, let sample = sample else { throw FrameError.sampleBuffer(status) }
        return sample
    }
}
