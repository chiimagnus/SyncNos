# 发布

## 发布面与渠道
SyncNos 仓库的自动化发布重点放在两类产物：GitHub Release 页面，以及 WebClipper 的 Chrome / Edge / Firefox 分发包。README 中能看到 macOS App Store 链接，但当前仓库里的 CI 并没有公开描述 App Store 提交流水线，因此这里把它视为“仓库外渠道信息”，而不是自动化发布主线。

| 渠道 | 产物 | 主要入口 | 自动化程度 |
| --- | --- | --- | --- |
| GitHub Release | Release 页面与附件链接 | `.github/workflows/release.yml` | 自动 |
| Chrome Web Store | Chrome zip 上传 / 发布 | `.github/workflows/webclipper-cws-publish.yml` | 自动 |
| Edge | Edge zip 作为 GitHub Release 附件分发 | `.github/workflows/webclipper-release.yml` | 自动 |
| Firefox AMO | XPI + AMO Source 包 + AMO API 发布 | `.github/workflows/webclipper-amo-publish.yml` | 自动 |
| macOS App Store | App Store 页面链接 | `README.md`, `release.yml` body | 仓库内未显式自动化 |

## 触发入口与工作流矩阵
| Workflow | 触发方式 | 主要动作 | 结果 |
| --- | --- | --- | --- |
| `release.yml` | `push tags: v*` / `workflow_dispatch` | 创建 GitHub Release，并写入网站 / App Store / 扩展链接 | 统一 Release 页面 |
| `webclipper-release.yml` | `push tags: v*` / `workflow_dispatch` | 安装依赖、打包 Chrome / Edge / Firefox 资产并上传到 GitHub Release | 多渠道二进制资产 |
| `webclipper-amo-publish.yml` | `push tags: v*` / `workflow_dispatch` | 校验 manifest 版本、构建 XPI、生成 AMO source、调用 AMO API | Firefox 商店版本 |
| `webclipper-cws-publish.yml` | `push tags: v*` / `workflow_dispatch` | 校验 manifest 版本、构建 Chrome zip、上传 CWS | Chrome 商店版本 |

- `release.yml` 本身不构建 WebClipper，只负责 Release 页面和统一链接。
- WebClipper 的 zip / xpi 产物由 `webclipper-release.yml` 和发布脚本统一生成，避免手工打包产生渠道差异。

