# AI Collector 维护契约

本页是 AI 对话 collector 的长期维护规范。具体 selector、DOM class、route pattern 和当前测试
fixture 以各 provider 源码与测试为准，不在文档重复镜像。

## 分层

每个 provider 是独立适配器：

```text
collectors/<provider>/**
  -> collectors/shared/** | collector-level helpers
  -> services/shared/**
```

禁止 `collectors/<provider>/**` 直接 import `collectors/<other-provider>/**`。
例如 z.ai、Claude 或 Google AI Studio 不能调用 Gemini 的 markdown adapter。

职责边界：

- **provider**：host/route、selector、conversation/message identity、role/order、streaming/editing、
  站点 UI 清理、附件结构、历史加载边界。
- **shared/helper**：不含产品名称或站点 selector 的通用算法，例如 DOM→Markdown 渲染、公式恢复、
  图片 URL 处理、virtualized sweep。
- **service/shared**：持久化完整性、跨 collector 数据契约和其它业务级共享逻辑。

共享代码如果必须知道“这是 Gemini / z.ai / Claude”，它就不应在 shared。

## 维护一个站点时先检查什么

先核对当前线上页面，再改 fixture。至少确认：

1. host、conversation route 与 capture availability；
2. 稳定 conversation identity 与 message identity；持久 key 只能由站点 durable identity 派生，
   不能由 pathname 或单次 DOM 临时 ID 派生；看起来像 ID 的属性至少跨一次 reload 验证；
3. 真实会话标题；优先匹配当前会话 URL 的 history 链接。ChatGPT 新版侧栏可能不挂载链接，
   只有在采集完成、当前正式会话的 durable 身份已核验后，才能使用当前文档的非通用 `<title>`；
   分享页、临时会话仍回退首条 user semantic text。
   不要使用无会话身份关联的浮动聊天标题或其它标签页标题；
4. user/assistant role、顺序、branch/sibling 行为；
5. Markdown：标题、段落、嵌套列表、表格、引用、链接、inline/fenced code、公式；
6. 用户上传图片、AI 内容图片、普通文件、视频及其它附件；
7. streaming、editing、retry、隐藏 thinking/tool/control UI；
8. 长对话、lazy load、virtualized list、分批历史、scroll root 与 restore；
9. auto-save / manual-only 是否仍安全；虚拟化页面还要验证一次后台 → 前台恢复；
10. `$` mention 输入 surface 是否仍存在。

旧 fixture 只能防回归，不能证明当前网页仍兼容。站点行为改动必须走真实浏览器路径验证；
无法访问时记录外部阻塞，不猜 selector。统一的真实站点提示词、
场景和记录标准见 [`ai-chat-testing.md`](ai-chat-testing.md)。

DeepSeek 的 `data-virtual-list-item-key` 在新用户消息上是保留的临时 `renderKey`，不是服务端 ID。
MAIN adapter 只把当前消息组件中已确认、属于当前 session 的正数 `messageId` 投影到 DOM；
隔离世界 collector 使用该身份。无法确认时消息保持 unresolved / partial，不按负数、相邻 ID、
正文或序号推导身份。站点组件契约变化时先更新该 adapter 并跨 reload 验证，不在存储层猜测去重。
DeepSeek 消息中的上传图片可能只有当前网页可读取的 `blob:` 地址；collector 从消息 DOM 读取原始图片，
交由现有本地图片缓存保存，不持久化临时 Blob URL。读取失败时保持 partial 并保护既有 Markdown；
自动保存不滚动，手动全量抓取需要扫描虚拟列表并恢复原滚动位置。

豆包的 `.scroller` 是会卸载离屏消息的虚拟列表，`data-message-id` 只证明消息身份，不证明历史完整。
自动保存只读取当前窗口；手动保存复用共享 sweep 补齐可达窗口并恢复滚动位置。
当前 DOM 不暴露历史 exhausted 证明，因此两条路径都必须标记 partial 并 append/reconcile，
不能因滚到物理顶部或回复已完成就改为 destructive snapshot。

Grok 目前**不支持自动保存**：长对话的初始化和后台渲染可能只提供部分消息，
无法可靠保证自动采集的消息连续完整。手动采集必须保持 partial-safe，
不得因滚动到物理顶部就删除未加载的历史。持久消息身份取 `response-UUID`，
不可使用可能与之不同的虚拟行标记 `data-plane-row`；首页不能退化为文章抓取。

