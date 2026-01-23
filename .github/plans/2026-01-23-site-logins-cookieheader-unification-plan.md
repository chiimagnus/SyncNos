# Site Logins（统一 cookieHeader）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收（此计划不改动国际化资源文件，除非另行明确要求）。

## 当前进度（更新于 2026-01-23）

- ✅ P1（统一模型 + Provider/Service 协议）：已完成
- ✅ P2.1（WeRead Provider）：已完成
- ✅ P2.2（Dedao Provider）：已完成
- ✅ P2.3（GoodLinks：domain → cookieHeader 存储 + Provider）：已完成（破坏性变更，需重新登录一次）
- ✅ P3.1（Site Logins 总览页）：已完成（已展示 `cookieHeader` 单行文本，便于复制排查）
- ✅ P3.2（清理旧通知跳转链路）：已完成（保留 WeRead/Dedao Settings 页内的登录 UI，但移除“通知跳转到各自 Settings 并自动弹登录 sheet”的旧链路）
- ✅ P4（会话过期统一入口，推荐但可选）：已完成（`.showSessionExpiredAlert` 的 “Go to Login” 统一打开 Settings → `Site Logins` 并弹出对应登录 sheet）

**本次落地的主要文件**
- `SyncNos/Models/SiteLogins/SiteLoginModels.swift`
- `SyncNos/Services/SiteLogins/SiteLoginsService.swift`
- `SyncNos/Services/SiteLogins/Providers/WeReadSiteLoginProvider.swift`
- `SyncNos/Services/SiteLogins/Providers/DedaoSiteLoginProvider.swift`
- `SyncNos/Services/SiteLogins/Providers/GoodLinksSiteLoginProvider.swift`
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksAuthService.swift`
- `SyncNos/Views/Settings/General/SiteLoginsView.swift`
- `SyncNos/ViewModels/SiteLogins/SiteLoginsViewModel.swift`
- `SyncNos/Services/Core/DIContainer.swift`
- `SyncNos/Services/Core/Protocols.swift`
- `SyncNos/Views/Settings/General/SettingsView.swift`
- `SyncNos/Views/Components/Main/MainListView.swift`
- `SyncNos/Models/Core/NotificationNames.swift`

**Breaking changes（破坏性修改）**
- ✅ 接受破坏性修改：**不需要**向后兼容旧的存储格式/旧的通知链路/旧的设置页结构。
- 影响：升级后用户可能需要重新登录（Keychain 旧数据可直接废弃或清理）。

**Goal（目标）**
- 在 **Models / Services** 层面建立统一的“站点登录（cookieHeader）”抽象：WeRead / Dedao / GoodLinks 都以 `cookieHeader: String` 作为网络认证载体。
- UI 层允许分散：各数据源设置页继续保留各自 Web 登录 UI；同时 `Site Logins` 提供一个“总览页”，展示所有登录项并支持“检查会话 / 清除”。
- 识别登录失效：提供统一的 `checkSession()` 能力（WeRead/Dedao 通过轻量 API 探测；GoodLinks 仅做基础判断 + 实际抓取失败提示）。

**Non-goals（非目标）**
- 不追求展示“每条 cookie”级别的完整明细（domain/path/expires 等）；总览只做简陋可用的状态展示。
- 不做跨站点的自动刷新通用化（WeRead 已有静默刷新链路，先保持原样；后续再抽象）。
- 不新增/修改 `Resource/Localizable.xcstrings`（除非你明确要求补齐文案本地化）。

**Approach（方案）**
- 引入统一模型：`SiteLoginEntry`（一个登录项）+ `SiteLoginStatus`（valid/expired/unknown/needLogin/needVerification 等）。
- 引入统一 Provider 协议：每个数据源实现一个 `SiteLoginProviderProtocol`，负责：
  - 读/写 `cookieHeader`（WeRead/Dedao：单项；GoodLinks：按站点域名分组多项）
  - `checkSession()`（WeRead：调用最轻 API；Dedao：调用 `fetchUserInfo()`；GoodLinks：先返回 `.unknown`，由抓取器的 401/403 决策为主）
  - `clear()` / `clearAll()`
- `SiteLoginProviderProtocol` 采用 `Actor`，避免 Swift 6 下的 Sendable 警告；聚合层 `SiteLoginsService` 也是 `actor`。
- `SiteLoginsView` 依赖 `SiteLoginsService` + 简单 ViewModel 来渲染与触发操作，避免逻辑散落到多个地方。

**Acceptance（验收）**
- `Site Logins` 页面能同时看到：WeRead、Dedao（各 1 项）与 GoodLinks（按站点域名多项）的登录状态与操作按钮（Open Login / Check / Log Out 或 Clear）。
- 在 WeRead/Dedao 设置页仍可直接打开各自 Web 登录 UI（不强制跳转到 Site Logins）。
- WeRead/Dedao：点击 `Check Session` 能稳定识别过期/需要验证/有效，并给出原因（至少在日志与 UI 之一可见）。
- GoodLinks：保存某站点 cookies 后，对该站点 URL 抓取会自动携带 `Cookie:`；当 401/403 时能提示需要重新登录。
- 升级破坏性验证：旧 Keychain 数据不迁移，旧登录态不保证保留（允许用户重新登录一次即可恢复）。
- 全量编译通过：`xcodebuild -scheme SyncNos build -quiet`

---

## Plan A（主方案）：统一 Provider + 统一 Site Logins 总览

### P0：全面梳理现状（只读确认）

#### Task 0.1: 列出所有“登录/会话过期/导航到登录”的入口

**Files（只读）**
- `SyncNos/Services/Core/Protocols.swift`（WeRead/Dedao/GoodLinks auth 协议）
- `SyncNos/Models/Core/NotificationNames.swift`（登录/导航相关通知）
- `SyncNos/Views/Settings/General/SiteLoginsView.swift`
- `SyncNos/Views/Settings/SyncFrom/WeReadSettingsView.swift`
- `SyncNos/Views/Settings/SyncFrom/DedaoSettingsView.swift`
- `SyncNos/Views/Settings/SyncFrom/GoodLinksSettingsView.swift`
- `SyncNos/Views/Settings/SyncFrom/WeReadLoginView.swift`
- `SyncNos/Views/Settings/SyncFrom/DedaoLoginView.swift`
- `SyncNos/Views/Settings/SyncFrom/GoodLinksLoginView.swift`
- `SyncNos/Services/DataSources-From/WeRead/WeReadAPIService.swift`（sessionExpired/refresh）
- `SyncNos/Services/DataSources-From/Dedao/DedaoAPIService.swift`
- `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksURLFetcher.swift`

**Verify**
- 无（仅梳理）

---

### P1：建立统一模型与 Provider 协议（Models/Services 统一的核心）

#### Task 1.1: 新增 SiteLogin 统一模型

**Files**
- Create: `SyncNos/Models/SiteLogins/SiteLoginModels.swift`

**内容建议**
- `enum SiteLoginStatus: Sendable`：
  - `.unknown`
  - `.valid`
  - `.expired(reason: String)`
  - `.needLogin(reason: String)`
  - `.needVerification(reason: String)`（Dedao 特有）
- `struct SiteLoginEntry: Identifiable, Sendable`：
  - `id`（例如 `sourceKey:domain`）
  - `source: ContentSource`
  - `displayName`（例如 `WeRead` / `Dedao` / `GoodLinks`）
  - `domain: String?`（GoodLinks 用；WeRead/Dedao 为 nil）
  - `isLoggedIn: Bool`
  - `status: SiteLoginStatus`
  - `cookieHeader: String?`（可选，仅用于内部/调试；UI 默认不展示原文）

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`

