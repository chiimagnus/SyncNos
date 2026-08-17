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

Linux 只承诺 stable desktop Chrome/Edge/Firefox 能读取各自官方的 **per-user NativeMessagingHosts** 位置。严格 Snap/Flatpak sandbox 若隔离了 Host，需要的是尚未实现的 portal integration；`doctor`、手写 wrapper/path 或 `flatpak-spawn` 都不能把这条未实现边界变成受支持方案。

Safari 的 canonical contract 明确 `localDataSupported: false`，没有 Local Database action，也没有 Native Messaging permission。development/custom extension ID 同样没有 Local Database 注册绕过路径。

不要直接编辑 SyncNos SQLite schema/SQL、Windows registry、Native Host manifest/allowlist、`.syncnoscli` 固定路径或 migration journal；这些都会绕过 ownership/identity 校验，并可能把可恢复状态变成冲突状态。

### npm 发布（repository owner）

首次公开发布 `@chiimagnus/syncnoscli` 前，owner 需要在 npm 外部确认 `@chiimagnus` scope/registry 状态，并为 GitHub repository 配置 npm Trusted Publisher：workflow filename 必须是 `syncnoscli-publish.yml`，environment 必须与 `syncnoscli-npm-publish` 精确一致，并只授权 `npm publish`。仓库不保存长期 publish credential。

`.github/workflows/syncnoscli-publish.yml` 只能手工 `workflow_dispatch`，要求输入 package version 和精确 confirmation，先验证 Windows PE provenance、tarball install 与 `npm publish --dry-run --access public`，最后在受保护 repository environment 审批后才允许 `npm publish --provenance --access public`。这份 workflow 的存在不是发布授权；每次真实 publish 都需要 owner 当次显式触发和 environment approval。

如果 Trusted Publisher/OIDC 尚未配置，发布必须失败关闭；不要临时向 workflow 填长期 publish credential，也不要从 normal CI、browser release/prerelease 或 Chrome/Edge/AMO store workflow 调用 npm publish。

## 评论精确定位

在 App DevTools Console 设置 `localStorage.setItem('__SYNCNOS_DEBUG_COMMENTS_SELECTION__', '1')` 后重载，复现时检查 `[CommentsSelection][app]` 和 `[CommentsLocate]`。依次确认 surface root、exact/context、context generation，以及是否属于 iframe、closed shadow root 或跨 root 歧义。失败必须保留明确 reason；不要用模糊匹配或滚动兜底。

## Zen

使用 `npm run build:zen` 生成本地测试 XPI。`FIREFOX_EXTENSION_ID` override **只属于本地 Zen test XPI**，`WXT_ZEN_BINARY` 只用于指定本地测试浏览器；release packager 明确拒绝这个 identity override。自定义 Gecko ID 不进入 canonical Native Host allowlist，也不能获得 Local Database action。仅本地测试 profile 才可关闭 unsigned XPI 的签名要求，不能作为发行或 Local mode 绕过方案。
