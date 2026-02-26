# SyncNos WebClipper Safari（iOS + macOS）上架实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 将 `Extensions/WebClipper` 产出可上架的 Safari Web Extension，并通过 Xcode 分别提交 iOS App Store 与 Mac App Store（扩展随宿主 App 分发）。

**Non-goals（非目标）:**
- 不新增与“上架必需”无关的新功能（例如新增站点、重做 UI、做云同步）。
- 不在第一阶段引入复杂的跨端共享（如 iCloud/CloudKit/App Group 数据互通），除非被 iOS 导出能力卡死。

**Approach（方案）:**
- 保持 WebClipper 逻辑一套（`src/**` 复用），新增 Safari 专用 build 输出 `dist-safari/`，做最小的 API/权限适配。
- 用 `xcrun safari-web-extension-packager` 从 `dist-safari/` 生成 iOS+macOS 宿主 App + 扩展工程（可先独立于现有 `SyncNos.xcodeproj`，后续再决定是否合并/做 workspace）。
- 优先用“纯 WebExtension 方式”闭环（导出/回调/注入都有降级），只有在 iOS 限制导致无法闭环时才引入 `sendNativeMessage` + Swift Handler。

**Acceptance（验收）:**
- `npm --prefix Extensions/WebClipper run build:safari` 产出可被 Safari packager 使用的 `dist-safari/manifest.json` 与资源。
- macOS Safari：可启用扩展，完成采集 -> 本地存储 -> popup 查看/删除/导出至少一种闭环；Notion OAuth + 同步可用。
- iOS Safari：可启用扩展，完成采集 -> 本地存储 -> popup 查看/删除；导出/备份至少一种闭环（分享/复制/宿主 App 任选其一）；Notion OAuth + 同步可用。
- 两端 Xcode `Archive` 可通过签名检查并可上传到 App Store Connect（后续审核通过不在本计划强保证范围，但需准备材料）。

---

## 0. 需要先确认的决策（阻塞项）

### Decision A: 宿主 App 产品形态

选项：
1. 新建独立宿主 App：`SyncNos WebClipper`（iOS + macOS），只承载扩展与引导页。
2. macOS 复用现有 `SyncNos` 作为宿主（新增 macOS 扩展 target），iOS 仍新建壳 App。

已选：选项 2（macOS 复用现有 `SyncNos`；iOS 新建壳 App 承载扩展）。

### Decision B: Notion OAuth redirectUri 是否继续用 GitHub Pages

现状：`https://chiimagnus.github.io/syncnos-oauth/callback`

风险：需要在该域名上运行 content script 来上报 `code/state`，并且 host permissions 需允许该域名。

已选：保持不变（继续使用 GitHub Pages 回调页）。

建议：把“回调页上报”作为主流程，`webNavigation` 监听作为兼容分支/可选保留。

可替代方案（如果不想继续用 GitHub Pages）：
- 方案 B1：自有域名静态页（推荐）
  - 例：`https://syncnos.app/oauth/notion/callback`
  - 页面内容与 GitHub Pages 回调页等价：解析 `code/state/error` 并 `runtime.sendMessage` 给扩展
  - 优点：可控、品牌一致、可在审核材料中解释更清晰
- 方案 B2：Cloudflare Workers / Vercel / Netlify 托管回调页
  - 例：直接复用现有 Workers 域名下的一个回调路径（不与 token-exchange API 混淆）
  - 优点：上线快；可与现有 OAuth 代理部署一起维护
- 方案 B3：Universal Links（让 iOS App 接管回调）
  - 例：redirect 到 `https://syncnos.app/notion/callback`，由 iOS App 通过 Associated Domains 接管
  - 缺点：需要额外的 App <-> Extension 数据传递设计（App Group/Native bridge），否则扩展拿不到 code；实现复杂度明显更高

---

## P1（最高优先级）：先把 Safari 产物与关键差异跑通

### Task 1: 新增 Safari build 产物目录与脚本入口

**Files:**
- Modify: `Extensions/WebClipper/package.json`
- Modify: `Extensions/WebClipper/scripts/build.mjs`
- (Optional) Create: `Extensions/WebClipper/scripts/check-safari.mjs`（如需要额外校验）

**Step 1: 实现**
- 在 `package.json` 增加脚本：
  - `build:safari`：输出到 `dist-safari/`（不必 zip）
  - `check:dist:safari`：对 `dist-safari/` 做 manifest/icons 及语法校验（沿用 `scripts/check.mjs` 机制）