---

#### Task 1.2: 新增 Provider 协议与聚合服务协议

**Files**
- Modify: `SyncNos/Services/Core/Protocols.swift`
- Create: `SyncNos/Services/SiteLogins/SiteLoginsService.swift`

**内容建议**
- `protocol SiteLoginProviderProtocol: Actor`：
  - `nonisolated var source: ContentSource { get }`
  - `func listEntries() async -> [SiteLoginEntry]`
  - `func checkSession(entryId: String) async -> SiteLoginStatus`
  - `func clear(entryId: String) async`
  - `func clearAll() async`
- `protocol SiteLoginsServiceProtocol: Actor`：
  - `func listAllEntries() async -> [SiteLoginEntry]`
  - `func checkSession(entryId: String) async -> SiteLoginStatus`
  - `func clear(entryId: String) async`
  - `func clearAll() async`

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`

---

### P2：各数据源 Provider 落地（统一 cookieHeader 载体）

#### Task 2.1: WeReadProvider（基于现有 cookieHeader + API 探测）

**Files**
- Create: `SyncNos/Services/SiteLogins/Providers/WeReadSiteLoginProvider.swift`

**实现要点**
- `listEntries()`：返回单条 entry（`domain=nil`），`isLoggedIn` 使用 `weReadAuthService.isLoggedIn`。
- `checkSession()`：调用 `weReadAPIService.fetchNotebooks()`；成功 → `.valid`；捕获 `WeReadAPIError.sessionExpired*` → `.expired(reason)`；未登录 → `.needLogin(reason)`。
- `clearAll()`：`await weReadAuthService.clearCookies()`。
- 登录 UI：在 `SiteLoginsView` 直接弹出 `WeReadLoginView`；WeRead 设置页仍保留原有登录 Sheet（当前仍存在旧通知跳转链路）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`

---

#### Task 2.2: DedaoProvider（基于现有 cookieHeader + API 探测）

**Files**
- Create: `SyncNos/Services/SiteLogins/Providers/DedaoSiteLoginProvider.swift`

