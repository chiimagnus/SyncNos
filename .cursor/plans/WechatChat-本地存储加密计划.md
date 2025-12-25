# WechatChat 本地存储加密实现计划

> **状态**：✅ 已实现（2024-12-25）  
> **优先级**：P1（隐私保护需求明确）  
> **预计工作量**：1.5-2 天  
> **实际工作量**：0.5 天

---

## 一、概述

### 目标
使用 Apple 官方推荐的 **CryptoKit AES-GCM + Keychain** 方案，对 WechatChat 的聊天记录进行本地加密存储，保护用户隐私。

### 加密范围
- **消息内容**（`content`）
- **发送者昵称**（`senderName`）
- **联系人名称**（`contactName`）

### 不加密字段（保持可查询）
- 消息 ID、对话 ID
- 消息类型（`kind`）
- 消息方向（`isFromMe`）
- 排序字段（`order`）
- 时间戳

---

## 二、技术方案

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    Keychain (macOS)                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Key: "com.syncnos.wechat.encryption.key"           │ │
│  │  Value: SymmetricKey (256-bit AES key)              │ │
│  │  Accessibility: kSecAttrAccessibleWhenUnlocked      │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                            ↓ 读取密钥
┌──────────────────────────────────────────────────────────┐
│               EncryptionService (新建)                    │
│  ┌───────────────────────────────────────────────────┐   │
│  │  encrypt(_ plaintext: String) -> Data             │   │
│  │  decrypt(_ ciphertext: Data) -> String?           │   │
│  │  generateKey() -> SymmetricKey                    │   │
│  │  loadOrCreateKey() -> SymmetricKey                │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  技术实现：                                               │
│  - CryptoKit AES.GCM.seal() / AES.GCM.open()            │
│  - 每次加密自动生成 nonce                                 │
│  - 密文格式：nonce + ciphertext + tag (combined)         │
└──────────────────────────────────────────────────────────┘
                            ↓ 加密后存储
┌──────────────────────────────────────────────────────────┐
│                  SwiftData 存储结构变更                    │
│  ┌───────────────────────────────────────────────────┐   │
│  │  CachedWechatMessageV2                            │   │
│  │  - contentEncrypted: Data    (原 content: String) │   │
│  │  - senderNameEncrypted: Data?                     │   │
│  │                                                   │   │
│  │  CachedWechatConversationV2                       │   │
│  │  - contactNameEncrypted: Data                     │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 2.2 密钥管理策略

| 场景 | 处理方式 |
|------|----------|
| 首次启动 | 生成 256-bit SymmetricKey，存入 Keychain |
| 正常启动 | 从 Keychain 加载密钥 |
| 密钥丢失 | 数据不可恢复，需清空重建（符合安全预期） |
| App 卸载 | Keychain 数据保留（macOS 默认行为） |
| iCloud Keychain | 不同步（使用 `kSecAttrSynchronizable: false`） |

### 2.3 加密算法选择

| 属性 | 值 |
|------|-----|
| 算法 | AES-256-GCM |
| 密钥长度 | 256 bits |
| Nonce | 12 bytes (自动生成) |
| Tag | 16 bytes (认证标签) |
| 密文格式 | `combined` (nonce + ciphertext + tag) |

**选择理由**：
- AES-GCM 是 NIST 推荐的认证加密模式
- 同时提供机密性和完整性保护
- CryptoKit 原生支持，性能优异
- Apple 官方文档推荐

---

## 三、文件结构

```
SyncNos/
├── Services/
│   └── Core/
│       └── EncryptionService.swift    # 新增：加密服务
├── Models/
│   └── WechatChat/
│       └── WechatChatCacheModels.swift # 修改：增加加密字段
└── Services/
    └── DataSources-From/
        └── WechatChat/
            └── WechatChatCacheService.swift # 修改：加密/解密调用
```

---

## 四、实现详情

### 4.1 EncryptionService

