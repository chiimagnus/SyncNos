# WebClipper 发布

浏览器版本真源是 `wxt.config.ts`。正式版与 prerelease 由仓库现有 GitHub Actions 根据 `v*` tag 构建并上传对应浏览器产物；Chrome / Edge / Firefox 商店发布继续由各自现有 workflow 负责。workflow 与打包脚本是具体发布实现的真源，本文不复制 step 清单。

发布构建前运行：

```bash
npm run gate
```

不要用 development/unpacked/custom browser identity 代替正式商店身份，也不要在 release packager 中覆盖 canonical Firefox identity。

## Local Data release evidence

[`tests/e2e/local-data-release-matrix.md`](../../tests/e2e/local-data-release-matrix.md) 是 Local Data 的 maintainer 验收证据，不是 npm publish 授权。正式 desktop 行只能使用正式/商店安装的浏览器身份；dev ID、unpacked build、fake Host、repository variable 或单平台结果不能冒充真机证据。

`releaseReady` 只有在 matrix 要求的自动与人工证据都满足时才能变为 `true`。这与 WebClipper tag 发布和 CLI npm 发布是不同的门槛。
