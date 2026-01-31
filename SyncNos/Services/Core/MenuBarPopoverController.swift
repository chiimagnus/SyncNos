import AppKit
import SwiftUI

@MainActor
final class MenuBarPopoverController: NSObject {
    private let statusItem: NSStatusItem
    private let popover: NSPopover
    private let hostingController: NSHostingController<AnyView>

    init<Content: View>(iconImageName: String, @ViewBuilder content: () -> Content) {
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.popover = NSPopover()
        self.hostingController = NSHostingController(rootView: AnyView(content()))
        super.init()
        configureStatusItem(iconImageName: iconImageName)
        configurePopover()
    }

    func setVisible(_ isVisible: Bool) {
        statusItem.isVisible = isVisible
        if !isVisible {
            popover.performClose(nil)
        }
    }

    // MARK: - Private

    private func configureStatusItem(iconImageName: String) {
        guard let button = statusItem.button else { return }

        let image = NSImage(named: iconImageName)
        image?.isTemplate = true
        button.image = image
        button.target = self
        button.action = #selector(togglePopover(_:))
        button.sendAction(on: [.leftMouseUp])
    }

    private func configurePopover() {
        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = hostingController
        popover.contentSize = NSSize(width: 240, height: 220)
    }

    @objc
    private func togglePopover(_ sender: Any?) {
        if popover.isShown {
            popover.performClose(sender)
        } else {
            showPopover()
        }
    }

    private func showPopover() {
        guard let button = statusItem.button else { return }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    }
}
