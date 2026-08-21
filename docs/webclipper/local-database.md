# WebClipper Local Database

本页只负责 browser profile 在 WebClipper 中启用、join、迁移与恢复 Local Database 的操作语义。CLI 安装、`doctor` 与 Native Host 修复见 [`../cli/local-database.md`](../cli/local-database.md)；共享 authority、安全与搜索契约见 [`../storage.md`](../storage.md)。

## 启用与 join

安装 SyncNos CLI 不会自动启用 Local Database。必须在 **Settings → Backup → Local Database** 中由当前 browser profile 明确选择开始迁移，或在发现既有健康 SQLite 时明确 join；磁盘上存在数据库本身不是授权。

新的 browser profile 没有 migration journal 时保持 `not_started` / `idb-v1`。扩展重装、换 profile 或 profile-local journal 丢失后，即使固定 SQLite 仍存在，也必须重新显式 join。

## 恢复

| 现象 | 正确处理 |
| --- | --- |
| CLI / Native Host missing | 先确认 global CLI 安装，再运行 `syncnoscli doctor`；仅在诊断要求时使用 `doctor --fix`。 |
| `DATABASE_NOT_INITIALIZED` | `not_started` 时这是正常的首次启用前状态：回到 **Settings → Backup → Local Database** 显式开始迁移，真正的 migration import 会创建 SQLite；CLI/status 的只读检查仍不会建库。若失败停在 pre-commit `staging`，重新迁移会把“数据库不存在”视为“没有 receipt”，从 IndexedDB 源事实重新完整导入。 |
| `BUSY` / lock | 等正在进行的 migration、capture 或 transaction 完成后重试；不要删除 WAL/SHM。 |
| permission / owner state 异常 | 先运行 `doctor`；不要 `chmod -R`、改 ACL 继承、迁移数据库目录或手改 registration。 |
| migration interrupted | transitional journal 由 background 自动恢复；如果迁移已进入 `failed`，回到 Local Database UI 查看 terminal diagnostic，并显式选择“重新迁移”。没有用户侧 Resume/checkpoint 操作；不要手工清 IDB/SQLite 或伪造 journal。 |
| 扩展重装 / 更换 profile | 即使固定 SQLite 仍存在，新 profile 也必须重新显式 join。 |

浏览器不得因为 Host、FTS 或 migration 错误偷偷回退到另一套 facts authority。`failed` 时普通 facts operation 统一表现为“迁移已停止”，而设置页保留真正的 terminal diagnostic 供排障；不能把底层错误直接当成主页的数据状态。具体 journal 状态和数据边界见 [`../storage.md`](../storage.md)。
