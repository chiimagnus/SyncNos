import AppKit
import SwiftUI

@MainActor
public final class MenuBarPopoverController: NSObject {
    private let statusItem: NSStatusItem
    private let popover: NSPopover
    private let hostingController: NSHostingController<AnyView>

    public init<Content: View>(
        iconImageName: String,
        contentSize: NSSize = NSSize(width: 240, height: 220),
        @ViewBuilder content: () -> Content
    ) {
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.popover = NSPopover()
        self.hostingController = NSHostingController(rootView: AnyView(content()))
        super.init()
        configureStatusItem(icon: NSImage(named: iconImageName))
        configurePopover(contentSize: contentSize)
    }

    public convenience init<Content: View>(
        systemSymbolName: String,
        contentSize: NSSize = NSSize(width: 240, height: 220),
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            icon: NSImage(systemSymbolName: systemSymbolName, accessibilityDescription: nil),
            contentSize: contentSize,
            content: content
        )
    }

    public init<Content: View>(
        icon: NSImage?,
        contentSize: NSSize = NSSize(width: 240, height: 220),
        @ViewBuilder content: () -> Content
    ) {
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.popover = NSPopover()
        self.hostingController = NSHostingController(rootView: AnyView(content()))
        super.init()
        configureStatusItem(icon: icon)
        configurePopover(contentSize: contentSize)
    }

    public func setVisible(_ isVisible: Bool) {
        statusItem.isVisible = isVisible
        if !isVisible {
            popover.performClose(nil)
        }
    }

    // MARK: - Private

    private func configureStatusItem(icon: NSImage?) {
        guard let button = statusItem.button else { return }

        icon?.isTemplate = true
        button.image = icon
        button.target = self
        button.action = #selector(togglePopover(_:))
        button.sendAction(on: [.leftMouseUp])
    }

    private func configurePopover(contentSize: NSSize) {
        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = hostingController
        popover.contentSize = contentSize
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

