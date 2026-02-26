# Chrome 到 Safari 迁移差异清单（WebClipper，iOS + macOS）

> 目标：将 `Extensions/WebClipper` 转为 Safari Web Extension，并通过 Xcode 同时随：
> - macOS 宿主 App 提交 Mac App Store
> - iOS 宿主 App 提交 iOS App Store
>
> 约束：Safari Web Extension 不能“单独上架”，必须打包在宿主 App 内发布（macOS/iOS 都是如此）。

## 0. 当前状态与结论

- 当前 `SyncNos.xcodeproj` 仅有 `SyncNos`（macOS）target，尚未包含 Safari Web Extension target（macOS/iOS 都没有）。
- `Extensions/WebClipper/manifest.json` 目前包含高风险项：
  - `permissions` 含 `downloads`（Safari Web Extension 不支持或行为不一致，尤其 iOS）
  - `host_permissions` 含 `http://*/*` 和 `https://*/*`（审核风险很高）
  - 背景侧依赖 `webNavigation`、`scripting.executeScript`（需要做 Safari 可用性验证与降级）
- 结论：以当前状态无法直接走 Xcode 打包并通过 iOS/macOS App Store 审核；必须先完成“Safari 目标工程形态 + 权限收敛 + 关键 API 降级/替换”。

## 1. 打包与工程形态差异

- Chrome/Edge/Firefox：直接基于 `manifest.json` 产物发布（`dist` / `.xpi`）。
- Safari：必须由 Xcode 承载。
  - 宿主 App（macOS `.app`、iOS `.app`）
  - Safari Web Extension（平台分别是 `.appex`：macOS Extension / iOS Extension）
  - 扩展资源随 App 打包并签名

建议工程落地（参考 `obsidian-clipper-main/xcode` 的结构）：
1. 在 Xcode 中新增目标（targets）：
   - `macOS App`（现有 `SyncNos` 可复用）
   - `macOS Safari Web Extension`
   - `iOS App`（可做最小壳，用于承载扩展与引导用户开启）
   - `iOS Safari Web Extension`
2. 为两端扩展建立统一的“扩展资源来源”策略：
   - Debug：尽量引用 `Extensions/WebClipper/src`（或 build 后的 `dist-safari`）以便快速调试
   - Release：固化到 Xcode target 的 Copy Bundle Resources，保证归档可复现
3. 将两端 Extension target 都嵌入各自宿主 App 的发布流程（Archive/Upload），并在 App Store Connect 分别提交 iOS 与 macOS 版本。

## 2. 可复用代码范围（结论）

大部分 WebClipper 代码可以直接复用到 Safari 版本，推荐保持“同一套 JS/HTML/CSS 代码”：
- 可直接复用（占大头）：
  - `Extensions/WebClipper/src/**` 里的 collectors、存储（IndexedDB + `storage.local`）、popup UI、Notion 同步逻辑、消息协议
  - 站点匹配与内容脚本（content scripts）整体思路
- 需要做平台适配/改造（集中在少数边界能力）：
  - `chrome.downloads` 相关的导出/备份落盘
  - `webNavigation` 监听式 OAuth 回调
  - `scripting.executeScript` 运行时注入（尤其 iOS 上的授权/时机差异）
  - 权限模型（特别是全站 `*://*/*`）
  - 如果要依赖宿主 App 能力：需要补 `browser.runtime.sendNativeMessage` 对接 Swift Handler（参考 `obsidian-clipper-main/xcode/.../SafariWebExtensionHandler.swift`）

## 2. API 差异与改造方案（P0）

| API | 当前用途 | Safari 风险 | 改造方案 |
|---|---|---|---|
| `chrome.downloads` | 导出 JSON/Markdown/ZIP、备份导出 | 不支持/行为不一致 | 抽象 `saveFile()`：优先使用 Safari 可用下载策略；失败时回退为“复制到剪贴板 + 用户保存”或“交由宿主 App 保存”。 |
| `chrome.webNavigation.onCommitted` | Notion OAuth 回调拦截 | 触发时机/过滤行为不稳定 | 改为回调页主动 `runtime.sendMessage` 传 `code/state`；后台只做 `state` 校验与换 token。 |
| `chrome.scripting.executeScript` | on-demand 文章抓取注入 Readability | 注入能力与授权路径需验证 | 优先“常驻 content script + message 抽取”，减少运行时注入依赖。 |
| `chrome.*` 直连 | 全局 API 使用分散 | 平台分支扩散 | 增加 `browserApi` 适配层，隔离平台差异。 |

补充：iOS 侧的“文件导出”通常比 macOS 更受限，务必预留两条路：
1. 纯前端降级：`data:` URL + 新开页面 + 用户手动“分享/存储”（以及可用时用 `navigator.share`）
2. 宿主 App 承担落盘：扩展通过 `runtime.sendNativeMessage` 把内容交给宿主 App（App 再通过系统能力保存/分享）

## 3. 权限与 Host Permissions（P0）

当前风险：
- 存在 `http://*/*` 和 `https://*/*` 全站权限，审核风险高。

