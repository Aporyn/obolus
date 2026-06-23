import SwiftUI
import AppKit
import ObolusKit

@main
struct ObolusApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // The whole UI is driven by AppDelegate: a custom NSStatusItem (so we can tell
        // left-click from right-click) plus an AppKit-managed dashboard window. A Settings
        // scene satisfies the `App` protocol without opening a window on launch.
        Settings { EmptyView() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let serve = ServeProcess()
    private let store = SummaryStore()
    private let actions = Actions()
    private var menuBar: MenuBarController?
    private lazy var dashboard = DashboardWindowController(serve: serve, store: store)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu-bar agent; no Dock icon by default
        store.attach(to: serve)
        serve.start()

        actions.openDashboard = { [weak self] in self?.dashboard.show() }
        actions.quit = { NSApp.terminate(nil) }

        menuBar = MenuBarController(serve: serve, store: store, actions: actions)

        // Open the dashboard automatically only on the very first launch, so a new user
        // sees the app immediately. Afterwards it lives quietly in the menu bar — click
        // the icon (or right-click → Open Dashboard) to bring the window back.
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: Self.didAutoOpenKey) {
            defaults.set(true, forKey: Self.didAutoOpenKey)
            dashboard.show()
        }
    }

    private static let didAutoOpenKey = "didAutoOpenDashboardOnce"

    func applicationWillTerminate(_ notification: Notification) {
        serve.stop()
    }
}
