// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MenuBarDockKit",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "MenuBarDockKit",
            targets: ["MenuBarDockKit"]
        )
    ],
    targets: [
        .target(
            name: "MenuBarDockKit"
        ),
        .testTarget(
            name: "MenuBarDockKitTests",
            dependencies: ["MenuBarDockKit"]
        )
    ]
)

