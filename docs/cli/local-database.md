# SyncNos CLI 与 Local Database

本页只负责 CLI 安装、`doctor`、Native Host registration 与本机修复边界。WebClipper 中启用、join 与 migration 的用户流程见 [`../webclipper/local-database.md`](../webclipper/local-database.md)；数据库 authority 与搜索安全契约见 [`../storage.md`](../storage.md)。

## 安装

SyncNos CLI 需要 Node.js 22 或更高版本：

```bash
npm install -g @chiimagnus/syncnoscli
syncnoscli doctor
```

给 AI 的安装提示词固定为：`请你安装SyncNos CLI：npm install -g @chiimagnus/syncnoscli`。

安装 CLI 只安装命令、Native Host 和注册生命周期，不会替任何 browser profile 自动启用 Local Database。

## `doctor` 与修复边界

`syncnoscli doctor` 只读检查 CLI、Native Host registration、数据库兼容性和受支持的权限状态。只有诊断明确要求时才运行：

```bash
syncnoscli doctor --fix
```

`--fix` 只修复可证明属于当前 SyncNos CLI 的 Native Host registration 和受支持的 owner-only 文件权限。它不会创建或迁移 conversation facts、删除 SQLite、修改 Host allowlist、伪造 browser identity，也不能突破操作系统 sandbox。

## Native Messaging 边界

正式 Local Database 只接受 canonical browser identity。Chrome/Edge/Firefox 及其兼容派生浏览器能否工作，取决于该浏览器是否实际读取 CLI 已注册的 Native Messaging 位置；物理路径清单以 CLI 实现和 `doctor` 结果为准，文档不复制维护。

- development / unpacked / custom extension ID 不进入 Native Host allowlist。
- Safari 的 canonical contract 为 `localDataSupported: false`，不提供 Local Database action。
- 严格 Snap/Flatpak sandbox 如果隔离 Native Messaging，需要尚未实现的 portal integration；`doctor --fix`、wrapper 或 `flatpak-spawn` 不能把这条边界变成受支持方案。
- “能安装 Chrome/Firefox 扩展”本身不能证明该浏览器支持 SyncNos Native Messaging。

不要直接编辑 Windows registry、Native Host manifest/allowlist、`.syncnoscli` 固定目录或 migration journal；这些操作会绕过 ownership/identity 校验，并可能把可恢复状态变成冲突状态。
