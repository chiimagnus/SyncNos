# SyncNos CLI 发布

CLI 版本真源是 `packages/syncnoscli/package.json`，不要求与 WebClipper 版本一致。CLI npm 发布只在 repository owner 本机执行；GitHub Actions 负责跨平台构建与测试，不执行 `npm publish`。

## 发布前

先把 CLI `version` 更新为 npm 尚未存在的新 SemVer，并同步 lockfile。随后从仓库根目录运行：

```bash
npm run gate
```

需要检查实际 tarball 时，见 [`development.md`](development.md#本地打包)。

## 发布

在 CLI package 目录确认 npm 身份并发布：

```bash
cd packages/syncnoscli
npm whoami
npm publish
npm view @chiimagnus/syncnoscli version
```

`publishConfig` 已固定 public npm registry 与 `latest` tag。npm 登录与 2FA 只保留在 owner 本机，不写入仓库或 GitHub Actions。npm 已发布版本不能覆盖；遇到版本已存在时应更新 `version`，而不是绕过 registry 保护。
