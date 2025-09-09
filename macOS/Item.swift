//
//  Item.swift
//  macOS
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
