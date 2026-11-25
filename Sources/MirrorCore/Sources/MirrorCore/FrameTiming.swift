import CoreMedia

public struct FrameTiming {
    private var nextTimestamp: CMTime?
    // Allow early capture jitter without letting a faster source raise the output rate.
    private let tolerance = CMTime(value: 1, timescale: 240)

    public init() {}

    public mutating func accept(_ timestamp: CMTime) -> Bool {
        guard CameraFormat.hostNanoseconds(for: timestamp) != nil else { return false }
        guard let next = nextTimestamp else {
            nextTimestamp = CMTimeAdd(timestamp, CameraFormat.frameDuration)
            return true
        }
        let earliest = CMTimeSubtract(next, tolerance)
        guard CMTimeCompare(timestamp, earliest) >= 0 else { return false }
        let following = CMTimeAdd(next, CameraFormat.frameDuration)
        nextTimestamp = CMTimeCompare(timestamp, following) >= 0
            ? CMTimeAdd(timestamp, CameraFormat.frameDuration) : following
        return true
    }
}
