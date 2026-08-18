# SyncNos CLI

[English](README.md)

SyncNos CLI 是 SyncNos 的按需本地 SQLite 配套工具。它不会作为守护进程常驻运行，不会把数据同步到远端，也不会在命令或 Native Host 会话结束后继续驻留。

```bash
npm install -g @chiimagnus/syncnoscli
```

给 AI 的提示词：`请你安装SyncNos CLI：npm install -g @chiimagnus/syncnoscli`

需要 Node.js 22 或更高版本。启用 Local data 后，数据库使用固定的当前用户路径：macOS/Linux 为 `~/.syncnoscli/syncnos.sqlite`，Windows 为 `%USERPROFILE%\.syncnoscli\syncnos.sqlite`。

每次调用 CLI 都是按需启动，并在命令结束后退出。浏览器 Native Messaging 只会在需要时启动随包提供的 Host；浏览器管道关闭后，Host 也会退出。数据命令均为只读：不会创建、迁移、删除或修改数据库。`doctor` 默认只读；只有显式提供 `--fix` 时才会执行修复，而且 `--fix` 仅限于已经确认属于 SyncNos 的注册信息/权限修复。

```bash
syncnoscli doctor [--fix]
syncnoscli conversations list [--cursor <cursor>] [--source <source>] [--site <site>] [--page-size <1-200>] [--format json|table]
syncnoscli conversations get <id>
syncnoscli stats
syncnoscli search <query> [--cursor <cursor>] [--source <source>] [--site <site>] [--sort best|recent] [--page-size <1-50>] [--format json|table]
```

数据命令成功时默认输出带版本号的 JSON envelope。`list` 和 `search` 在终端中读取时可以使用 `--format table`；错误始终保持结构化 JSON，并以非零退出码结束。CLI 不接受 SQL、写入、删除、provider sync、远程/向量搜索或自定义数据库路径命令。

CLI 包拥有独立的语义化版本，不要求与 WebClipper/WXT 版本一致。兼容性由同一源代码 commit 中发布的 canonical Native Host protocol/schema contract 定义。

发布流程与浏览器发布刻意分离。仓库 owner 必须手动 dispatch 受保护的 npm publish workflow，并提供精确的 package version 和 confirmation string；最终 publish job 还需要 repository environment approval，以及 npm Trusted Publishing/OIDC。普通 CI、安装、浏览器 release/prerelease 和应用商店 workflow 都不会发布这个包。

架构与存储权威说明：[`docs/storage.md`](../../docs/storage.md)。安装、Native Host、sandbox 与恢复指南：[`docs/troubleshooting.md`](../../docs/troubleshooting.md#local-database)。
