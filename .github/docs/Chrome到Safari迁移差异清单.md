# Chrome 到 Safari 迁移差异清单（WebClipper）

> 目标：将 `Extensions/WebClipper` 转为 Safari Web Extension，并通过 Xcode 随 macOS 宿主 App 提交 Mac App Store。

## 0. 当前状态与结论

- 当前 `SyncNos.xcodeproj` 仅有 `SyncNos` target，尚未包含 Safari Web Extension target。
- 现有 `manifest.json` 使用 `downloads`、`webNavigation`、`scripting`，其中 `downloads` 在 Safari 转换阶段已出现不支持警告。
- 结论：当前状态不能直接提交 App Store，需要先完成 Safari 兼容改造与 Xcode 集成。

## 1. 打包与工程形态差异

- Chrome/Edge/Firefox：直接基于 `manifest.json` 产物发布（`dist` / `.xpi`）。
- Safari：必须由 Xcode 承载。
  - 宿主 App（macOS）
  - Safari Web Extension（`.appex`）
  - 扩展资源随 App 打包并签名

落地动作：
1. 在现有工程中新增 Safari Web Extension target（不新建独立仓库）。
2. 建立 WebClipper 资源拷贝/引用策略（Debug 引用源码，Release 固化资源）。
3. 将 Extension target 嵌入 `SyncNos` 的发布流程（Archive/Upload）。

## 2. API 差异与改造方案（P0）

| API | 当前用途 | Safari 风险 | 改造方案 |
|---|---|---|---|
| `chrome.downloads` | 导出 JSON/Markdown/ZIP、备份导出 | 不支持/行为不一致 | 抽象 `saveFile()`：优先使用 Safari 可用下载策略；失败时回退为“复制到剪贴板 + 用户保存”或“交由宿主 App 保存”。 |
| `chrome.webNavigation.onCommitted` | Notion OAuth 回调拦截 | 触发时机/过滤行为不稳定 | 改为回调页主动 `runtime.sendMessage` 传 `code/state`；后台只做 `state` 校验与换 token。 |
| `chrome.scripting.executeScript` | on-demand 文章抓取注入 Readability | 注入能力与授权路径需验证 | 优先“常驻 content script + message 抽取”，减少运行时注入依赖。 |
| `chrome.*` 直连 | 全局 API 使用分散 | 平台分支扩散 | 增加 `browserApi` 适配层，隔离平台差异。 |

## 3. 权限与 Host Permissions（P0）

当前风险：
- 存在 `http://*/*` 和 `https://*/*` 全站权限，审核风险高。

改造原则：
1. 默认最小权限：仅保留真实支持站点 + Notion API + OAuth 域名。
2. “任意网页抓取”改为显式用户触发能力，不在默认全站注入。
3. 权限申请和失败提示在 UI 中可解释（用户知道为什么要授权）。

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

## 6. Xcode 集成与上架流程（P0）

1. 在 `SyncNos.xcodeproj` 新增 Safari Web Extension target，并嵌入 `SyncNos`。
2. 配置 Bundle Identifier（App 与 Extension 分离命名，保持团队签名一致）。
3. 完成签名与发布配置（Debug/Release）。
4. 归档并上传到 App Store Connect。
5. 在审核备注中说明扩展用途、访问网站范围、数据流向（本地存储/Notion 同步）。

## 7. 功能验收矩阵（提审前必须通过）

1. 自动采集：各已支持站点稳定写入会话与消息。
2. popup UI：列表、删除、预览、筛选功能正常。
3. 导出/备份：JSON/Markdown/ZIP、备份导出/导入全链路可用（含失败提示）。
4. OAuth：连接、回调、断连、重连、异常重试可用。
5. Notion 同步：可成功创建/更新页面，失败可见且可重试。
6. 文章抓取：授权、抽取、保存流程可用。
7. 升级兼容：旧数据不丢失，字段迁移正确。

## 8. 实施顺序（建议）

1. P0：API 兼容层 + `downloads`/OAuth/权限策略改造。
2. P0：Xcode 接入 Safari Web Extension target，打通本地运行。
3. P1：存储迁移与边界场景验证。
4. P1：提审材料与审核备注完善。

## 9. 完成定义（Definition of Done）

- `SyncNos` 可在 Safari 中启用扩展并完成主流程。
- 不依赖 Safari 不支持 API。
- 权限声明与实际功能一致且最小化。
- 通过本地构建、手工回归、Archive 上传检查。
