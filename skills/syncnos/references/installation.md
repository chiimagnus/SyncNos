# SyncNos CLI installation and registration

Read this only when installing/uninstalling CLI integration, or when `doctor` points to package, Native Messaging registration, or browser detection problems.

- Diagnose with `syncnos doctor` first; change system state only when the user asked to install, repair, or uninstall.
- Normal installation uses `syncnos install`: it checks only the finite browser candidates declared for the current OS and deduplicates by registration target. Do not scan disks/profiles or guess manifest/Registry paths.
- macOS/Linux use user-level manifests only; Windows uses the current user's HKCU registration only. Do not require administrator privileges or system-wide registration.
- Use `syncnos install --browser <id>` only when the user explicitly chose a browser, or automatic discovery missed a confirmed portable/dev/non-standard installation. Current browser ids come from `syncnos --help`.
- `--extension-id` is valid only with explicit `--browser`; override the production allowlist only when the user explicitly targets a dev extension.
- On `package_invalid`, repair/reinstall the current CLI package before treating the problem as browser permission failure.
- On `native_host_install_invalid`, and only when repair is authorized, rerun the official installer; do not hand-edit manifests or Registry entries.
- If registration is healthy but the result remains `extension_unreachable`, read `browser-required.md` for Extension permission handling.
- On `protocol_mismatch`, align CLI, Native Host, and Extension versions; do not add a compatibility tunnel.
- `syncnos uninstall` without `--browser` removes only SyncNos-owned declared targets and cleans the launcher after the final target disappears. Explicit `--browser` handles only that browser's mapped target; use CLI output as the source of truth for the affected scope.
- After install, repair, or uninstall, read back with `syncnos doctor`.
