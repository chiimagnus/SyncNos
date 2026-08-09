# 排障

先运行 `npm ci` 和 `npm run gate:ci`。manifest、权限、发布构建或产物问题再运行 `npm run gate`；仅检查默认浏览器产物可运行 `npm run check`。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| `npm ci` 失败 | Node/npm 版本与 lockfile 是否匹配。 |
| Vitest 不退出 | 未释放的 timer、listener 或 React root；超时不是 PASS。 |
| manifest/version 发布失败 | `wxt.config.ts`、tag 和 workflow 的版本校验。 |
| OAuth Connect 无响应 | client id、redirect URI、pending state、Worker endpoint 和浏览器日志。 |
| article 只有文本没有图片 | 图片设置、anti-hotlink rule、referer 与下载 warning；文本成功仍是成功。 |
| 视频提示没有字幕 | 先在页面开启并等待字幕请求加载，再 capture。 |

## 评论精确定位

在 App DevTools Console 设置 `localStorage.setItem('__SYNCNOS_DEBUG_COMMENTS_SELECTION__', '1')` 后重载，复现时检查 `[CommentsSelection][app]` 和 `[CommentsLocate]`。依次确认 surface root、exact/context、context generation，以及是否属于 iframe、closed shadow root 或跨 root 歧义。失败必须保留明确 reason；不要用模糊匹配或滚动兜底。

## Zen

使用 `npm run build:zen` 生成本地测试 XPI。可用 `FIREFOX_EXTENSION_ID` 覆盖 gecko id，用 `WXT_ZEN_BINARY` 指定浏览器；仅本地测试 profile 才可关闭 unsigned XPI 的签名要求，不能作为发行方案。
