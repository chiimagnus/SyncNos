# 排障

本页只保留可复用的维护者诊断入口。产品契约见 [`AGENTS.md`](../AGENTS.md) 和 [`storage.md`](storage.md)；验证要求见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 先这样查

1. 先确认是哪一层失败：构建、浏览器、采集、存储、Provider、CLI。
2. 读取原始 error code / 日志，再检查对应 owner；不要先加 fallback 或放宽校验。
3. 修复后走同一真实路径 read-back，不能只凭“命令没报错”宣布完成。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| `npm ci` 失败 | Node/npm 与 lockfile 是否匹配。 |
| Vitest 不退出 | 未释放的 timer、listener 或 React root；超时不是 PASS。 |
| OAuth Connect 无响应 | client ID、redirect URI、授权状态和对应 Worker / endpoint。 |
| Notion schema / managed section 异常 | 不要新增重复字段或把读取失败当作“未找到”；按真实不兼容或远端失败处理。 |
| ChatGPT Advanced 失败 | 区分会话身份/树完整性失败与 schema drift；同一次保存不静默回退 DOM。 |
| 正文已保存但图片缺失 | 检查图片设置、resolver、anti-hotlink 与 warning；图片失败不改变正文成功状态。 |
| Video 没有字幕 | 当前页没有可信字幕时仍可保存 Video；字幕加载后再次保存。 |
| `syncnos doctor` 报错 | 按 `error.code` 检查 installation health、浏览器在线状态、权限或版本；不要猜。 |
| 评论无法定位 | 检查 `resolveCommentAnchor()` reason、候选 root 和 exact quote；不要增加模糊高亮。 |
| Zen 本地测试 | 用 `npm run dev:zen` / `npm run build:zen`；unsigned XPI 只用于测试 Profile。 |

## 消息生命周期

- content → background：receiver 必须早于异步初始化注册。
- background → content：content receiver 先注册，需要 locale 的 handler 自己等待 readiness。
- 导航窗口期的 missing receiver 与已建立 port 的关闭是不同故障。
- Extension reload 后的旧 content script 属于旧生命周期，应按 invalidated context 处理。

真实浏览器权限、签名和用户手势不能靠 Profile 修改或自动化绕过后当作 release evidence。