## 版本一致性规则
| 规则 | 位置 | 为什么存在 | 失败表现 |
| --- | --- | --- | --- |
| tag 必须匹配 `v*` | 所有 release workflows | 用 Git tag 作为版本语义和触发器 | workflow 不触发或手动运行需显式输入 tag |
| `wxt.config.ts` 的 `manifest.version` 必须等于 tag 去掉前缀 `v` | `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | 避免渠道产物版本和代码版本错位 | workflow 直接报 `manifest version mismatch` |
| Node 固定为 `20` | WebClipper workflows | 统一构建环境 | 依赖或打包行为在别的 Node 版本下可能不一致 |
| Firefox 需要稳定 gecko id / min version | `package-release-assets.mjs` | 满足 AMO 和持久化要求 | manifest 补丁缺失会导致 AMO 校验失败 |

- 这里最关键的不是 package.json 版本，而是商店真正消费的 `manifest.version`。
- 如果只改了 `Extensions/WebClipper/package.json` 的版本而没有同步 `wxt.config.ts`，CI 仍会认为发布版本不一致。

## 打包脚本职责
| 脚本 | 位置 | 输入 | 输出 |
| --- | --- | --- | --- |
| `package-release-assets.mjs` | `.github/scripts/webclipper/` | `--target`, `--out`, `--zip`, `--zip-name` 等参数 | `dist*` 目录与 Chrome / Edge zip、Firefox xpi |
| `package-amo-source.mjs` | `.github/scripts/webclipper/` | WebClipper 源码、根 `LICENSE`、CI 脚本目录 | `SyncNos-WebClipper-amo-source.zip` |
| `publish-amo.mjs` | `.github/scripts/webclipper/` | `AMO_JWT_*`, `AMO_ADDON_ID`, XPI 路径、source zip 路径 | 调用 AMO API 上传并创建新版本 |

| 脚本细节 | 说明 |
| --- | --- |
| `package-release-assets.mjs` 会先跑 `npm run build` 或 `npm run build:firefox`，再从 `.output/*-mv3` 复制到发布目录。 |
| Firefox 打包时会补 `background.scripts`、`browser_specific_settings.gecko.id` 和 `strict_min_version`。 |
| `package-amo-source.mjs` 只复制 reviewer 需要复现 XPI 的最小源码集合，不把整个仓库原样打进 source zip。 |
| `publish-amo.mjs` 先上传 XPI、轮询 AMO 处理结果，再带 source zip 创建版本。 |

## 产物矩阵
| 产物 | 默认名称 | 生成位置 | 主要去向 |
| --- | --- | --- | --- |
| Chrome zip | `syncnos-webclipper-chrome-<tag>.zip` 或 `SyncNos-WebClipper-chrome-<tag>.zip` | `Extensions/WebClipper/` | GitHub Release / Chrome Web Store 上传 |
| Edge zip | `syncnos-webclipper-edge-<tag>.zip` | `Extensions/WebClipper/` | GitHub Release |
| Firefox XPI | `syncnos-webclipper-firefox-<tag>.xpi` 或 `SyncNos-WebClipper-firefox.xpi` | `Extensions/WebClipper/` | GitHub Release / AMO |
| AMO Source zip | `SyncNos-WebClipper-amo-source.zip` | `Extensions/WebClipper/` | AMO reviewer source code |
| Release 页面链接 | 自动生成 body | GitHub Release | 汇总官网、App Store、商店与 Edge 下载链接 |

## WebClipper 渠道细节
### GitHub Release
- `release.yml` 使用 `softprops/action-gh-release@v2` 创建 Release，并把官网、macOS App、Chrome、Firefox 和 Edge 下载链接写进 release body。
- `webclipper-release.yml` 则把具体产物附件上传到 Release。

### Chrome / Edge
- Chrome 和 Edge 在构建阶段共用 `package-release-assets.mjs`，底层都来自 WXT 的 Chrome MV3 产物。
- Chrome 额外通过 `mnao305/chrome-extension-upload@v5.0.0` 上传到商店；Edge 当前主要靠 GitHub Release 附件分发。

### Firefox / AMO
- Firefox 使用 `build:firefox` 产出，再由脚本补齐 AMO 所需 manifest 字段。
- AMO 发布除了 XPI，还要求 reviewer-friendly 的 source zip，因此 `package-amo-source.mjs` 是必要步骤，而不是附加项。

## 常见失败点
| 失败点 | 位置 | 现象 | 优先排查 |
| --- | --- | --- | --- |
| manifest 版本与 tag 不一致 | `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | workflow 在校验阶段直接失败 | 检查 `wxt.config.ts` 的 `version` |
| AMO 凭据缺失 | `publish-amo.mjs` | `missing env` 或 API 请求失败 | 检查 `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`, `AMO_ADDON_ID` |
| CWS 凭据缺失 | `webclipper-cws-publish.yml` | 上传 action 失败 | 检查 CWS secrets |
| Firefox manifest 补丁缺失 | `package-release-assets.mjs` | AMO validator 报 background / gecko 相关错误 | 检查 `browser_specific_settings` 补丁逻辑 |
| 本地只构建不打包 | `package-release-assets.mjs` 未加 `--zip` | 只有 dist 目录没有最终附件 | 检查 workflow 参数 |
| 误以为 App Store 也由当前 CI 发布 | 仓库认知层 | 找不到对应 workflow | 以 README 链接为准，当前仓库未公开描述 App Store 自动提交流程 |

## 示例片段
### 片段 1：商店发布前会强制校验 manifest 版本与 tag 对齐
```js
const tagVersion = String(tagName || "").replace(/^v/, "");
const m = source.match(/version:\\s*['"]([^'"]+)['"]/);
if (manifestVersion !== tagVersion) {
  throw new Error(`manifest version mismatch: wxt=${manifestVersion} tag=${tagVersion}`);
}
```

### 片段 2：Firefox 打包时会自动补齐 AMO 所需的 gecko 配置
```js
next.browser_specific_settings = {
  ...existingBss,
  gecko: {
    ...existingGecko,
    id: resolvedGeckoId,
    strict_min_version: resolvedMinVersion,
    data_collection_permissions: existingGecko.data_collection_permissions || {
      required: ["none"]
    }
  }
};
```

## Coverage Gaps（如有）
- 当前仓库对 WebClipper 发布链路的自动化描述非常完整，但对 macOS App Store 的实际提交流程只提供了外部链接，没有同等级的 CI / 脚本证据。
- 若后续需要“完整掌握交付体系”，可继续补一页专门描述 App Store 提交流程、签名、证书与版本管理。

## 来源引用（Source References）
- `README.md`
- `Extensions/WebClipper/package.json`
- `Extensions/WebClipper/wxt.config.ts`
- `.github/workflows/release.yml`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
- `.github/scripts/webclipper/package-release-assets.mjs`
- `.github/scripts/webclipper/package-amo-source.mjs`
- `.github/scripts/webclipper/publish-amo.mjs`
- `AGENTS.md`
