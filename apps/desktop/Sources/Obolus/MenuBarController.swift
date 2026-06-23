import AppKit
import SwiftUI
import ObolusKit

/// Owns the menu bar status item. Left-click toggles the SwiftUI popover (recent spend);
/// right-click shows a native menu (Open Dashboard / Quit).
@MainActor
final class MenuBarController: NSObject {
    private let statusItem: NSStatusItem
    private let popover = NSPopover()
    private let actions: Actions

    init(serve: ServeProcess, store: SummaryStore, actions: Actions) {
        self.actions = actions
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()

        if let button = statusItem.button {
            let image = NSImage(systemSymbolName: "chart.bar.xaxis", accessibilityDescription: "Obolus")
            image?.isTemplate = true // monochrome; adapts to light/dark menu bar
            button.image = image
            button.toolTip = "Obolus — AI coding-agent spend"
            button.target = self
            button.action = #selector(handleClick)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(
            rootView: MenuBarView()
                .environmentObject(serve)
                .environmentObject(store)
                .environmentObject(actions)
        )
    }

    @objc private func handleClick() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
        } else {
            togglePopover()
        }
    }

    private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func showMenu() {
        let menu = NSMenu()
        let open = NSMenuItem(title: "Open Dashboard", action: #selector(menuOpenDashboard), keyEquivalent: "")
        open.target = self
        open.image = NSImage(systemSymbolName: "macwindow", accessibilityDescription: nil)
        menu.addItem(open)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Obolus", action: #selector(menuQuit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        if let button = statusItem.button {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 4), in: button)
        }
    }

    @objc private func menuOpenDashboard() { actions.openDashboard() }
    @objc private func menuQuit() { actions.quit() }
}
