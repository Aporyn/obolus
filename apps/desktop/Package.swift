// swift-tools-version: 5.9
import PackageDescription

// Obolus macOS menu bar app.
//
// Split into a testable, GUI-free `ObolusKit` (models, formatters, SSE client,
// summary store, serve-process manager) and the `Obolus` executable that holds the
// SwiftUI app, MenuBarExtra, and the native dashboard. This lets the data layer be
// unit-tested with `swift test` without needing a display.
let package = Package(
    name: "Obolus",
    platforms: [.macOS(.v13)],
    targets: [
        .target(
            name: "ObolusKit"
        ),
        .executableTarget(
            name: "Obolus",
            dependencies: ["ObolusKit"]
        ),
        .testTarget(
            name: "ObolusKitTests",
            dependencies: ["ObolusKit"]
        ),
    ]
)
