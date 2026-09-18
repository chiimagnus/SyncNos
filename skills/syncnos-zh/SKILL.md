---
name: syncnos-zh
description: "使用 SyncNos Web Clipper（网页剪藏器）及其 `syncnos` CLI 与浏览器插件交互：采集、查询和管理内容，处理评论与设置，同步 Provider，以及打开、导出和备份数据。"
---

# SyncNos

把 `syncnos` 作为常规操作入口。Extension/IndexedDB 是业务事实真源；不要直接读写 IndexedDB、runtime message、浏览器 Profile 或私有 storage 代替 CLI。

## 工作流

1. 命令或能力不确定时运行 `syncnos --help` / `syncnos capabilities`，以当前输出为准，不在 Skill 维护命令副本。
2. 普通命令失败时先按 CLI JSON `error.code` 分流。安装、卸载、`doctor`，或 `extension_unreachable` / `native_host_*` / `browser_not_found` / `package_invalid` 问题：读取 `references/installation.md`，继续诊断和修复，不停在 `doctor` 的 candidate reasons。
3. 任务需要网页选区、OAuth 用户批准、Local CLI Integration 权限 user gesture，或真实 active tab/composer：读取 `references/browser-required.md`，并使用现有浏览器 Skill。
4. 以 CLI JSON、稳定 error code 和最终业务状态为准。写操作结果不确定时先用 CLI read-back，不盲目重复 mutation。

## 运行边界

- 普通业务命令需要至少一个在线且启用 Local CLI Integration 的浏览器实例；`install` / `uninstall` / `doctor` 不需要在线实例。
- 实例选择：显式 `--instance` > 在线 preferred instance > 唯一在线 instance > `instance_ambiguous`；歧义时查看 `syncnos instances`，不按最近启动猜。仅在用户要长期改变默认实例时设置 default。
- `extension_unreachable` 时先运行 `doctor`；candidate reasons 只是候选，不当作已证实根因。若 `doctor` 已定位到 SyncNos 自己拥有、可修复的安装/注册问题，且当前任务已授权修复，就走正式修复路径并 read-back，不把诊断结果原样甩给用户。

## 关键操作

- `capture` 处理当前 active page；若目标页未激活，只用浏览器能力切换 tab，不重写 collector。
- 评论 root/reply/delete 走 CLI。root/reply 正文可以直接传 Markdown 和 `$...$` / `$$...$$` 数学公式源码；Markdown 图片语法不代表评论附件能力。CLI 创建的 root/reply 作者自动记为 `<About You 用户名>' CLI`，未配置用户名时记为 `CLI`，不接受调用方覆盖作者；网页选区评论走 browser-required 流程，不伪造 locator。
- 修改设置前先运行 `settings schema`，只操作 public key。
- Provider 认证/配置只走 CLI 暴露接口，不直接读取底层凭据。
- 用户要求“同步并确认完成”时保留默认等待语义；仅在明确需要异步时使用 `--no-wait`。`sync_wait_timeout` 不等于远端任务已取消。
- `open` 默认只解析 target；只有用户要求实际打开时加 `--launch`。
