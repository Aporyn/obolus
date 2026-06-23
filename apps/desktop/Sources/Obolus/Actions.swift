import SwiftUI

/// App-level navigation actions, injected into SwiftUI views so the popover can drive
/// AppKit-owned surfaces (the dashboard window) and quit, without reaching for globals.
@MainActor
final class Actions: ObservableObject {
    var openDashboard: () -> Void = {}
    var quit: () -> Void = {}
}
