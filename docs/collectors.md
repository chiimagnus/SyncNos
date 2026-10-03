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
2. 稳定 conversation identity 与 message identity；
3. user/assistant role、顺序、branch/sibling 行为；
4. Markdown：标题、段落、嵌套列表、表格、引用、链接、inline/fenced code、公式；
5. 用户上传图片、AI 内容图片、普通文件、视频及其它附件；
6. streaming、editing、retry、隐藏 thinking/tool/control UI；
7. 长对话、lazy load、virtualized list、分批历史、scroll root 与 restore；
8. auto-save / manual-only 是否仍安全；
9. `$` mention 输入 surface 是否仍存在。

旧 fixture 只能防回归，不能证明当前网页仍兼容。站点行为改动必须走真实浏览器路径验证；无法访问时记录外部阻塞，不猜 selector。

## Markdown 与附件

- provider 先克隆正确的正文 DOM，再删除该站点的 thinking/control/UI 节点；之后才调用通用 Markdown / formula helper。
- 通用 Markdown renderer 只负责 HTML 语义，不负责识别“哪个节点才是正文”。
- 图片和附件属于消息语义时必须进入 fingerprint，避免附件变化却被当作同一消息。
- 用户上传和 AI 生成的内容图片属于 conversation 内容；普通 tool/MCP 截图不是内容资产。
- 正文保存不得等待图片网络。临时 signed URL、session credential 或原始私有 backend response 不作为持久内容。

## 长对话与完整性

页面中“当前能看到消息”不等于“完整历史”。如果站点使用虚拟列表、懒加载或分批历史：

- 必须有稳定会话身份；
- 手动完整采集应确认逻辑顶部和底部，跨窗口累计稳定 message key，并恢复用户原滚动位置；
- streaming、未解析 turn、身份变化、加载超时或滚动恢复失败都必须降低为 partial；
- `complete` 才能用 snapshot 语义覆盖历史；`partial` 只能走安全 merge/append，不能删除未出现在当前页面的旧消息；
- 无法可靠完成上述证明的站点不得加入自动保存集合。

数据恢复底线另见 [`storage.md`](storage.md)。

## 验证

每次 provider 维护至少包括：

- 对应 collector / markdown 定向测试；
- 涉及虚拟历史时运行 capture-integrity 与 virtualized-sweep 测试；
- 涉及图片/附件时运行相应 smoke；
- 真实浏览器走通受影响的当前站点路径；
- review 前按 [`CONTRIBUTING.md`](CONTRIBUTING.md) 运行相称 gate。

架构测试必须持续阻止 provider→provider 直接 import。若确有跨站通用逻辑，先提炼为无站点语义 shared，再由各 provider 独立调用。
