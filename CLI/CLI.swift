//
//  CLI.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation

// MARK: - CLI Arguments

public struct CLIOptions {
    public enum Command: String { 
        case inspect, export, list 
    }
    
    public var command: Command = .export
    public var dbRootOverride: String?
    public var outPath: String?
    public var pretty: Bool = false
    // Filters
    public var bookFilters: [String] = []
    public var authorFilters: [String] = []
    public var assetFilters: [String] = []
    
    public init() {}
}

public func parseArguments(_ args: [String]) -> CLIOptions {
    var options = CLIOptions()
    var index = 1
    if index < args.count, let cmd = CLIOptions.Command(rawValue: args[index]) {
        options.command = cmd
        index += 1
    }
    while index < args.count {
        let a = args[index]
        switch a {
        case "--db-root":
            if index + 1 < args.count { 
                options.dbRootOverride = args[index + 1]
                index += 2 
            } else { 
                index += 1 
            }
        case "--out":
            if index + 1 < args.count { 
                options.outPath = args[index + 1]
                index += 2 
            } else { 
                index += 1 
            }
        case "--pretty":
            options.pretty = true
            index += 1
        case "--book":
            if index + 1 < args.count { 
                options.bookFilters.append(args[index + 1])
                index += 2 
            } else { 
                index += 1 
            }
        case "--author":
            if index + 1 < args.count { 
                options.authorFilters.append(args[index + 1])
                index += 2 
            } else { 
                index += 1 
            }
        case "--asset":
            if index + 1 < args.count { 
                options.assetFilters.append(args[index + 1])
                index += 2 
            } else { 
                index += 1 
            }
        default:
            // Ignore unknown for M0 to keep零依赖
            index += 1
        }
    }
    return options
}