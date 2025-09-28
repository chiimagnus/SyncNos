import SwiftUI
import AppKit

extension Color {
    static var appWindowBackground: Color {
        if #available(macOS 10.15, *) {
            let dynamic = NSColor(name: NSColor.Name("AppWindowBackground")) { appearance in
                if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
                    return NSColor(srgbRed: 36.0/255.0, green: 33.0/255.0, blue: 30.0/255.0, alpha: 1.0) // #24211E
                } else {
                    return NSColor.windowBackgroundColor
                }
            }
            return Color(nsColor: dynamic)
        } else {
            return Color(nsColor: NSColor.windowBackgroundColor)
        }
    }
}


