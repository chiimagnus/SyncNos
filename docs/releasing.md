# 发布

SyncNos 有两条**独立**发布线：浏览器扩展和 npm CLI。两者共享协议源码，但版本号、发布入口和发布授权互不绑定。

## WebClipper

浏览器版本真源是 `wxt.config.ts`。正式版与 prerelease 由仓库现有 GitHub Actions 根据 `v*` tag 构建并上传对应浏览器产物；Chrome / Edge / Firefox 商店发布继续由各自现有 workflow 负责。workflow 与打包脚本是具体发布实现的真源，本文不复制它们的 step 清单。

发布构建前运行：

```bash
npm run gate
```

不要用 development/unpacked/custom browser identity 代替正式商店身份，也不要在 release packager 中覆盖 canonical Firefox identity。

## SyncNos CLI

CLI 版本真源是 `packages/syncnoscli/package.json`，**不要求等于 WebClipper 版本**。CLI npm 发布只在 repository owner 本机执行；GitHub Actions 只负责 CLI 的跨平台构建与测试，不执行 `npm publish`。

发布前把 CLI `version` 更新为 npm 尚未存在的新 SemVer，并同步 lockfile。然后：

```bash
npm run gate
cd packages/syncnoscli
npm whoami
npm publish
npm view @chiimagnus/syncnoscli version
```

npm 登录与 2FA 只保留在 owner 本机，不写入仓库或 GitHub Actions。npm 已发布版本不能覆盖；遇到版本已存在时应更新版本，而不是绕过 registry 保护。

浏览器 release workflow 可以验证 CLI package integrity，但这不构成 CLI 发布，也不会改变 CLI 版本。

## Local Data release evidence

[`tests/e2e/local-data-release-matrix.md`](../tests/e2e/local-data-release-matrix.md) 是 Local Data 的 maintainer 验收证据，不是 npm publish 授权。正式 desktop 行只能使用正式/商店安装的浏览器身份；dev ID、unpacked build、fake Host、repository variable 或单平台结果不能冒充真机证据。

`releaseReady` 只有在 matrix 要求的自动与人工证据都满足时才能变为 `true`。这与 WebClipper tag 发布和 CLI npm 发布是不同的门槛。
