import Foundation

enum SharedDefaults {
    static let suiteName = "group.com.chiimagnus.SyncNos"
    
    static var userDefaults: UserDefaults {
        if let ud = UserDefaults(suiteName: suiteName) {
            return ud
        }
        return UserDefaults.standard
    }
}


