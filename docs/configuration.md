# 配置与构建

配置的当前真源是 `wxt.config.ts`（manifest/权限）、`package.json`（命令/依赖）、各 service protocol（值的归一化）和 settings ViewModel（读写编排）。不要在文档复制版本号、权限列表或完整 storage key 清单。

## 稳定设置契约

| 设置 | 规则 |
| --- | --- |
| `inpage_display_mode` | 只写 `supported`、`all` 或 `off`；旧 `inpage_supported_only` 只可兼容读取。 |
| `markdown_reading_profile_v1` | 未知值必须归一到 `medium`。 |
| `anti_hotlink_rules_v1` | 非法规则忽略；命中时尝试补 referer 和缓存图片，但正文保存继续。 |
| `reader_prefs_v1` | 必须经 `normalizeReaderPrefs()`，由协议层处理枚举回退和数值 clamp。 |

新设置先写 protocol/normalizer，再由 ViewModel 编排，UI 只渲染；不得形成长期双写兼容路径。Feishu 的 OAuth 默认值与 Worker 部署见 [feishu-setup.md](feishu-setup.md)。

## 命令与验证

```bash
npm ci
npm run dev
npm run gate:ci
```

manifest、权限、发布构建或产物相关改动再运行 `npm run gate`。可用的 browser-specific `dev:*` / `build:*` 命令以 `package.json` 为准。
