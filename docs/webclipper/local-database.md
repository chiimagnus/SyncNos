# WebClipper Local Database

本页只负责 browser profile 在 WebClipper 中启用、join、迁移与恢复 Local Database 的操作语义。CLI 安装、`doctor` 与 Native Host 修复见 [`../cli/local-database.md`](../cli/local-database.md)；共享 authority、安全与搜索契约见 [`../storage.md`](../storage.md)。

## 启用与 join

安装 SyncNos CLI 不会自动启用 Local Database。必须在 **Settings → Backup → Local Database** 中由当前 browser profile 明确选择开始迁移，或在发现既有健康 SQLite 时明确 join；磁盘上存在数据库本身不是授权。

新的 browser profile 没有 migration journal 时保持 `not_started` / `idb-v1`。扩展重装、换 profile 或 profile-local journal 丢失后，即使固定 SQLite 仍存在，也必须重新显式 join。

## 恢复

| 现象 | 正确处理 |
| --- | --- |
| CLI / Native Host missing | 先确认 global CLI 安装，再运行 `syncnoscli doctor`；仅在诊断要求时使用 `doctor --fix`。 |
| `DATABASE_NOT_INITIALIZED` | 回到 **Settings → Backup → Local Database** 显式开始或 join；CLI 只读数据命令不会替 profile 创建 facts 数据库。 |
| `BUSY` / lock | 等正在进行的 migration、capture 或 transaction 完成后重试；不要删除 WAL/SHM。 |
| permission / owner state 异常 | 先运行 `doctor`；不要 `chmod -R`、改 ACL 继承、迁移数据库目录或手改 registration。 |
| migration interrupted | 回到 Local Database UI 重新检测；只有 UI 明确提供 Resume 时继续，不手工清 IDB/SQLite 或伪造 journal。 |
| 扩展重装 / 更换 profile | 即使固定 SQLite 仍存在，新 profile 也必须重新显式 join。 |

浏览器不得因为 Host、FTS 或 migration 错误偷偷回退到另一套 facts authority。具体 journal 状态和数据边界见 [`../storage.md`](../storage.md)。
