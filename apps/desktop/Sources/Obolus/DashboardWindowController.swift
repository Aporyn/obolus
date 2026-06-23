import AppKit
import SwiftUI
import ObolusKit

/// Manages the native dashboard window. While it is open the app shows a Dock icon
/// (`.regular`); when it closes the app returns to a pure menu-bar agent (`.accessory`).
@MainActor
final class DashboardWindowController: NSObject, NSWindowDelegate {
    private let serve: ServeProcess
    private let store: SummaryStore
    private var window: NSWindow?

    init(serve: ServeProcess, store: SummaryStore) {
        self.serve = serve
        self.store = store
        super.init()
    }

    func show() {
        if window == nil {
            let root = DashboardView()
                .environmentObject(serve)
                .environmentObject(store)
            let hosting = NSHostingController(rootView: root)
            let win = NSWindow(contentViewController: hosting)
            win.title = "Obolus Dashboard"
            win.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            win.setContentSize(NSSize(width: 940, height: 760))
            win.center()
            win.isReleasedWhenClosed = false
            win.delegate = self
            win.setFrameAutosaveName("ObolusDashboard")
            window = win
        }
        NSApp.setActivationPolicy(.regular)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}