- 在 `build.mjs` 增加 `--target=safari` 分支，做 Safari manifest patch（见 Task 2/3/4 要求）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run build:safari`
- Expected: 生成 `Extensions/WebClipper/dist-safari/manifest.json`、`popup.html`、`background.js`、`content.js`、`icons/*` 等可加载文件。

### Task 2: 权限收敛（移除默认全站注入）

**Files:**
- Modify: `Extensions/WebClipper/manifest.json`
- Modify: `Extensions/WebClipper/scripts/build.mjs`（Safari 目标 patch）

**Step 1: 实现**
- 针对 Safari 目标：
  - 移除 `host_permissions` 中的 `http://*/*`、`https://*/*`
  - 移除 `content_scripts` 里对 `*://*/*` 的默认注入块
  - 保留明确支持站点 + Notion API + OAuth 域名（尤其保留 `chiimagnus.github.io` 以便回调上报）
- 将“任意网页抓取”改为“用户显式触发 + activeTab/注入”能力（实现细节见 Task 5）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run build:safari`
- Expected: `dist-safari/manifest.json` 中不再出现 `*://*/*` 默认注入；Safari 目标的 host 权限是可解释的最小集合。

### Task 3: OAuth 回调从“监听式”改为“回调页主动上报”（Safari 主路径）

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/background-notion-oauth.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Modify: `Extensions/WebClipper/src/protocols/message-contracts.js`
- Create: `Extensions/WebClipper/src/bootstrap/oauth-callback-content.js`（仅注入回调页）
- Modify: `Extensions/WebClipper/manifest.json`（新增一个仅匹配回调页的 content script）

**Step 1: 实现**
- 新增 message type：例如 `NOTION_MESSAGE_TYPES.OAUTH_CALLBACK`
- 新增 `oauth-callback-content.js`：
  - 仅在 `https://chiimagnus.github.io/syncnos-oauth/callback*` 运行
  - 读取 URL query 的 `code/state/error`
  - `chrome.runtime.sendMessage({ type: OAUTH_CALLBACK, url: location.href })`
  - 在页面上显示最小提示（成功可关闭、失败请重试），避免“白屏无反馈”
- 后台增加处理分支：接收 `url` 后复用现有 `exchangeNotionCodeForToken`、`state` 校验、写 token 存储，并清理 `pending_state`
- `webNavigation` 监听可保留为非 Safari 平台 fallback（不作为 Safari 主路径）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`（如已有可覆盖）
- Manual（Chrome 先验）：走一次 OAuth，确认不依赖 `webNavigation` 也能完成 token 写入。

### Task 4: 导出/备份的“落盘”策略从 `chrome.downloads` 抽象出来（Safari/iOS 友好）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-core.js`（目前存在 `chrome.downloads.download`）
- Create: `Extensions/WebClipper/src/shared/save-file.js`（或放到现有 shared/utils 中）
- Modify: `Extensions/WebClipper/manifest.json`（Safari 目标移除 `downloads` permission）

**Step 1: 实现**
- 把导出入口统一改为调用 `saveFile({ content, fileName, mimeType, tabId? })`：
  - 优先策略：创建 `Blob` -> `URL.createObjectURL` -> `<a download>` 点击（多数桌面可用）
  - iOS/Safari 降级：无法 `download` 时，改为打开 `data:` URL 或提示用户“复制到剪贴板”
  - 允许后续扩展：如果启用 `sendNativeMessage`，可走“交给宿主 App 分享/保存”
