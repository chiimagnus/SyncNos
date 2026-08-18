# 排障

先运行 `npm ci` 和 `npm run gate:ci`。manifest、权限、发布构建或产物问题再运行 `npm run gate`；仅检查默认浏览器产物可运行 `npm run check`。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| `npm ci` 失败 | Node/npm 版本与 lockfile 是否匹配。 |
| Vitest 不退出 | 未释放的 timer、listener 或 React root；超时不是 PASS。 |
| manifest/version 发布失败 | `wxt.config.ts`、tag 和 workflow 的版本校验。 |
| OAuth Connect 无响应 | client id、redirect URI、pending state、Worker endpoint 和浏览器日志。 |
| article 只有文本没有图片 | 图片设置、anti-hotlink rule、referer 与下载 warning；文本成功仍是成功。 |
| 视频提示没有字幕 | 先在页面开启并等待字幕请求加载，再 capture。 |

## Local Database

SyncNos CLI 需要 Node.js 22 或更高版本。安装/更新命令只有：`npm install -g @chiimagnus/syncnoscli`。给 AI 的固定提示词是 `请你安装SyncNos CLI：npm install -g @chiimagnus/syncnoscli`。Local Database 的固定数据位置与 authority 模型见 [storage.md](storage.md)；不要为排障发明第二个数据库位置。

先运行 `syncnoscli doctor` 做只读诊断；只有需要修复已证明属于当前 global CLI 的 Native Host registration 或受支持的 owner-only 数据库权限时，才运行 `syncnoscli doctor --fix`。`doctor --fix` 不会创建/迁移 conversation 数据、删除 SQLite、改 Host allowlist，也不能把非正式扩展身份变成官方身份。

| 现象 | 处理 |
| --- | --- |
| CLI/Host missing | 确认 global CLI 安装成功，再运行 `syncnoscli doctor`；需要修复时才用 `syncnoscli doctor --fix`。不要手改 NativeMessagingHosts manifest、Windows registry、launcher wrapper 或 allowlist。 |
| `DATABASE_NOT_INITIALIZED` | CLI 是只读数据入口，不能替你创建数据库。回到 **Settings → Backup → Local Database**，按 UI 明确启用或显式 join。 |
| `BUSY` / lock | 等正在进行的 SyncNos migration/capture/transaction 完成后重试；不要删除 WAL/SHM，也不要用外部 SQLite 工具强行解锁。 |
| permission / owner state 异常 | 先 `syncnoscli doctor`，再在诊断要求时运行 `doctor --fix`；不要 `chmod -R`、改 ACL 继承或迁移数据库目录。 |
| migration interrupted | 重新打开 **Settings → Backup → Local Database** 并“重新检测”；只有 UI 明确提供 Resume 时继续。不要手工清 IDB/SQLite 或伪造 journal。 |
| CLI/扩展卸载后重装 | 数据库不是 profile 授权。browser profile 的 journal 丢失或换 profile 后，即使固定 SQLite 仍存在，也必须重新显式 join，绝不自动认领 active。 |

Native Host 注册按**浏览器实际读取的物理位置**维护，而不是按品牌重复造一份协议。Chromium family 的 manifest 始终只允许 SyncNos 的 Chrome Web Store ID 与 Edge Add-ons ID；Firefox family 始终只允许 canonical Gecko ID。development/unpacked/custom ID 不进入 allowlist。

| 浏览器 / family | Local Database 注册策略 |
| --- | --- |
| Chrome Stable/Beta/Dev/Canary、Chrome for Testing、Chromium | 注册各自已知的 per-user `NativeMessagingHosts` 位置；Windows 使用 Chrome/Chromium registry。 |
| Edge Stable/Beta/Dev，macOS Edge Canary | 注册 Edge 的 per-user 位置；Windows 使用 Edge registry。Chromium manifest 同时包含 Chrome Web Store 与 Edge Add-ons 两个正式 ID。 |
| Brave | macOS 复用 Brave 自身指向的 Chrome Native Messaging 位置；Linux 另覆盖 `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts`；Windows 由 Chrome-compatible registration 覆盖。 |
| Vivaldi | macOS/Linux 注册 Vivaldi 的用户级位置；Windows 保留 Chrome-compatible registration，不额外制造未经证明的 key。Snap/Flatpak 版 NativeMessaging API 不可用。 |
| Arc | macOS 覆盖 `~/Library/Application Support/Arc/User Data/NativeMessagingHosts`；其他平台只有在其实际读取已注册 Chromium位置时才算可用，不伪报已验证。 |
| Helium | macOS/Linux 覆盖 `net.imput.helium` 用户数据目录下的 `NativeMessagingHosts`；Windows 只有实际读取现有 Chromium/Chrome registry 时才算可用。 |
| Opera / Opera GX | Opera 官方 Native Messaging 使用 Chrome host registration，因此 macOS/Windows 由 Chrome registration 覆盖；Linux 官方位置是 system-wide `/etc/opt/chrome/native-messaging-hosts`，当前 user-level CLI 不用 sudo 写入该目录。 |
| Firefox（含 ESR/Developer/Nightly 等共享 Mozilla 注册的 channel）、Zen | 使用 Mozilla 标准 Native Messaging 位置和 canonical Gecko ID；Zen 在 Linux 也实际读取 `~/.mozilla/native-messaging-hosts`。 |
| LibreWolf、Waterfox | Linux 额外覆盖各自的 `~/.librewolf/native-messaging-hosts`、`~/.waterfox/native-messaging-hosts`；其他平台只有在读取 Mozilla 标准位置时才由 Firefox registration 覆盖。 |
| Tor Browser | macOS 覆盖固定 Tor Browser 用户位置；Windows 可由 Mozilla registry 覆盖；Linux 安装布局随安装器/locale 变化，不硬编码一个会误导用户的伪路径。 |
| Iridium | Linux 覆盖 `~/.config/iridium/NativeMessagingHosts`；其他平台未验证独立 Host 位置。 |
| Safari | canonical contract 明确 `localDataSupported: false`，不提供 Local Database action。 |
| Orion | 虽支持大量 Chrome/Firefox WebExtensions API，但官方当前没有 `nativeMessaging` 支持/Host 位置证据，因此不宣称 Local Database 可用。 |