## Markdown 与附件

- provider 先识别正文与用户可见的思考内容，并清理 control/UI 节点；
  未识别的内部 thinking/tool 内容不得混入最终正文。当前 ChatGPT DOM / Advanced API、DeepSeek
  会把明确识别的思考内容保存为独立 Markdown callout，和正式回答分开；其他 provider 仍按原有
  过滤规则处理，不推断未显示的私有思维链。
- 通用 DOM→Markdown 转换只负责传入正文的 HTML 语义，不负责识别“哪个节点才是正文”。
  保存后的显示规则另见 [`Markdown 与公式渲染`](markdown-rendering.md)，
  不在 collector 中修补展示问题。
- 图片和附件属于消息语义时必须进入 fingerprint，避免附件变化却被当作同一消息。
- 用户上传和 AI 生成的内容图片属于 conversation 内容；普通 tool/MCP 截图不是内容资产。
- 正文保存不得等待图片网络。临时 signed URL、session credential 或原始私有 backend response
  不作为持久内容。
- ChatGPT 的轮次分组与独立消息布局必须使用真实角色、消息身份及滚动容器。
- ChatGPT 图表的结构化数据优先转成 Markdown；Recharts 优先读取无障碍列表，不从像素推断数值。
  当前可见且身份匹配的 SVG/Canvas 才转换成静态 PNG；无法转换时保留占位，
  不保存交互代码或伪造历史截图。
- ChatGPT 的富组件布局在 DOM / Advanced API 采集时统一还原为无多余缩进的 Markdown；
  嵌套布局先还原结构与代码边界，再转换引用，不能把布局缩进当成代码块。
  分隔线、引用与可用链接转换为可阅读形式，不执行原始组件，不改写行内代码或代码块（含缩进代码）。
- Rich UI 的卡片、图表、地图和表格尽量转成可读 Markdown；无法解析的数据保留原文。
  内嵌 PNG 进入本地图片缓存，不受远程下载开关控制；非图片附件只保存文件名和类型，不下载二进制内容。

## AI 思考过程

通用设置 `ai_chat_include_thinking_v1` 默认开启。关闭后，手动与自动保存的**新内容**在
持久化前剔除可识别的思考 callout，正式回答保持不变；已有剪藏不会被追溯修改。
开启时使用可移植的 Markdown `> [!NOTE]- Thinking` 格式，插件内以原生 `details` 默认折叠，
展开后继续由共享 Markdown 渲染组件显示。仅含思考、无最终答复的进行中 DeepSeek 消息仍
按原有完整性规则处理，不得将其误判为完成。导出到其它 Markdown 工具时保留原文，
Obsidian 可原生折叠 callout。

## AI 对话阅读输出

本地 Markdown、复制全文、Obsidian/GitHub 同步、飞书和 Notion 的 AI 对话标题采用相同的
「序号 · 角色 — 正文首句」规则，不调用 AI 生成摘要；序号以已保存的消息 sequence 为准，
完整输出缺失 sequence 时才按列表顺序回退。标题使用正文的可读文字，优先正式回答、
不把已保存的 Thinking callout 当作摘要；过长标题在输出层截断，不修改消息正文、顺序或附件。
文章、视频、JSON 导出和 Backup 保持既有结构；Notion 的文章/视频 section 不受此规则影响。
新规则在下一次同步时按各 Provider 原有策略生效：Obsidian 会重建其受管笔记；
GitHub 内容哈希变化会产生更新；Notion 增量同步仅为新消息生成新标题，旧消息不会追溯改名。
同步之前应留意远端已手动编辑内容的既有覆盖风险；不单独自动启动迁移或远端同步。

## ChatGPT 手动采集

