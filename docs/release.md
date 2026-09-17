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

`.github/workflows/release.yml` 是唯一 release workflow，也是唯一 `v*` tag 发布入口。tag push 后先确认：

1. tag 指向 `main` 历史中的 commit；
2. 同名 GitHub Release 尚不存在；
3. exact npm version 尚未发布，或已发布且目标 dist-tag 已指向该 exact version（仅用于 npm 已成功但 GitHub Release 尚未完成的恢复）；
4. 新版本严格晚于 npm 现有 `latest` / `alpha` / `beta` / `rc`；
5. release checkout 通过 canonical gate、CLI package check 和真实 tarball install smoke。

## Publication ordering

release workflow 只构建一次发布产物，然后由独立 job 消费同一组 artifact：

1. 解析 tag/channel、preflight，并运行 `npm run gate` + `npm run cli:check`；
2. 一次性构建并保存 CLI tarball、Chrome zip、Edge zip、Firefox XPI 与 AMO source zip；CLI tarball 先做全局安装 smoke-test；
3. `publish_cli` 通过 npm Trusted Publishing/OIDC 发布同一个 CLI tarball；`npm publish` 正常返回成功即视为该渠道成功，不再因为 registry 传播延迟做发布后的轮询 read-back；
4. stable tag 的 Chrome / Edge / Firefox job 从同一 build artifact 独立发布，prerelease 不进入正式浏览器商店；浏览器渠道失败不会阻止 npm 成功后创建 GitHub Release；
5. `github_release` 只依赖 build 与 `publish_cli`，上传同一份 CLI tarball 与浏览器 assets；stable Release 直接展示 GitHub 自动生成的变更记录；
6. workflow summary 汇总 npm、GitHub Release 与三个浏览器商店渠道的独立结果。

如果一次 `npm publish` 的执行结果本身不确定，应先查询 exact version 再决定是否重试；正常成功路径不额外 read-back。重新执行尚未完成的 release 时，preflight 仍会查询 npm 现有状态，避免重复发布不可覆盖的 exact version。

stable Release 发布后，由 AI 按 [`.github/release-notes.md`](../.github/release-notes.md) 核对 commits 与 merged PR description，在 Release 顶部同时补充中文与英文的普通用户摘要；不得改写 GitHub 自动生成的原始变更记录。

npm tarball 包含项目根目录的 `README.md`、`README.zh-CN.md` 与 `LICENSE`。npm package 页面以 tarball 内的 `README.md` 为默认 README。

## Authentication

`@chiimagnus/syncnos` 的首次 publication 已由 maintainer 在本机完成。后续正常 release 不保存长期 `NPM_TOKEN`，由 `release.yml` 的 GitHub-hosted runner 使用 npm Trusted Publishing/OIDC。npm package 侧必须把 `chiimagnus/SyncNos` 的 `release.yml` 配置为允许 `npm publish` 的 trusted publisher。

## Edit trigger

仅在 tag/version 语法、channel/dist-tag、release preflight、packaging/smoke、npm authentication/publication ordering、GitHub Release asset contract 或 Release Notes 生成/编辑规则变化时更新本文。
