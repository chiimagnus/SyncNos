//
//  LoginHelperApp.swift
//  LoginHelper
//
//  Created by chii_magnus on 2025/11/7.
//

import SwiftUI
import AppKit

@main
struct LoginHelperApp: App {
    init() {
        let mainBundleId = "com.chiimagnus.macOS"

        // 如果主 app 已在运行，则直接退出 helper
        let alreadyRunning = !NSRunningApplication.runningApplications(withBundleIdentifier: mainBundleId).isEmpty
        if alreadyRunning {
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
            return
        }

        // 尝试唤起主 app（异步），然后短延迟退出 helper
        DispatchQueue.global(qos: .userInitiated).async {
            NSWorkspace.shared.launchApplication(withBundleIdentifier: mainBundleId, options: [.default], additionalEventParamDescriptor: nil, launchIdentifier: nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                NSApp.terminate(nil)
            }
        }
    }

    var body: some Scene {
        // 不展示 UI；EmptyView 作为占位
        WindowGroup {
            EmptyView()
        }
        .handlesExternalEvents(matching: [])
    }
}
