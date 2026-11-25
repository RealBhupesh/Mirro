import Foundation

public struct MirrorSettings: Equatable {
    private static let cameraKey = "selectedCameraID"
    private static let mirrorKey = "mirrorHorizontally"

    public var selectedCameraID: String?
    public var mirrorHorizontally: Bool

    public init(selectedCameraID: String? = nil, mirrorHorizontally: Bool = true) {
        self.selectedCameraID = selectedCameraID
        self.mirrorHorizontally = mirrorHorizontally
    }

    public init(defaults: UserDefaults) {
        selectedCameraID = defaults.string(forKey: Self.cameraKey)
        mirrorHorizontally = defaults.object(forKey: Self.mirrorKey) as? Bool ?? true
    }

    public func save(to defaults: UserDefaults) {
        defaults.set(selectedCameraID, forKey: Self.cameraKey)
        defaults.set(mirrorHorizontally, forKey: Self.mirrorKey)
    }
}