```swift
// Services/Core/EncryptionService.swift

import CryptoKit
import Security
import Foundation

/// 本地数据加密服务（使用 CryptoKit AES-GCM）
final class EncryptionService {
    static let shared = EncryptionService()
    
    private let keyTag = "com.syncnos.wechat.encryption.key"
    private var cachedKey: SymmetricKey?
    private let queue = DispatchQueue(label: "com.syncnos.encryption")
    
    private init() {}
    
    // MARK: - Public API
    
    /// 加密字符串
    func encrypt(_ plaintext: String) throws -> Data {
        let key = try loadOrCreateKey()
        guard let data = plaintext.data(using: .utf8) else {
            throw EncryptionError.encodingFailed
        }
        let sealedBox = try AES.GCM.seal(data, using: key)
        guard let combined = sealedBox.combined else {
            throw EncryptionError.sealingFailed
        }
        return combined
    }
    
    /// 解密数据
    func decrypt(_ ciphertext: Data) throws -> String {
        let key = try loadOrCreateKey()
        let sealedBox = try AES.GCM.SealedBox(combined: ciphertext)
        let decryptedData = try AES.GCM.open(sealedBox, using: key)
        guard let plaintext = String(data: decryptedData, encoding: .utf8) else {
            throw EncryptionError.decodingFailed
        }
        return plaintext
    }
    
    /// 检查加密是否可用
    var isAvailable: Bool {
        (try? loadOrCreateKey()) != nil
    }
    
    // MARK: - Key Management
    
    /// 加载或创建加密密钥
    private func loadOrCreateKey() throws -> SymmetricKey {
        if let key = cachedKey {
            return key
        }
        
        // 尝试从 Keychain 加载
        if let keyData = try? loadKeyFromKeychain() {
            let key = SymmetricKey(data: keyData)
            cachedKey = key
            return key
        }
        
        // 生成新密钥
        let newKey = SymmetricKey(size: .bits256)
        try saveKeyToKeychain(newKey)
        cachedKey = newKey
        return newKey
    }
    
    private func loadKeyFromKeychain() throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keyTag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let keyData = result as? Data else {
            throw EncryptionError.keyNotFound
        }
        
        return keyData
    }
    
    private func saveKeyToKeychain(_ key: SymmetricKey) throws {
        let keyData = key.withUnsafeBytes { Data($0) }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keyTag,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
            kSecAttrSynchronizable as String: kCFBooleanFalse!  // 不同步到 iCloud
        ]
        
        // 先尝试删除旧的
        SecItemDelete(query as CFDictionary)
        
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw EncryptionError.keySaveFailed
        }
    }
}

// MARK: - Errors

enum EncryptionError: Error, LocalizedError {
    case encodingFailed
    case decodingFailed
    case sealingFailed
    case keyNotFound
    case keySaveFailed
    
    var errorDescription: String? {
        switch self {
        case .encodingFailed: return "Failed to encode plaintext"
        case .decodingFailed: return "Failed to decode ciphertext"
        case .sealingFailed: return "Failed to seal data"
        case .keyNotFound: return "Encryption key not found"
        case .keySaveFailed: return "Failed to save encryption key"
        }
    }
}
```

### 4.2 SwiftData 模型变更

```swift
// Models/WechatChat/WechatChatCacheModels.swift

@Model
final class CachedWechatMessageV2 {
    // 保持不变（不加密）
    @Attribute(.unique) var messageId: String
    var conversationId: String
    var screenshotId: String
    var isFromMe: Bool
    var kindRaw: String
    var order: Int
    var bboxJSON: String?
    
    // 加密字段（原 String 改为 Data）
    var contentEncrypted: Data
    var senderNameEncrypted: Data?
    
    // 便捷访问器（解密）
    var content: String {
        get {
            (try? EncryptionService.shared.decrypt(contentEncrypted)) ?? "[解密失败]"
        }
    }
    
    var senderName: String? {
        get {
            guard let encrypted = senderNameEncrypted else { return nil }
            return try? EncryptionService.shared.decrypt(encrypted)
        }
    }
    
    // 初始化时加密
    convenience init(
        messageId: String,
        conversationId: String,
        screenshotId: String,
        content: String,        // 明文输入
        isFromMe: Bool,
        senderName: String? = nil,
        kind: WechatMessageKind = .text,
        order: Int,
        bbox: CGRect? = nil
    ) throws {
        let encryptedContent = try EncryptionService.shared.encrypt(content)
        let encryptedSenderName = try senderName.map { try EncryptionService.shared.encrypt($0) }
        
        self.init(
            messageId: messageId,
            conversationId: conversationId,
            screenshotId: screenshotId,
            contentEncrypted: encryptedContent,
            isFromMe: isFromMe,
            senderNameEncrypted: encryptedSenderName,
            kind: kind,
            order: order,
            bbox: bbox
        )
    }
    
    // 原始初始化（已加密数据）
    init(
        messageId: String,
        conversationId: String,
        screenshotId: String,
        contentEncrypted: Data,
        isFromMe: Bool,
        senderNameEncrypted: Data?,
        kind: WechatMessageKind = .text,
        order: Int,
        bbox: CGRect? = nil
    ) {
        self.messageId = messageId
        self.conversationId = conversationId
        self.screenshotId = screenshotId
        self.contentEncrypted = contentEncrypted
        self.isFromMe = isFromMe
        self.senderNameEncrypted = senderNameEncrypted
        self.kindRaw = kind.rawValue
        self.order = order
        // bbox 处理...
    }
}
```

