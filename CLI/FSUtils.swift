//
//  FSUtils.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation

// MARK: - FS Utilities

func homeDirectory() -> String {
    NSHomeDirectory()
}

func booksDataRoot(dbRootOverride: String?) -> String {
    if let override = dbRootOverride { 
        return override 
    }
    return homeDirectory() + "/Library/Containers/com.apple.iBooksX/Data/Documents"
}

func latestSQLiteFile(in directory: String) -> String? {
    let fm = FileManager.default
    guard let contents = try? fm.contentsOfDirectory(atPath: directory) else { 
        return nil 
    }
    let candidates = contents.filter { $0.hasSuffix(".sqlite") }
    guard !candidates.isEmpty else { 
        return nil 
    }
    var best: (path: String, mtime: Date)?
    for file in candidates {
        let full = (directory as NSString).appendingPathComponent(file)
        if let attrs = try? fm.attributesOfItem(atPath: full), 
           let mtime = attrs[.modificationDate] as? Date {
            if best == nil || mtime > best!.mtime { 
                best = (full, mtime) 
            }
        } else {
            // fallback: prefer lexicographically last if no mtime
            if best == nil { 
                best = (full, Date.distantPast) 
            }
        }
    }
    return best?.path
}

func ensureTempCopyIfLocked(originalPath: String) -> String {
    // Try open read-only first; if fails, copy to /tmp and use the copy
    if canOpenReadOnly(dbPath: originalPath) {
        return originalPath
    }
    let tmp = (NSTemporaryDirectory() as NSString).appendingPathComponent(UUID().uuidString + ".sqlite")
    do {
        let fm = FileManager.default
        try fm.copyItem(atPath: originalPath, toPath: tmp)
        return tmp
    } catch {
        return originalPath // last resort, let open fail and report
    }
}