- Safari 目标 manifest patch：移除 `downloads` 权限。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run build:safari`
- Manual（macOS Safari）：导出 Markdown/JSON 至少一种方式可用（不要求体验完美，但要闭环）。
- Manual（iOS Safari）：导出至少一种方式可用（分享/打开/复制其一）。

### Task 5: `scripting.executeScript` 注入与 activeTab 在 Safari 的可行性验证

**Files:**
- Read: `Extensions/WebClipper/src/collectors/web/article-fetch-service.js`
- (Potential) Modify: `Extensions/WebClipper/src/collectors/web/article-fetch-service.js`
- (Potential) Modify: `Extensions/WebClipper/manifest.json`

**Step 1: 实施**
- 先不改逻辑，做 Safari 侧验证点：
  - “Fetch current article” 在 macOS Safari 是否能工作
  - 在 iOS Safari 是否能工作（很可能限制更多）
- 若 Safari 不稳定：
  - 改成“常驻 content script（仅在用户允许的域名）+ message 触发抽取”
  - 或改成“只支持明确站点，不做任意网页 Readability 抽取”

**Step 2: 验证**
- Manual：macOS Safari + iOS Safari 逐端验证按钮行为与失败提示是否可理解。

---

## P2：生成并跑通 iOS + macOS Safari Web Extension 工程

### Task 6: iOS 壳 App + iOS Extension 工程生成（packager）

**Files:**
- Create: `Extensions/WebClipper/xcode/` 下的 iOS 工程目录（由工具生成）

**Step 1: 实施**
- Run:
  - `npm --prefix Extensions/WebClipper run build:safari`
  - `xcrun safari-web-extension-packager --project-location Extensions/WebClipper/xcode --app-name "SyncNos Web Clipper" --bundle-identifier com.chiimagnus.syncnos.webclipper.ios --swift --copy-resources --ios-only --no-open Extensions/WebClipper/dist-safari`
- 产物预期：生成包含 iOS App + iOS Extension 的 Xcode 工程（结构可参考 `obsidian-clipper-main/xcode` 的 iOS 部分）。

**Step 2: 验证**
- Run: `xcodebuild -list -project "<生成的 .xcodeproj 路径>"`
- Expected: 能看到 iOS 的 scheme/targets。

### Task 7: macOS 在现有 `SyncNos.xcodeproj` 新增 Safari Web Extension target 并嵌入

**Files:**
- Modify: `SyncNos.xcodeproj`（新增 target 的工程改动）
- Modify: `SyncNos/`（宿主 App 侧的引导 UI/按钮若需要）
- (Potential) Modify: `SyncNos/SyncNos.entitlements`（如需要新增能力）

**Step 1: 实施**
- 在 Xcode 中打开 `SyncNos.xcodeproj`：
  - `File > New > Target... > Safari Web Extension`
  - 选择嵌入到现有 `SyncNos`（macOS App）
  - 扩展资源指向 `Extensions/WebClipper/dist-safari`（Debug 可引用，Release 固化）
- Run `SyncNos`，按引导在 Safari Settings 启用扩展。
- 用 Safari 打开支持站点，确认 content script/popup/background 都在跑（Safari 的 Develop 菜单可协助调试）。

**Step 2: 验证**
- Manual：完成一次“采集 -> popup 列表可见 -> 删除可用”。

### Task 8: Xcode 运行调试打通（iOS Safari）

**Files:**
- Modify: 生成工程中的 iOS App/Extension 配置（Signing、Bundle ID、资源引用）

**Step 1: 实施**
- 用真机（优先）运行 iOS App，按引导到系统设置启用 Safari 扩展（iOS 模拟器对 Safari 扩展支持可能不足，按实际情况调整）。

**Step 2: 验证**
- Manual：在 iOS Safari 打开支持站点，确认扩展能工作（至少 popup 打开、列表可见）。

---

## P3：上架准备（稳定性、审核材料、发布链路）

### Task 9: Safari 平台专项回归清单

**Files:**
- (Optional) Create: `.github/docs/safari-release-checklist.md`（若需要单独 checklist）

**Step 1: 实施**
- macOS Safari：采集、删除、导出、Notion OAuth、Notion 同步、文章抓取（若保留）
- iOS Safari：采集、删除、导出（至少一种闭环）、Notion OAuth、Notion 同步

**Step 2: 验证**
- Manual：每项都有可见成功结果或可理解失败提示（禁止“无反馈失败”）。

### Task 10: App Store 审核材料与隐私说明准备

**Files:**
- (Optional) Create: `.github/docs/appstore-review-notes-webclipper.md`

**Step 1: 实施**
- 准备“审核备注模板”：
  - 扩展用途（抓取哪些站点、抓取什么内容）
  - 权限范围（为什么需要这些 host 权限）
  - 数据流向（本地 IndexedDB/storage；联网仅 Notion OAuth/Notion API；是否包含个人数据）
  - 用户控制（如何关闭扩展/关闭权限/清理本地数据/断开 Notion）

**Step 2: 验证**
- 人工检查：备注可直接复制到 App Store Connect，不含敏感信息/不夸大能力。

### Task 11: Archive + 上传前的自动化构建验证

**Files:**
- N/A

**Step 1: 实施**
- Run（按生成工程实际 scheme 名称替换）：
  - `xcodebuild -scheme "<macOS scheme>" -configuration Release build`
  - `xcodebuild -scheme "<iOS scheme>" -configuration Release -destination 'generic/platform=iOS' build`

**Step 2: 验证**
- Expected: 两端 Release 构建通过，无缺失资源、无签名/Bundle ID 配置错误。

---

## 备注：优先级与回滚策略

- P1 先保证“Safari 可闭环”再进入 P2 打包上架；否则 Xcode 侧只会放大问题定位成本。
- 每完成一个 Task，建议至少跑一次：
  - `npm --prefix Extensions/WebClipper run test`
  - `npm --prefix Extensions/WebClipper run build:safari`
