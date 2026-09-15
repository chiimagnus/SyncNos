# Release

SyncNos 的 release 由 Git tag 驱动。CLI 与 Extension 共用同一个 release version；npm 包固定为 `@chiimagnus/syncnos`。

## Version / channel

Git tag 是 release version 真源：

- `vMAJOR.MINOR.PATCH` → npm `latest` → normal GitHub Release
- `vMAJOR.MINOR.PATCH-alpha[.N]` → npm `alpha` → GitHub prerelease
- `vMAJOR.MINOR.PATCH-beta[.N]` → npm `beta` → GitHub prerelease
- `vMAJOR.MINOR.PATCH-rc[.N]` → npm `rc` → GitHub prerelease

CLI 源 package 保持 `0.0.0-dev` + `private: true`；release staging 由 tag 注入真实版本。CLI release core 必须与 `wxt.config.ts` 的 Extension version core 一致。

## Preflight

`.github/workflows/release.yml` 是唯一 release workflow。tag push 后先确认：

1. tag 指向 `main` 历史中的 commit；
2. 同名 GitHub Release 尚不存在；
3. exact npm version 尚未发布，或已发布且目标 dist-tag 已指向该 exact version（用于 npm 已成功但 GitHub Release 尚未完成的恢复）；
4. 新版本严格晚于 npm 现有 `latest` / `alpha` / `beta` / `rc`；
5. release checkout 通过 canonical gate、CLI package check 和真实 tarball install smoke。

## Publication ordering

release workflow 依次：

1. 解析 tag/channel 并做 preflight；
2. `npm run gate` + `npm run cli:check`；
3. 构建 `chiimagnus-syncnos-<version>.tgz` 并从该 tarball 全局安装 smoke-test；
4. 构建 Chrome / Edge / Firefox release assets；
5. 通过 npm Trusted Publishing/OIDC 将同一个 CLI tarball 发布到对应 dist-tag；
6. bounded read-back 验证 exact version + dist-tag；
7. npm 可验证后才创建 GitHub Release，并上传同一个 CLI tarball 与浏览器 assets；stable Release 的 GitHub 自动生成变更记录默认折叠在 `Full changelog` 中。

stable Release 发布后，由 AI 按 [`release-notes-prompt.md`](release-notes-prompt.md) 核对 commits 与 merged PR description，在 Release 顶部补充面向普通用户的简明摘要；不得改写折叠区中的原始 GitHub 变更记录。

npm tarball 包含项目根目录的 `README.md`、`README.zh-CN.md` 与 `LICENSE`。npm package 页面以 tarball 内的 `README.md` 为默认 README。

## Authentication

`@chiimagnus/syncnos` 的首次 publication 已由 maintainer 在本机完成。后续正常 release 不保存长期 `NPM_TOKEN`，由 `release.yml` 的 GitHub-hosted runner 使用 npm Trusted Publishing/OIDC。npm package 侧必须把 `chiimagnus/SyncNos` 的 `release.yml` 配置为允许 `npm publish` 的 trusted publisher。

## Edit trigger

仅在 tag/version 语法、channel/dist-tag、release preflight、packaging/smoke、npm authentication/publication ordering、GitHub Release asset contract 或 Release Notes 生成/编辑规则变化时更新本文。
