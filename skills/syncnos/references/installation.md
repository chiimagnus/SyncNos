# SyncNos CLI installation and registration

Read this only when installing/uninstalling CLI integration, or when `doctor` points to package, Native Messaging registration, or browser detection problems.

- Run `syncnos doctor` first. Treat its diagnosis as evidence, not the terminal result: continue until the installation is healthy/reachable or a real user gesture/external prerequisite blocks progress.
- Change system state only within the current authorization. A request to install, repair, or make the CLI integration work authorizes repair of SyncNos-owned launcher/registration state; it does not authorize editing browser profiles/private storage or unrelated packages.
- Normal installation uses `syncnos install`: it checks only the finite browser candidates declared for the current OS and deduplicates by registration target. Do not scan disks/profiles or guess manifest/Registry paths.
- macOS/Linux use user-level manifests only; Windows uses the current user's HKCU registration only. Do not require administrator privileges or system-wide registration.
- Use `syncnos install --browser <id>` when the user chose a browser, or automatic discovery missed a confirmed portable/dev/non-standard installation. Current browser ids come from `syncnos --help`; pass the exposed product id directly (for example, detected Helium uses `--browser helium`) instead of guessing an underlying browser-family id.
- `--extension-id` is valid only with explicit `--browser`; override the production allowlist only when the user explicitly targets a dev extension.
- On `package_invalid`, repair/reinstall the current CLI package before treating the problem as browser permission failure. Preserve a linked development package instead of silently replacing it with the published package.
- On `native_host_install_invalid`, rerun the official installer (`syncnos install`, or explicit `--browser` for a known target); never hand-edit manifests or Registry entries. Then run `syncnos doctor` again.
- On `extension_unreachable`, inspect `installationHealthy` first. If false, repair installation before investigating Extension permission. If true, allow the Native Bridge to reconnect and read back with `syncnos status` / `syncnos doctor`; only if it remains unreachable read `browser-required.md`.
- In a confirmed source-development/unpacked-extension workflow, a healthy registration can still reject the running extension when its runtime ID is not in the manifest allowlist. Use the browser Skill to read the actual `chrome-extension://<runtime-id>/` target; if it is the intended dev extension, rerun `syncnos install --browser <id> --extension-id <runtime-id>`, reload that extension, then read back with `syncnos doctor` / `syncnos status`. Do not discover IDs by scanning browser profiles or guess them from filesystem paths.
- On `protocol_mismatch`, align CLI, Native Host, and Extension versions; do not add a compatibility tunnel.
- `syncnos uninstall` without `--browser` removes only SyncNos-owned declared targets and cleans the launcher after the final target disappears. Explicit `--browser` handles only that browser's mapped target; use CLI output as the source of truth for the affected scope.
- After every install or repair, verify both installation health and browser reachability with CLI read-back. Do not report success from installer output alone.
