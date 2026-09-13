# SyncNos CLI 安装与注册

只在安装/卸载 CLI 集成，或 `doctor` 指向 package、Native Messaging registration、browser detection 问题时读取。

- 诊断先运行 `syncnos doctor`；只有用户要求安装、修复或卸载时才修改系统状态。
- 普通安装使用 `syncnos install`：只检查当前 OS 声明过的有限浏览器候选，并按 registration target 去重；不要扫描磁盘/Profile 或猜 manifest/Registry 路径。
- macOS/Linux 只写用户级 manifest；Windows 只写当前用户 HKCU registration，不要求管理员权限或 system-wide 注册。
- `syncnos install --browser <id>` 只用于用户明确指定浏览器，或自动发现未命中但用户确认目标存在的 portable/dev/非标准安装。可用 browser id 以 `syncnos --help` 为准。
- `--extension-id` 只和显式 `--browser` 同用；仅在用户明确调试 dev extension 时覆盖 production allowlist。
- `package_invalid` 先修复/重装当前 CLI package，不把它误诊为浏览器权限问题。
- `native_host_install_invalid` 且用户已授权修复时，重新运行正式 installer；不要手工补 manifest/Registry。
- registration 健康但仍 `extension_unreachable` 时，读取 `browser-required.md` 处理 Extension 权限。
- `protocol_mismatch` 时对齐 CLI、Native Host 与 Extension 版本，不增加兼容 tunnel。
- `syncnos uninstall` 无 `--browser` 时只删除 SyncNos 自己声明/拥有的 targets，并在最后一个 target 消失后清理 launcher；显式 `--browser` 只处理该浏览器映射的 target，影响范围以 CLI 返回值为准。
- 安装、修复或卸载后用 `syncnos doctor` read-back。
