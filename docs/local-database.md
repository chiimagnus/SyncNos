# Local Database

本页只负责 **安装、启用、诊断与恢复**。数据 authority、SQLite 固定位置、迁移事务与搜索安全边界见 [storage.md](storage.md)；CLI 命令面见 [`packages/syncnoscli/README.md`](../packages/syncnoscli/README.md)。

## 安装与启用

SyncNos CLI 需要 Node.js 22 或更高版本：

```bash
npm install -g @chiimagnus/syncnoscli
syncnoscli doctor
```

给 AI 的安装提示词固定为：`请你安装SyncNos CLI：npm install -g @chiimagnus/syncnoscli`。

安装 CLI 不会自动启用 Local Database。必须在 **Settings → Backup → Local Database** 中由当前 browser profile 明确选择开始迁移，或在发现既有健康 SQLite 时明确 join；磁盘上存在数据库本身不是授权。

## `doctor` 与修复边界

`syncnoscli doctor` 只读检查 CLI、Native Host registration、数据库兼容性和受支持的权限状态。只有诊断明确要求时才运行：

```bash
syncnoscli doctor --fix
```

`--fix` 只修复可证明属于当前 SyncNos CLI 的 Native Host registration 和受支持的 owner-only 文件权限。它不会创建或迁移 conversation facts、删除 SQLite、修改 Host allowlist、伪造 browser identity，也不能突破操作系统 sandbox。

## 恢复

| 现象 | 正确处理 |
| --- | --- |
| CLI / Native Host missing | 重新确认 global CLI 安装，然后运行 `syncnoscli doctor`；仅在诊断要求时使用 `doctor --fix`。 |
| `DATABASE_NOT_INITIALIZED` | 回到 **Settings → Backup → Local Database** 显式开始或 join；CLI 只读数据命令不会替你创建 facts 数据库。 |
| `BUSY` / lock | 等正在进行的 migration、capture 或 transaction 完成后重试；不要删除 WAL/SHM。 |
| permission / owner state 异常 | 先运行 `doctor`；不要 `chmod -R`、改 ACL 继承、迁移数据库目录或手改 registration。 |
| migration interrupted | 回到 Local Database UI 重新检测；只有 UI 明确提供 Resume 时继续，不手工清 IDB/SQLite 或伪造 journal。 |
| 扩展重装 / 更换 profile | 即使固定 SQLite 仍存在，新 profile 也必须重新显式 join。 |

## 浏览器与 Native Messaging

正式 Local Database 只接受 canonical browser identity。Chrome/Edge/Firefox 及其兼容派生浏览器能否工作，取决于该浏览器是否实际读取 CLI 已注册的 Native Messaging 位置；物理路径清单以 CLI 实现和 `doctor` 结果为准，文档不复制维护。

- development / unpacked / custom extension ID 不进入 Native Host allowlist。
- Safari 的 canonical contract 为 `localDataSupported: false`，不提供 Local Database action。
- 严格 Snap/Flatpak sandbox 如果隔离 Native Messaging，需要尚未实现的 portal integration；`doctor --fix`、wrapper 或 `flatpak-spawn` 不能把这条边界变成受支持方案。
- “能安装 Chrome/Firefox 扩展”本身不能证明该浏览器支持 SyncNos Native Messaging。

不要直接编辑 SyncNos SQLite schema/SQL、Windows registry、Native Host manifest/allowlist、`.syncnoscli` 固定目录或 migration journal；这些操作会绕过 ownership/identity 校验，并可能把可恢复状态变成冲突状态。
