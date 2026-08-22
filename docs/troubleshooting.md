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
| `Could not establish connection` / `Receiving end does not exist` | 先按发送方向和生命周期分类：content → background 冷启动、background → content 尚未注入、port 已建立后关闭、旧 context 失效是不同问题。不要用通用 retry 掩盖 background cold-start，也不要把 `message port closed` 或 `Extension context invalidated` 当成 missing receiver。 |

### 连接错误的五类生命周期

- **content → background / background cold-start**：In Page 按钮已经存在、worker 冷启动后第一次点击失败而第二次立即成功，优先检查 background `runtime.onMessage` 是否在任何 `await` 之后才注册。background receiver 应 listener-first，不能靠 retry、keep-alive 或扩大 timeout 修复。
- **background → content / 人为初始化窗口**：content entrypoint 已执行但仍被 locale await 挡住 listener 的窗口已经消除；Current Page / comments / video 只在 handler 内等语言，article extract 不等语言。
- **background → content / 尚未注入**：页面刚导航、content script 根本还没注入时，仍可能没有 receiver。这是真实平台窗口，不等价于 background cold-start；现有 article navigation 的一次 missing-receiver retry 只属于该 caller。
- **message port closed**：listener/port 已经建立后又因导航、reload 或 teardown 关闭。这不是“从未有 receiver”，不得借用 missing-receiver retry 隐藏。
- **`Extension context invalidated`**：extension reload/update 后旧页面脚本属于旧 context 生命周期，继续走现有 invalidated-context 处理；不要归入 receiving-end retry。content → background 不增加 retry。

## 评论精确定位

在 App DevTools Console 设置 `localStorage.setItem('__SYNCNOS_DEBUG_COMMENTS_SELECTION__', '1')` 后重载，复现时检查 `[CommentsSelection][app]` 和 `[CommentsLocate]`。依次确认 surface root、exact/context、context generation，以及是否属于 iframe、closed shadow root 或跨 root 歧义。失败必须保留明确 reason；不要用模糊匹配或滚动兜底。

## Zen

使用 `npm run build:zen` 生成本地测试 XPI。可用 `FIREFOX_EXTENSION_ID` 覆盖 gecko id，用 `WXT_ZEN_BINARY` 指定浏览器；仅本地测试 profile 才可关闭 unsigned XPI 的签名要求，不能作为发行方案。
