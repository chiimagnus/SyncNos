# Legacy (migration-only)

本目录用于 WXT 迁移期间“尽量复用旧实现”的过渡层：

- 只允许做 **启动/适配/桥接**，不要在这里加新功能
- 每完成一个业务域迁移到新结构后，逐段删除对应 legacy

当前状态（2026-03）：
- Popup 已迁移到 WXT + React（`entrypoints/popup/*`），旧版 `src/ui/popup/*` 已删除
- Background / Content 仍通过本目录做静态引入打包（保证旧模块仍可运行）

下一步建议：
- 按业务域逐段把 `src/**.js` 迁移到 `src/domains/*` / `src/integrations/*` 的 TS 结构
- 当某段不再被 `startLegacyBackground()` / `startLegacyContent()` 依赖时，再删除对应静态 import
