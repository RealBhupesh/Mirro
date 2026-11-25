// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "MirrorCore",
    platforms: [.macOS("12.3")],
    products: [.library(name: "MirrorCore", targets: ["MirrorCore"])],
    targets: [
        .target(name: "MirrorCore"),
        .testTarget(name: "MirrorCoreTests", dependencies: ["MirrorCore"])
    ]
)