- **默认 DOM**：独立于 Advanced API，只使用网页已渲染内容。
  ChatGPT 新会话可能同时保留一个零高度的 home `<main>` 和实际渲染的对话 `<main>`；
  必须选择可见的 transcript 根节点，而不是简单取文档中第一个 `<main>`。
  手动采集从当前阅读位置向更早的消息单向扫描，不自动滚到最新消息，也不在结束后跳回原位置；
  如果当前不在最新消息处，无法证明包含最新回复，只能安全追加 partial。
  滚动到旧消息区域时由网页自行加载分页；不移动历史加载节点，不调用 React 内部方法或 Advanced API。
  每步只提取实际渲染的正文；对虚拟列表短暂挂载后立即回收的回合，
  被动观察 DOM 挂载，按原生可见回合顺序保留临时窗口快照并解析消息，
  不把 HTML 快照写入数据库，也不把布局高度或同一消息窗口的重复出现当作历史进展。
  新版页面同一回合可能包含多个独立的 assistant 回复，
  应逐条使用 `data-chatgpt-selection-message-id` 识别并保留原始 DOM 顺序，不将整个回合折叠为一条回复。
  页面高度变化、图片排版和节点重建均不证明历史已加载完毕。
  扫描只依据相对对话尾部的真实向上推进和出现更早的稳定消息 ID 继续；
  高度重排但没有历史进展时直接结束为 partial，不向下追赶。
  扫描过程中若页面转入后台或会话身份变化，停止采集并保持 partial，不能认证完整历史。
  到达页面顶部后原地等待历史加载，
  新消息出现时继续向上采集，不跳回底部重新扫描。
  等待期间若 ChatGPT 将视口自动移离顶部，应继续等待原生加载状态，
  加载完成后从新视口继续向旧历史扫描；只有加载持续无进展超过边界时才返回 partial。
  不反复写入顶部滚动坐标与网页争夺视口。
  新版虚拟列表可能回收页面高度、将已离开的底部重新当作当前位置；
  扫描器不再为了寻找重叠消息向下回滚；遇到重基准化或重复的已扫描消息窗口时，
  立即停止并安全保留 partial，不重复滚动同一段历史。
  只有滚动位置真正到顶、最早渲染回合从起点编号、且顶部历史加载器已消失，
  才认定这一轮 DOM 历史扫描结束；不能用固定等待时间或反复回滚来推测。
  当 ChatGPT 正在加载旧历史时原地等待；若没有加载指示、却仍找不到回合起点，
  立即返回 partial；加载器持续无进展或页面转入后台，也只能返回 partial。
  `fallback-turn-0` 和页面物理顶部单独出现均不等于历史已加载完成；
  新版 `data-content-search-turn-key` 也可能是 UUID，不能把 UUID 或首条已渲染消息当作历史起点证明。
  只有此前 DOM 扫描已实际到达并验证历史起点、且成功把此证明与消息原子写入本地时，
  已保存会话才允许向上扫描时在最近的正式消息键提前停止；若本次未从最新消息开始，仍按 partial 处理。
  若增量扫描因后台切换、
  页面卸载、超时或断点丢失而未到达可信的旧消息交界，本次即使已安全追加部分新消息，
  也必须在同一数据库事务中撤销历史已验证状态；下一次采集重新补扫全部旧历史。
  即使找到旧消息交界，只要仍有未解决消息或扫描异常，也撤销该状态。
  多标签页并发时，完整扫描必须逐键提交，且已保存消息总量与本次扫描的唯一消息键数相等，
  才能重新授予已验证状态；旧标签页不能用较短的历史覆盖另一标签页发现的缺口。
  合并重复会话时撤销原来的已验证状态，避免把合并进来的消息误认为已扫描。
  Backup 不导出本地历史认证状态；导入会话时也不沿用旧认证，下一次手动采集重新核验。
  旧记录缺少验证状态、首次采集中断或历史不完整时必须补扫旧历史，不能被已保存的尾部锚点截断。
  API 临时轮次键和 DOM 合成键不作停止锚点；交界消息已编辑、删除或换分支而无法匹配时继续向前扫描。
  扫描到顶部且仍在加载时原地等待；超时仍按 partial 保存已扫描消息，不推断旧历史已穷尽。
  扫描期间允许网页正常滚动、重排与跳转视口，不把跳动本身当作采集失败；
  扫描结束后不强制恢复阅读位置。
  需要补扫历史的 DOM 手动采集首批可识别消息立即写入 SyncNos，此后每批只追加新增或更新消息及顺序锚点；
  中途停止仍保留已提交的消息，只有整轮采集结束后才触发常规远端同步。
  已有可信完整历史时只抓最新尾部，维持原有增量提交，不为短扫描撤销可信历史状态。
  每批均标记为 partial 并撤销过时的 DOM 完整历史证明，不得覆盖或删除本地原有消息。
  同一标签页同时收到采集指令时共享同一次执行；若导航到另一会话，拒绝复用旧任务与保存旧结果。
  DOM 无法证明远端分支的完整性，
  即使扫描稳定也只能安全追加，不能删除旧消息或覆盖更完整的 API 正文。