“能安装 Chrome/Firefox 扩展”不等于已经证明 Native Messaging 可用。Floorp、Mullvad Browser、Thorium、ungoogled-chromium 等其他派生浏览器，只要实际保留 Chrome/Chromium/Mozilla 已注册位置并使用 SyncNos 的正式商店 ID，就可以复用对应 family；若它们改了 Host 查找位置，则在完成该产品的路径验证之前不列为正式支持。严格 Snap/Flatpak sandbox 若隔离了 Host，需要的是尚未实现的 portal integration；`doctor`、手写 wrapper/path 或 `flatpak-spawn` 都不能把这条未实现边界变成受支持方案。

不要直接编辑 SyncNos SQLite schema/SQL、Windows registry、Native Host manifest/allowlist、`.syncnoscli` 固定路径或 migration journal；这些都会绕过 ownership/identity 校验，并可能把可恢复状态变成冲突状态。

### npm 发布（repository owner）

`@chiimagnus/syncnoscli` 只从 repository owner 本机发布；GitHub Actions 只做跨平台构建与测试，不执行 `npm publish`。CLI 与浏览器插件各自维护自己的版本字段，发布生命周期互不耦合。

发布前先把 `packages/syncnoscli/package.json` 更新为 npm 尚未存在的新 SemVer，并让 lockfile 同步。然后从仓库根目录执行完整 gate，再从 CLI 包目录发布并核对 registry：

```bash
npm run gate
cd packages/syncnoscli
npm whoami
npm publish
npm view @chiimagnus/syncnoscli version
```

npm 登录与 2FA 只保留在 owner 本机，不写入仓库或 GitHub Actions。已经发布过的版本不能覆盖；若 `npm publish --dry-run` 或真实发布只报告该版本已存在，应先更新版本，而不是绕过 registry 保护。

### Local Data release evidence（maintainer）

正式 release readiness 还要求 [`tests/e2e/local-data-release-matrix.md`](../tests/e2e/local-data-release-matrix.md) 的人工证据完成。CI 只验证 schema、三 OS packed CLI、final browser artifact contract 等自动部分，不能用 unpacked/dev extension ID、fake Host 或 repository variable 冒充 Chrome/Edge/Firefox 真机连接。Edge 必须额外由 owner 确认 Partner Center product GUID 对应实际公开 runtime ID；Windows 必须确认 Host 是 PE shim 且 one-shot/disconnect 后 shim 与 Node child 都退出。

matrix 中任何正式 desktop、Safari regression 或 recovery regression 仍为 `pending`/`fail` 时，`releaseReady` 必须保持 `false`。严格 Snap/Flatpak 只能记录为 `unsupported_strict_sandbox` observation，不能作为正式 Linux browser pass。release evidence 与 npm 发布是两条独立流程；CLI npm 发布只由 owner 在本地显式执行。

## 评论精确定位

在 App DevTools Console 设置 `localStorage.setItem('__SYNCNOS_DEBUG_COMMENTS_SELECTION__', '1')` 后重载，复现时检查 `[CommentsSelection][app]` 和 `[CommentsLocate]`。依次确认 surface root、exact/context、context generation，以及是否属于 iframe、closed shadow root 或跨 root 歧义。失败必须保留明确 reason；不要用模糊匹配或滚动兜底。

## Zen

使用 `npm run build:zen` 生成本地测试 XPI。`FIREFOX_EXTENSION_ID` override **只属于本地 Zen test XPI**，`WXT_ZEN_BINARY` 只用于指定本地测试浏览器；release packager 明确拒绝这个 identity override。自定义 Gecko ID 不进入 canonical Native Host allowlist，也不能获得 Local Database action。仅本地测试 profile 才可关闭 unsigned XPI 的签名要求，不能作为发行或 Local mode 绕过方案。
