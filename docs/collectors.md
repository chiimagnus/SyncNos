# AI Collector 维护契约

本页是 AI 对话 collector 的长期维护规范。具体 selector、DOM class、route pattern 和当前测试 fixture 以各 provider 源码与测试为准，不在文档重复镜像。

## 分层

每个 provider 是独立适配器：

```text
collectors/<provider>/**
  -> collectors/shared/** | collector-level helpers
  -> services/shared/**
```

禁止 `collectors/<provider>/**` 直接 import `collectors/<other-provider>/**`。例如 z.ai、Claude 或 Google AI Studio 不能调用 Gemini 的 markdown adapter。

职责边界：

- **provider**：host/route、selector、conversation/message identity、role/order、streaming/editing、站点 UI 清理、附件结构、历史加载边界。
- **shared/helper**：不含产品名称或站点 selector 的通用算法，例如 DOM→Markdown 渲染、公式恢复、图片 URL 处理、virtualized sweep。
- **service/shared**：持久化完整性、跨 collector 数据契约和其它业务级共享逻辑。

共享代码如果必须知道“这是 Gemini / z.ai / Claude”，它就不应在 shared。

## 维护一个站点时先检查什么

先核对当前线上页面，再改 fixture。至少确认：

1. host、conversation route 与 capture availability；
2. 稳定 conversation identity 与 message identity；持久 key 只能由站点 durable identity 派生，不能由 pathname 或单次 DOM 临时 ID 派生；看起来像 ID 的属性至少跨一次 reload 验证；
3. 真实会话标题；只读取网页内与当前会话绑定的 history/header/title 控件，禁止使用浏览器标签页 `<title>`；没有稳定网页标题时才用首条 user semantic text；
4. user/assistant role、顺序、branch/sibling 行为；
5. Markdown：标题、段落、嵌套列表、表格、引用、链接、inline/fenced code、公式；
6. 用户上传图片、AI 内容图片、普通文件、视频及其它附件；
7. streaming、editing、retry、隐藏 thinking/tool/control UI；
8. 长对话、lazy load、virtualized list、分批历史、scroll root 与 restore；
9. auto-save / manual-only 是否仍安全；虚拟化页面还要验证一次后台 → 前台恢复；
10. `$` mention 输入 surface 是否仍存在。

旧 fixture 只能防回归，不能证明当前网页仍兼容。站点行为改动必须走真实浏览器路径验证；无法访问时记录外部阻塞，不猜 selector。统一的真实站点提示词、场景和记录标准见 [`ai-chat-testing.md`](ai-chat-testing.md)。

## Markdown 与附件

- provider 先克隆正确的正文 DOM，再删除该站点的 thinking/control/UI 节点；之后才调用通用 Markdown / formula helper。
- 通用 Markdown renderer 只负责 HTML 语义，不负责识别“哪个节点才是正文”。
- 图片和附件属于消息语义时必须进入 fingerprint，避免附件变化却被当作同一消息。
- 用户上传和 AI 生成的内容图片属于 conversation 内容；普通 tool/MCP 截图不是内容资产。
- 正文保存不得等待图片网络。临时 signed URL、session credential 或原始私有 backend response 不作为持久内容。

## 长对话与完整性

页面中“当前能看到消息”不等于“完整历史”。如果站点使用虚拟列表、懒加载或分批历史：

- 会话和消息持久 key 只依赖 durable identity；key 规则升级、无关 query 或 host alias 变化不能把同一真实会话拆成第二条记录；持久 URL 只保留稳定会话地址；
- 手动完整采集应确认逻辑顶部和底部，跨窗口累计稳定 message key，并恢复用户原滚动位置；站点临时 DOM id 只能作为单次 sweep 内部 identity；
- streaming、未解析 turn、身份变化、加载超时或滚动恢复失败都必须降低为 `partial`；
- 只有 `complete` 可以覆盖历史；`partial` 只能安全 merge/append，不能删除当前窗口之外的旧消息；
- 不能证明完整历史并不自动禁止 auto-save。只要当前窗口有稳定 identity 且持久化保持 partial-safe，就可以自动保存；否则保持 manual-only。

数据恢复底线另见 [`storage.md`](storage.md)。

## 验证

每次 provider 维护至少包括：

- 对应 collector / markdown 定向测试；
- 涉及虚拟历史时运行 capture-integrity 与 virtualized-sweep 测试；
- 涉及图片/附件时运行相应 smoke；
- 按 [`ai-chat-testing.md`](ai-chat-testing.md) 用统一提示词真实走通受影响的当前站点路径；
- review 前按 [`CONTRIBUTING.md`](CONTRIBUTING.md) 运行相称 gate。

架构测试必须持续阻止 provider→provider 直接 import。若确有跨站通用逻辑，先提炼为无站点语义 shared，再由各 provider 独立调用。