### 4.3 CacheService 适配

```swift
// 保存消息时
func saveMessage(_ message: WechatMessage, ...) async throws {
    let cached = try CachedWechatMessageV2(
        messageId: message.id.uuidString,
        conversationId: conversationId,
        screenshotId: screenshotId,
        content: message.content,       // 明文传入，内部加密
        isFromMe: message.isFromMe,
        senderName: message.senderName, // 明文传入，内部加密
        kind: message.kind,
        order: message.order,
        bbox: message.bbox
    )
    modelContext.insert(cached)
}

// 读取消息时
func loadMessages(...) async throws -> [WechatMessage] {
    let cached = try modelContext.fetch(...)
    return cached.map { msg in
        WechatMessage(
            id: UUID(uuidString: msg.messageId) ?? UUID(),
            content: msg.content,       // 自动解密
            isFromMe: msg.isFromMe,
            senderName: msg.senderName, // 自动解密
            kind: msg.kind,
            bbox: msg.bbox,
            order: msg.order
        )
    }
}
```

---

## 五、数据迁移

### 5.1 迁移策略

由于 SwiftData 字段类型从 `String` 改为 `Data`，需要进行数据迁移：

1. **方案 A：Schema 版本迁移**
   - 使用 SwiftData 的 `VersionedSchema` 和 `SchemaMigrationPlan`
   - 读取旧数据 → 加密 → 写入新字段

2. **方案 B：清空重建**（推荐用于首次发布）
   - 如果用户升级时有未加密数据，提示用户重新导入
   - 简单可靠，避免迁移复杂性

### 5.2 推荐方案

**首次发布选择方案 B**：
- 当前 WechatChat 功能较新，用户数据量不大
- 避免引入迁移复杂性
- 升级时检测旧数据并提示用户

```swift
// 启动时检测
if hasUnencryptedData() {
    showMigrationAlert()
    // 用户确认后清空旧数据
}
```

---

## 六、实现步骤

### 第一步：创建 EncryptionService（0.5 天）✅ 已完成

1. ✅ 创建 `Services/Core/EncryptionService.swift`
2. ✅ 实现 Keychain 密钥存储（使用 `KeychainHelper`）
3. ✅ 实现 AES-GCM 加密/解密
4. ⏳ 添加单元测试（待用户测试确认后添加）

### 第二步：修改 SwiftData 模型（0.5 天）✅ 已完成

1. ✅ 修改 `CachedWechatMessageV2`
   - 新增 `contentEncrypted: Data` 字段
   - 新增 `senderNameEncrypted: Data?` 字段
   - 添加便捷访问器（计算属性自动解密）
2. ✅ 修改 `CachedWechatConversationV2`
   - 新增 `nameEncrypted: Data` 字段
3. ✅ 处理数据迁移：新建 `wechatchat_v3.store`（清空重建策略）

### 第三步：适配 CacheService（0.5 天）✅ 已完成

1. ✅ 修改 `WechatChatCacheService` 的保存方法
2. ✅ 修改读取方法，确保解密正常
3. ✅ 添加错误处理（解密失败时返回 `"[解密失败]"`）

### 第四步：UI 和设置（可选，0.5 天）⏳ 未实施

1. 在设置中添加"加密状态"指示
2. 添加"清除加密数据"选项
3. 添加"重新生成密钥"选项（高级）

---

## 七、测试计划

### 7.1 单元测试