- **Advanced API**：用户显式开启后，从当前已登录的正式会话分页读取。
  首次使用 `conversations/{id}`，之后按 `messages?before=` 获取旧页；
  Token 只在原标签页执行请求时使用，不穿过 Content Script 或持久化。
  最新节点即使标为 `finished_successfully`，若它仍是 `end_turn: false` 的工具调用，
  也不表示整个用户回合已完成；不得据此认证完整快照或替换旧历史。
  后台对发送文档校验来源，对当前标签页及 MAIN world 校验会话身份；
  `MessageSender.url` 可能保留 SPA 导航前的文档路径，不能据此判断当前会话。
- **首次和回退**：没有可信完整历史，或无法验证交界点时，继续从最新页向旧页读取；
  每页只安全暂存变化与必要顺序锚点，不逐页触发远端同步和图片补全。
  仅在历史游标结束、当前分支可判定、最新节点稳定时提交完整快照。
- **后续增量**：复用本地已验证的用户回合交界，从最新页向前查找匹配的当前分支；
  优先验证原始父链；当工具节点缺少父链、但没有已知分支冲突时，
  要求该用户仍是最新用户，或已保存的助手消息与新用户之间存在连续交界。
  找到可信交界后不再请求更旧页，只原子替换该用户回合之后的消息。
  锚点签名包含用户正文、原始父节点及附件的稳定文件 ID；同名附件替换必须重新检查历史。
  已确认的增量尾部在富组件补充完成后、正式落库前复核一次最新节点；
  同 ID 改正文、回复重新生成或分支切换，
  都必须更新当前选中分支并清理已证实失效的旧尾部，不能保存历史兄弟分支。
- **不完整与失败**：生成中只安全追加，不删旧回答；无法证实父链归属时保持 partial-safe。
  若检测到兄弟分支但无法判定选中路径，不得暂存混合消息，应报错并保留原有记录。
  缺少 `metadata.parent_id` 本身不代表缺页，但不能据此猜测可删除的消息。
  分页失败保留已经安全保存的内容、原有可信前缀和可恢复的图片身份；
  失败码及可用 HTTP 状态继续经 CLI 返回，不静默回退 DOM。

## 长对话与完整性

页面中“当前能看到消息”不等于“完整历史”。如果站点使用虚拟列表、懒加载或分批历史：

- 会话和消息持久 key 只依赖 durable identity；
  key 规则升级、无关 query 或 host alias 变化不能把同一真实会话拆成第二条记录；
  持久 URL 只保留稳定会话地址；
- 手动完整采集应确认逻辑顶部和底部，跨窗口累计稳定 message key，并恢复用户原滚动位置；
  站点临时 DOM id 只能作为单次 sweep 内部 identity；
- streaming、未解析 turn、身份变化、加载超时或滚动恢复失败都必须降低为 `partial`；
- 只有 `complete` 可以覆盖历史；`partial` 只能安全 merge/append，不能删除当前窗口之外的旧消息；
- 不能证明完整历史并不自动禁止 auto-save。只要当前窗口有稳定 identity 且持久化保持 partial-safe，
  就可以自动保存；否则保持 manual-only。

数据恢复底线另见 [`storage.md`](storage.md)。

## 验证

每次 provider 维护至少包括：

- 对应 collector / markdown 定向测试；
- 涉及虚拟历史时运行 capture-integrity 与 virtualized-sweep 测试；
- 涉及图片/附件时运行相应 smoke；
- 按 [`ai-chat-testing.md`](ai-chat-testing.md) 用统一提示词真实走通受影响的当前站点路径；
- review 前按 [`CONTRIBUTING.md`](CONTRIBUTING.md) 运行相称 gate。

架构测试必须持续阻止 provider→provider 直接 import。若确有跨站通用逻辑，先提炼为无站点语义 shared，
再由各 provider 独立调用。
