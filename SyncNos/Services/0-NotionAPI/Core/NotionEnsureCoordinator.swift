import Foundation

// 串行化“按来源确保数据库”的并发入口，避免并发重复创建
actor NotionEnsureCoordinator {
    private var waitersByKey: [String: [CheckedContinuation<Void, Never>]] = [:]

    func begin(key: String) async {
        if waitersByKey[key] != nil {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                waitersByKey[key]!.append(continuation)
            }
        } else {
            waitersByKey[key] = []
        }
    }

    func end(key: String) {
        let waiters = waitersByKey.removeValue(forKey: key) ?? []
        for w in waiters { w.resume() }
    }
}