**实现要点**
- `checkSession()`：调用 `dedaoAPIService.fetchUserInfo()`；`DedaoAPIError.needVerification` → `.needVerification`；`sessionExpired/notLoggedIn` → `.expired/.needLogin`。
- 其余同 WeReadProvider。

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`

---

#### Task 2.3: GoodLinksProvider（多站点：按域名管理 cookieHeader）

**Files**
- Modify: `SyncNos/Services/Core/Protocols.swift`（调整 GoodLinksAuthServiceProtocol：以 `cookieHeader` 为核心，而不是暴露 `[HTTPCookie]`）
- Modify: `SyncNos/Services/DataSources-From/GoodLinks/GoodLinksAuthService.swift`（内部存储由 “cookie structs” 改为 “domain → cookieHeader（+updatedAt 可选）”）
- Modify: `SyncNos/Views/Settings/SyncFrom/GoodLinksLoginView.swift`（保存时计算 cookieHeader，并写入到 GoodLinksAuthService）
- Create: `SyncNos/Services/SiteLogins/Providers/GoodLinksSiteLoginProvider.swift`

**实现要点**
- `GoodLinksAuthService` 存储结构建议：
  - `struct StoredDomainCookie: Codable { domain: String; cookieHeader: String; updatedAt: Date }`
  - Keychain JSON 持久化（与 WeRead/Dedao 一致“延迟加载”策略）
- 破坏性变更：直接替换旧的 GoodLinks cookies 存储（例如旧的 `StoredCookie` / `GoodLinksStoredCookiesV1` 结构），不做迁移；必要时可在首次启动时直接删除旧 Keychain entry。
- `listEntries()`：每个 domain 一条 entry，`isLoggedIn` 由 cookieHeader 是否为空判断。
- `checkSession()`：返回 `.unknown`（或做一次轻量 GET 到 `https://domain/`，但不保证可靠，建议先不做）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`

---

### P3：UI 层合并（Site Logins 总览 + 各设置页仍保留登录 UI）

#### Task 3.1: 重写 SiteLoginsView 为 Provider 驱动

**Files**
- Modify: `SyncNos/Views/Settings/General/SiteLoginsView.swift`
- Modify: `SyncNos/Services/Core/DIContainer.swift`（注入 `siteLoginsService` 与 providers）

**实现要点**
- `SiteLoginsView` 仅显示 entry 列表：
  - 分组：按 `source` 分组（WeRead/Dedao/GoodLinks）
  - 每行按钮：Open Login / Check Session / Clear
- GoodLinks 的 Open Login：弹出 `GoodLinksLoginView`（仍可保留 URL 输入框）。
- WeRead/Dedao 的 Open Login：弹出各自现有登录 Sheet（复用已有 LoginView）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`
- Manual：进入 `Site Logins`，能看到三类条目并可操作

---

#### Task 3.2: 保留 WeRead/Dedao 设置页中的登录 UI（不强制跳转）

**Files**
- Modify: `SyncNos/Views/Settings/SyncFrom/WeReadSettingsView.swift`
- Modify: `SyncNos/Views/Settings/SyncFrom/DedaoSettingsView.swift`

**实现要点**
- Settings 页的 Account 区继续显示：
  - Login Status / Open Login / Log Out
- （可选优化）底层操作委托到 Provider/Service（减少重复逻辑）：当前未做，仍使用原有 SettingsViewModel 的实现。
- （可选清理）删除/移除旧的“从 SettingsView 导航到各自 dataSource pane 并自动弹 sheet”的兼容逻辑：当前未做，仍保留。

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`

---

### P4：会话过期的统一入口（可选但推荐）

#### Task 4.1: 统一“会话过期弹窗 → 去登录”的跳转目标

**Files**
- Modify: `SyncNos/Views/Components/Main/MainListView+SyncRefresh.swift`
- Modify: `SyncNos/ViewModels/WeRead/WeReadViewModel.swift`
- Modify: `SyncNos/ViewModels/Dedao/DedaoViewModel.swift`

**实现要点**
- 当收到 `.showSessionExpiredAlert` 后，“Go to Login”统一打开 Settings 的 `Site Logins` 并弹出对应登录 sheet（不保留旧的跳转目标）。

**Verify**
- Build: `xcodebuild -scheme SyncNos build -quiet`
- Manual：触发一次 sessionExpired（或模拟），点击登录能直达 `Site Logins`

---

## 风险与注意事项
- GoodLinks 的“过期识别”不能像 WeRead/Dedao 那样可靠：建议以抓取返回 401/403 作为主要信号，UI 仅展示 `unknown/has cookies`。
- Keychain 读写要继续遵循“延迟加载”，避免 app 启动时弹 Keychain 权限。
- 本计划不修改国际化资源；如要补齐文案本地化，应单开任务。
- 破坏性修改下的最佳实践：对旧 Keychain entry 直接废弃（或一次性清理），避免“旧数据导致误判为已登录”。