改造原则：
1. 默认最小权限：仅保留真实支持站点 + Notion API + OAuth 域名。
2. “任意网页抓取”改为显式用户触发能力，不在默认全站注入。
3. 权限申请和失败提示在 UI 中可解释（用户知道为什么要授权）。

建议动作（更具体一点）：
1. 从 `manifest.json` 移除默认的 `http://*/*`、`https://*/*` 内容脚本注入；把“Web Article Clipper”改为“用户点按钮后仅对当前 Tab 生效”。
2. 如果确实需要全站抓取：把它做成“可选能力”，并准备好审核解释（为什么需要全站、数据如何使用、如何让用户关闭）。

## 4. OAuth 流程改造（P0）

当前流程依赖 `webNavigation` 监听重定向 URL。

目标流程：
1. 用户在 popup 中点击连接 Notion，打开授权页。
2. 回调页（`redirectUri`）解析 `code/state`。
3. 回调页调用扩展消息通道上报 `code/state`。
4. background 校验 `pending_state` 后调用 worker 兑换 token。
5. 写入 token 存储并更新 UI 状态。

必做兜底：
- 增加回调失败提示（state 不匹配、网络超时、token 交换失败）。
- 保留重试入口，不要求用户手动清理存储。

## 5. 存储与数据层验证（P1）

- IndexedDB：
  - 首次安装建库
  - 升级迁移
  - 大数据量读写
  - 隐私模式行为
- `storage.local`：
  - token/配置持久化
  - 扩展重启后恢复
  - 升级兼容（旧字段迁移）

## 6. Xcode 集成（iOS + macOS）与上架流程（P0）

1. 在 `SyncNos.xcodeproj`（或新建 workspace 统一管理）新增：
   - macOS Safari Web Extension target，并嵌入 `SyncNos`（macOS）
   - iOS App target（最小壳）与 iOS Safari Web Extension target，并完成嵌入
2. 配置 Bundle Identifier：
   - App 与 Extension 必须分离命名
   - iOS 与 macOS 可以是同一套 App 名称，但 Bundle ID 需按平台区分（例如 `com.xxx.syncnos` / `com.xxx.syncnos.ios`，以及对应的 `.extension`）
3. 确保两端签名一致（同一 Team），并补齐能力（Capabilities）：
   - Safari Web Extension（Xcode 会生成对应 entitlements/Info.plist 键）
   - 如需 App Group/Keychain 共享（例如 App 与 Extension 共享 token/配置）：先明确数据边界再开
4. 资源集成策略：
   - 建议新增 `dist-safari` 作为 Safari 侧的 build 输出目录（当前目录存在但未产出实际 bundle）
   - Xcode Extension target 引用该目录作为 Resources（或拷贝进 target）
5. 归档与上传：
   - macOS：Archive `SyncNos`（macOS）并上传
   - iOS：Archive iOS App 并上传
6. 审核材料（两端都需要准备）：
   - 扩展用途说明：采集哪些站点、采集什么内容、保存到哪里
   - 权限范围说明：为什么需要这些 host 权限
   - 数据流向说明：本地存储、何时联网（Notion OAuth/Notion API）、是否含个人数据
   - 若含“任意网页抓取”：必须解释用户触发方式与关闭方式

## 7. 功能验收矩阵（提审前必须通过）

1. 自动采集：各已支持站点稳定写入会话与消息。
2. popup UI：列表、删除、预览、筛选功能正常。
3. 导出/备份：JSON/Markdown/ZIP、备份导出/导入全链路可用（含失败提示）。
4. OAuth：连接、回调、断连、重连、异常重试可用。
5. Notion 同步：可成功创建/更新页面，失败可见且可重试。
6. 文章抓取：授权、抽取、保存流程可用。
7. 升级兼容：旧数据不丢失，字段迁移正确。

补充：iOS 侧专项验收（至少覆盖）
1. 扩展开启引导：用户能从 iOS App 的引导进入系统设置并开启 Safari 扩展。
2. 导出体验：在 iOS 上导出/备份不依赖不可用 API（确保有“分享/复制/宿主 App”至少一种闭环）。
3. 后台任务：长任务在 iOS 上不会因扩展生命周期更短而悄悄中断（至少有可见失败与可重试）。

## 8. 实施顺序（建议）

1. P0：API 兼容层 + `downloads`/OAuth/权限策略改造。
2. P0：Xcode 接入 Safari Web Extension target（macOS + iOS），打通本地运行（两端都要跑通）。
3. P1：存储迁移与边界场景验证。
4. P1：提审材料与审核备注完善。

## 9. 完成定义（Definition of Done）

- macOS Safari 与 iOS Safari 中都可启用扩展并完成主流程（采集、本地存储、导出/备份至少一种闭环、Notion OAuth + 同步）。
- 不依赖 Safari 不支持 API。
- 权限声明与实际功能一致且最小化。
- 通过本地构建、手工回归、两端 Archive 上传检查（App Store Connect 处理通过）。
