import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import XCTest
@testable import MirrorCore

final class MirrorCoreTests: XCTestCase {
    func testSettingsDefaultAndRoundTrip() throws {
        let suite = "MirroTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertEqual(MirrorSettings(defaults: defaults), MirrorSettings())
        let custom = MirrorSettings(selectedCameraID: "usb-camera", mirrorHorizontally: false)
        custom.save(to: defaults)
        XCTAssertEqual(MirrorSettings(defaults: defaults), custom)
        MirrorSettings().save(to: defaults)
        XCTAssertEqual(MirrorSettings(defaults: defaults), MirrorSettings())
    }

    func testHorizontalTransformAlsoCenterCrops() {
        let input = CGRect(x: 10, y: 20, width: 640, height: 480)
        let output = CGRect(x: 0, y: 0, width: 1280, height: 720)
        let point = CGPoint(x: 110, y: 160)
        for mirrored in [false, true] {
            let transform = FrameRenderer.transform(from: input, into: output, mirrored: mirrored)
            XCTAssertEqual(point.applying(transform), CGPoint(x: mirrored ? 1080 : 200, y: 160))
        }
    }

    func testRenderingFlipsPixelsOnlyWhenEnabled() throws {
        var buffer: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, 1280, 720, CameraFormat.pixelFormat,
                                            nil, &buffer), kCVReturnSuccess)
        let input = try XCTUnwrap(buffer)
        try withPixels(input) { base, stride in
            for y in 0..<720 {
                for x in 0..<1280 {
                    let offset = stride * y + 4 * x
                    base[offset] = x < 640 ? 0 : 255     // Blue
                    base[offset + 1] = 0
                    base[offset + 2] = x < 640 ? 255 : 0 // Red
                    base[offset + 3] = 255
                }
            }
        }
        let renderer = try FrameRenderer()
        for mirrored in [false, true] {
            let output = try XCTUnwrap(renderer.render(input, mirrored: mirrored))
            try withPixels(output) { base, stride in
                let left = stride * 360 + 4 * 100
                let right = stride * 360 + 4 * 1180
                XCTAssertGreaterThan(base[left + (mirrored ? 0 : 2)], 200)
                XCTAssertLessThan(base[left + (mirrored ? 2 : 0)], 30)
                XCTAssertGreaterThan(base[right + (mirrored ? 2 : 0)], 200)
                XCTAssertLessThan(base[right + (mirrored ? 0 : 2)], 30)
            }
        }
    }

    func testFrameTimingThrottlesAndRecoversAfterGap() {
        var timing = FrameTiming()
        XCTAssertFalse(timing.accept(.invalid))
        XCTAssertTrue(timing.accept(.zero))
        XCTAssertFalse(timing.accept(CMTime(value: 1, timescale: 60)))
        XCTAssertTrue(timing.accept(CMTime(value: 1, timescale: 30)))
        XCTAssertTrue(timing.accept(CMTime(value: 2, timescale: 1)))
        XCTAssertFalse(timing.accept(CMTime(value: 121, timescale: 60)))
        XCTAssertTrue(timing.accept(CMTime(value: 61, timescale: 30)))
    }

    func testHostTimeConversion() {
        XCTAssertEqual(CameraFormat.hostNanoseconds(for: CMTime(value: 1, timescale: 4)), 250_000_000)
        XCTAssertNil(CameraFormat.hostNanoseconds(for: CMTime(value: -1, timescale: 1)))
        XCTAssertNil(CameraFormat.hostNanoseconds(for: .indefinite))
    }

    private func withPixels(_ buffer: CVPixelBuffer, _ body: (UnsafeMutablePointer<UInt8>, Int) -> Void) throws {
        let status = CVPixelBufferLockBaseAddress(buffer, [])
        XCTAssertEqual(status, kCVReturnSuccess)
        guard status == kCVReturnSuccess else { return }
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        let address = try XCTUnwrap(CVPixelBufferGetBaseAddress(buffer))
        body(address.assumingMemoryBound(to: UInt8.self), CVPixelBufferGetBytesPerRow(buffer))
    }
}
