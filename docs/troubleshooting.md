# 排障

本页面向维护者，只记录可复用的诊断路径。产品契约见 [`AGENTS.md`](../AGENTS.md) 和 [`storage.md`](storage.md)；验证门槛见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| `npm ci` 失败 | Node/npm 版本与 lockfile 是否匹配。 |
| Vitest 不退出 | 未释放的 timer、listener 或 React root；超时不是 PASS。 |
| release/version 校验失败 | tag、`wxt.config.ts` 与 release workflow；CLI release 还要求 npm semver 与 WXT core version 对齐。 |
| OAuth Connect 无响应 | client ID、redirect URI、pending state、Worker/proxy endpoint 与浏览器日志。 |
| Notion `database schema incompatible` | 目标是否仍符合 SyncNos 管理 schema；不要靠新增第二个 Activity 字段或放宽类型检查绕过真实不兼容。 |
| Notion managed section 扫描遇到 5xx/retrieve 失败 | 按远端失败处理并重试；不要把读取失败当成“未找到”后创建重复 section。 |
| GitHub 选中多条但 changed files 更少 | 未变化的受管路径可以参与 reconcile，但最终 tree diff 只包含真正变化的文件。 |
| Article 只有文本没有图片 | 图片设置、anti-hotlink rule、Referer 和下载 warning；文本保存成功仍是成功。 |
| ChatGPT Advanced 在后端改版后失败 | 先区分 identity/tree integrity hard failure 与 schema drift partial；同一次保存禁止静默回退 DOM。需要 DOM 路径时关闭 Advanced 后重新保存。 |
| ChatGPT 正在回复时显示“待确认” | Advanced 仍以后端分支为历史真源；当前分支末尾已有稳定 `turn_id` 的思考/进度可先按 provisional turn 保存，稳定的当前可见回复再与它合并。生成结束后再次保存，应由 backend final 的 message identity 收敛并清掉 provisional key；若显示 live-tail unresolved，先检查 message/turn identity 与当前 route，禁止猜测合并。 |
| ChatGPT Advanced 导出出现 `cite` / `genui` 等内部标记 | 检查 backend message 的 `metadata.content_references` 是否仍能把 transport token 映射到可读引用或 widget 摘要；未知 shape 应降级为 partial 并移除内部 token，不要在 Export 层堆字符串特判。 |
| ChatGPT 正文已保存但图片未本地化 | 先区分未缓存的稳定远端引用、session/resolver 失败和 backfill warning；图片网络失败不能反向判定正文保存失败，也不要为此恢复同步阻塞保存。 |
| Video 没有字幕 | 当前页没有可信字幕时仍保存 Video；字幕加载后再次保存即可补充 transcript。 |
| Bilibili Watch Later 产生重复身份 | 只有带合法 `bvid` 的播放页按 BV identity 归一；旧版本误存的历史 Article 不会自动删除。 |
| `syncnos install` → `browser_not_found` | 自动发现未命中已知标准位置；portable/自定义安装使用显式 `--browser <id>`，不要全盘扫描。 |
| `syncnos doctor` → `native_host_not_installed` | 运行 `syncnos install`；需要单目标诊断时再指定 `--browser`。 |
| `syncnos doctor` → `native_host_install_invalid` | launcher / manifest / Registry 的 path、schema、allowlist、read-back 或权限与当前 package 不一致；重新运行 installer。 |
| `syncnos doctor` → `extension_unreachable` | 浏览器是否运行、Local CLI Integration 是否开启、`nativeMessaging` 权限是否仍存在。doctor 不会猜具体原因。 |
| `syncnos doctor` → `protocol_mismatch` | CLI/host 与在线 Extension 版本不匹配；更新到同一 release，不增加兼容 tunnel。 |
| `syncnos doctor` → `instance_ambiguous` | 用 `syncnos instances` 查看在线实例，并设置默认实例或传 `--instance`。 |

## 消息生命周期

先区分方向和生命周期，不要用统一 retry 掩盖根因：

- **content → background 冷启动**：background receiver 必须在异步初始化前注册。
- **background → content 初始化**：content receiver 先注册，需要 locale 的 handler 自己等待 readiness。
- **content 尚未注入**：导航窗口期确实可能没有 receiver；retry 只能属于明确需要它的 caller。
- **message port closed**：已经建立的 port 因导航/reload/teardown 关闭，不等于 missing receiver。
- **Extension context invalidated**：旧页面脚本属于旧 Extension 生命周期，应走 invalidated-context 处理。

## 评论定位

定位失败时检查 `resolveCommentAnchor()` 的 `reason`、候选 surface root、root evidence、exact quote/context 和当前 generation。失败必须保留明确 reason，不增加模糊匹配或滚动兜底。

## Zen

`npm run build:zen` 生成本地测试 XPI；`FIREFOX_EXTENSION_ID` 可覆盖 Gecko ID。`npm run dev:zen` 可用 `WXT_ZEN_BINARY` 指定 Zen 可执行文件。

unsigned XPI 只允许在本地测试 Profile 中使用。真实 `nativeMessaging` 授权仍需要用户 gesture；不要用 WebDriver、Profile 修改或 `about:debugging` 绕过签名/权限后把结果当成 release evidence。
