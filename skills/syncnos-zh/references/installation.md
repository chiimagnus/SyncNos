# SyncNos CLI 安装与注册

只在安装/卸载 CLI 集成，或 `doctor` 指向 package、Native Messaging registration、browser detection 问题时读取。

- 先运行 `syncnos doctor`。把诊断当作证据，不是终点：继续处理，直到安装健康且浏览器可达，或确实卡在必须的用户手势/外部前提。
- 只在当前授权范围内修改系统状态。用户要求安装、修复或“让 CLI 集成恢复可用”时，可直接修复 SyncNos 自己拥有的 launcher/registration；这不等于获准编辑浏览器 Profile/私有 storage 或替换无关 package。
- 普通安装使用 `syncnos install`：只检查当前 OS 声明过的有限浏览器候选，并按 registration target 去重；不要扫描磁盘/Profile 或猜 manifest/Registry 路径。
- macOS/Linux 只写用户级 manifest；Windows 只写当前用户 HKCU registration，不要求管理员权限或 system-wide 注册。
- 用户已指定浏览器，或自动发现未命中但已确认 portable/dev/非标准安装时，使用 `syncnos install --browser <id>`。可用 browser id 以 `syncnos --help` 为准。
- `--extension-id` 只和显式 `--browser` 同用；仅在用户明确调试 dev extension 时覆盖 production allowlist。
- `package_invalid` 先修复/重装当前 CLI package，不把它误诊为浏览器权限问题。若当前是 link 的开发版，不要静默换成 npm 发布版。
- `native_host_install_invalid` 直接重新运行正式 installer（`syncnos install`，已知目标浏览器时用显式 `--browser`）；不要手工补 manifest/Registry。随后再次运行 `syncnos doctor`。
- `extension_unreachable` 先看 `installationHealthy`。为 false 时先修安装；为 true 时先给 Native Bridge 重新连接的机会，并用 `syncnos status` / `syncnos doctor` read-back；仍不可达再读取 `browser-required.md`。
- 已确认是在源码开发 / unpacked 扩展场景时，即使 registration 健康，当前扩展 runtime ID 不在 manifest allowlist 里也会被拒绝。用浏览器 Skill 从真实 `chrome-extension://<runtime-id>/` 页面取得当前 dev extension ID；确认它就是目标开发版后，运行 `syncnos install --browser <id> --extension-id <runtime-id>`，重载该扩展，再用 `syncnos doctor` / `syncnos status` read-back。不要扫描浏览器 Profile，也不要从文件路径猜 extension ID。
- `protocol_mismatch` 时对齐 CLI、Native Host 与 Extension 版本，不增加兼容 tunnel。
- `syncnos uninstall` 无 `--browser` 时只删除 SyncNos 自己声明/拥有的 targets，并在最后一个 target 消失后清理 launcher；显式 `--browser` 只处理该浏览器映射的 target，影响范围以 CLI 返回值为准。
- 每次安装或修复后同时验证 installation health 与浏览器 reachability；不能只凭 installer 成功就宣布完成。