```swift
func testEncryptDecrypt() throws {
    let original = "测试消息内容 🎉"
    let encrypted = try EncryptionService.shared.encrypt(original)
    let decrypted = try EncryptionService.shared.decrypt(encrypted)
    XCTAssertEqual(original, decrypted)
}

func testDifferentCiphertexts() throws {
    let plaintext = "Same message"
    let cipher1 = try EncryptionService.shared.encrypt(plaintext)
    let cipher2 = try EncryptionService.shared.encrypt(plaintext)
    XCTAssertNotEqual(cipher1, cipher2)  // 不同 nonce
}
```

### 7.2 集成测试

1. 导入截图 → 验证消息加密存储
2. 重启应用 → 验证消息正确解密
3. 删除 Keychain 密钥 → 验证数据不可读
4. 重新生成密钥 → 验证旧数据失效

### 7.3 性能测试

| 场景 | 预期 |
|------|------|
| 加密 1000 条消息 | < 1s |
| 解密 1000 条消息 | < 1s |
| 滚动 100 条消息 | 无卡顿 |

---

## 八、安全考量

### 8.1 开源项目安全性分析

#### 核心结论：**开源不会降低安全性**

密码学领域有一个著名原则叫 **Kerckhoffs 原则**：
> "一个密码系统的安全性应该仅依赖于密钥的保密性，而不是算法的保密性。"

AES-256-GCM 就是这样设计的——算法完全公开，安全性完全依赖密钥。

#### 开源会暴露什么？

| 暴露内容 | 是否影响安全性 | 原因 |
|----------|---------------|------|
| 加密算法（AES-256-GCM）| ❌ 不影响 | 这是公开的工业标准算法 |
| 密钥存储位置（Keychain）| ❌ 不影响 | Keychain 本身有系统级保护 |
| 加密字段（content, senderName）| ❌ 不影响 | 知道加密什么不等于能解密 |
| 密钥生成逻辑 | ❌ 不影响 | 每个设备生成独立随机密钥 |
| Keychain 标识符 | ❌ 不影响 | 需要 macOS 登录密码才能访问用户 Keychain |

#### 真正的安全依赖

1. **密钥的保密性**：存储在 macOS Keychain，受系统登录密码保护
2. **AES-256 的数学安全性**：暴力破解需要 2^256 次尝试（实际不可行）
3. **Keychain 的系统保护**：macOS 内核级别的安全机制

#### 代码开源的好处

- ✅ 社区可以帮助发现和修复安全漏洞
- ✅ 透明度增加用户信任
- ✅ 符合密码学最佳实践（算法公开，密钥保密）

### 8.2 已实现的安全措施

- ✅ AES-256-GCM 认证加密（NIST 推荐）
- ✅ 密钥存储在 macOS Keychain
- ✅ 每次加密使用不同 nonce（防重放攻击）
- ✅ 不同步到 iCloud Keychain（`kSecAttrSynchronizable: false`）
- ✅ 仅在设备解锁时可访问（`kSecAttrAccessibleWhenUnlocked`）
- ✅ 使用 Apple CryptoKit（自动覆写敏感内存）

### 8.3 已知限制

- ⚠️ 无用户密码保护（依赖系统登录密码）
- ⚠️ 密钥丢失数据不可恢复（安全设计的预期行为）
- ⚠️ 内存中可能存在明文（使用中，CryptoKit 会自动覆写）

### 8.4 可选增强方向（未来迭代）

| 增强措施 | 描述 | 复杂度 |
|----------|------|--------|
| 用户密码派生密钥 | 使用 PBKDF2/Argon2 从用户密码派生密钥 | 中等 |
| Secure Enclave 存储 | 密钥永不离开 Secure Enclave（仅 Mac T2/M1+）| 高 |
| Touch ID / Face ID | 应用锁定，生物识别解锁 | 中等 |
| 定时自动锁定 | 空闲后锁定应用，需重新解锁 | 低 |

---

## 九、风险和注意事项

1. **性能影响**：加密/解密有一定开销，但 AES-GCM 硬件加速，影响可忽略
2. **数据丢失**：密钥丢失后数据不可恢复，这是安全设计的预期行为
3. **迁移风险**：首次升级时需处理旧数据，建议提示用户重新导入
4. **调试困难**：加密后数据库文件不可直读，需添加调试工具

---

## 十、版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| 1.0 | 2024-12-25 | 初始版本 |

