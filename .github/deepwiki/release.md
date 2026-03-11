# 发布

## 发布面与渠道
当前仓库的自动化发布主线集中在 **GitHub Release 页面** 与 **WebClipper 多渠道产物**。README 中确实存在 macOS App Store 链接，但仓库内没有公开的 App Store 提交流程，因此 deepwiki 把它视为“仓库外渠道信息”，而不是本仓库的自动化发布主线。

| 渠道 | 产物 | 主要入口 | 自动化程度 |
| --- | --- | --- | --- |
| GitHub Release | Release 页面与附件链接 | `.github/workflows/release.yml` | 自动 |
| Chrome Web Store | Chrome zip 上传 / 发布 | `.github/workflows/webclipper-cws-publish.yml` | 自动 |
| Edge | Edge zip 作为 Release 附件 | `.github/workflows/webclipper-release.yml` | 自动构建、手动分发 |
| Firefox AMO | XPI + reviewer source zip | `.github/workflows/webclipper-amo-publish.yml` | 自动 |
| macOS App Store | App Store 页面链接 | `README.md`, `release.yml` body | 仓库内未显式自动化 |

## Workflow 矩阵

| Workflow | 触发方式 | 主要动作 | 结果 |
| --- | --- | --- | --- |
| `release.yml` | `push tags: v*` / `workflow_dispatch` | 创建 GitHub Release 页面，写入官网 / App Store / 扩展下载链接 | Release 页面 |
| `webclipper-release.yml` | `push tags: v*` / `workflow_dispatch` | 安装依赖、构建 Chrome / Edge / Firefox 资产并上传到 Release | zip / xpi 附件 |
| `webclipper-amo-publish.yml` | `push tags: v*` / `workflow_dispatch` | 校验 manifest 版本、构建 XPI、打包 source zip、调用 AMO API | Firefox 商店版本 |
| `webclipper-cws-publish.yml` | `push tags: v*` / `workflow_dispatch` | 校验 manifest 版本、构建 Chrome zip、上传 CWS | Chrome 商店版本 |

- `release.yml` **不负责构建 WebClipper**，它只负责 Release 页面与静态链接体。
- 真正的渠道资产由 `webclipper-release.yml` 和 `.github/scripts/webclipper/*.mjs` 生成。

## 版本一致性规则

| 规则 | 位置 | 为什么存在 | 失败表现 |
| --- | --- | --- | --- |
| tag 必须匹配 `v*` | 所有 release workflows | 用 Git tag 作为版本与触发器 | workflow 不触发或需手动指定 tag |
| `wxt.config.ts` 的 `manifest.version` 必须等于 tag 去掉 `v` | `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | 防止商店产物与代码版本错位 | `manifest version mismatch` |
| Node 固定为 `20` | 所有 WebClipper release workflows | 保持依赖安装与构建环境一致 | 构建或上传行为不一致 |
| Firefox gecko id / strict_min_version 由脚本补丁 | `package-release-assets.mjs` | 满足 AMO validator 要求 | AMO 校验报 background / gecko 相关错误 |

| 版本面 | 当前值 | 用途 | 备注 |
| --- | --- | --- | --- |
| `package.json` version | `0.14.6` | npm 包层面的版本语义 | workflow 不用它校验 tag |
| `wxt.config.ts` manifest version | `1.2.4` | 浏览器扩展 manifest 版本 | 这是商店发布的事实源 |

## 打包脚本职责

| 脚本 | 位置 | 输入 | 输出 |
| --- | --- | --- | --- |
| `package-release-assets.mjs` | `.github/scripts/webclipper/` | `--target`, `--out`, `--zip`, `--zip-name` 等参数 | Chrome / Edge zip、Firefox xpi、对应 dist 目录 |
| `package-amo-source.mjs` | `.github/scripts/webclipper/` | WebClipper 源码、根 `LICENSE`、必要脚本 | reviewer-friendly `SyncNos-WebClipper-amo-source.zip` |
| `publish-amo.mjs` | `.github/scripts/webclipper/` | `AMO_JWT_*`, `AMO_ADDON_ID`, XPI 路径、source zip 路径 | AMO 上传、轮询、创建版本 |

| 脚本细节 | 说明 |
| --- | --- |
| `package-release-assets.mjs` 会先跑 `npm run build` 或 `npm run build:firefox`，再从 `.output/*-mv3` 复制 / 打包最终产物。 |
| Firefox 打包时会补 `background.scripts`、`browser_specific_settings.gecko.id`、`strict_min_version` 和 `data_collection_permissions.required = ['none']`。 |
| `package-amo-source.mjs` 不复制整个仓库，而是打 reviewer 需要的最小可复现源码集合。 |
| `publish-amo.mjs` 先上传 XPI、轮询处理状态，再附带 source zip 创建 AMO 版本。 |

## 产物矩阵

| 产物 | 典型名称 | 生成位置 | 去向 |
| --- | --- | --- | --- |
| Chrome zip | `syncnos-webclipper-chrome-<tag>.zip` / `SyncNos-WebClipper-chrome-<tag>.zip` | `webclipper/` 或 workflow 临时目录 | GitHub Release / Chrome Web Store |
| Edge zip | `syncnos-webclipper-edge-<tag>.zip` | 同上 | GitHub Release |
| Firefox XPI | `syncnos-webclipper-firefox-<tag>.xpi` / `SyncNos-WebClipper-firefox.xpi` | 同上 | GitHub Release / AMO |
| AMO Source zip | `SyncNos-WebClipper-amo-source.zip` | 同上 | AMO reviewer source |
| GitHub Release body | 自动生成 | Release 页面 | 汇总官网、商店与 App Store 链接 |

## 常见失败点

| 失败点 | 首查位置 | 现象 | 优先排查 |
| --- | --- | --- | --- |
| manifest 版本与 tag 不一致 | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | 校验阶段直接失败 | 检查 `manifest.version` |
| AMO 凭据缺失 | `publish-amo.mjs` | `missing env` 或 API 请求失败 | 检查 `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`, `AMO_ADDON_ID` |
| CWS 凭据缺失 | `webclipper-cws-publish.yml` | 上传 action 失败 | 检查 CWS secrets |
| Firefox manifest 补丁缺失 | `package-release-assets.mjs` | AMO validator 报 background / gecko 问题 | 检查脚本补丁分支 |
| 误把 `package.json` 当商店版本事实源 | 发布认知层 | 版本看起来对，workflow 仍然失败 | 记住商店用的是 `wxt.config.ts` |
| 误以为 App Store 也由当前 CI 发布 | 仓库认知层 | 找不到相关 workflow | 当前仓库只公开了链接，没有自动提交流程 |

## Coverage Gaps
- WebClipper 自动化发布链路已经有足够代码证据；**App Store 提交流程**仍然没有同等级 workflow / 脚本证据。
- 如果未来仓库补充了签名、证书、App Store Connect 提交流程，再适合为 macOS App 补独立发布专题页。

## 来源引用（Source References）
- `README.md`
- `webclipper/package.json`
- `webclipper/wxt.config.ts`
- `.github/workflows/release.yml`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/scripts/webclipper/package-release-assets.mjs`
- `.github/scripts/webclipper/package-amo-source.mjs`
- `.github/scripts/webclipper/publish-amo.mjs`
