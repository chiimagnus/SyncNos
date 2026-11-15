# AI 对话真实站点测试规范

本页定义 AI chat collector 的真实站点回归协议。它验证的是 **网页真实内容 → collector → SyncNos 持久化 → SyncNos 展示** 的完整链路；fixture、JSDOM、unit test 和构建 gate 只能作为补充证据，不能替代真实站点验证。

## 判定模型

一次用例必须把下面四层分开记录。上游没有先成立时，不得把下游结果解释成 SyncNos 缺陷。

| 层 | 要回答的问题 | 主要证据 |
| --- | --- | --- |
| Source | 用户消息是否按预期进入页面；站点实际渲染的 assistant 内容是否本身正确 | 当前页面 DOM、必要时截图 |
| Capture | collector 是否忠实保留 Source 的角色、顺序、Markdown、附件、identity 与完整性语义 | collector capture |
| Persist | 保存后是否与 capture 一致；重复保存、reload 后是否仍复用稳定 identity | SyncNos 本地 read-back |
| Render | App / popup 是否正确呈现已持久化内容 | 实际 UI、必要时截图 |

例如：模型自己把公式错误地生成进表格，属于无效测试样本；collector 已正确保存表格但 App 没有边框，属于 Render 缺陷。两者都不能记成 Capture FAIL。

### 结果状态

只使用以下状态：

- **PASS**：该层的断言已由实际证据验证。
- **FAIL**：上游输入有效，但本层行为违反断言。
- **INCONCLUSIVE**：已经执行，但证据不足或测试过程失效，例如模型未按要求生成、扩展重载打断 streaming、后台 tab 尚未 hydrate。
- **BLOCKED**：外部条件阻止执行，例如登录、权限、站点故障。
- **N/A**：当前 provider 原生不具备该能力。

整项 E2E 只有在所有适用层都 PASS 时才能写 PASS。`npm run gate`、unit test、DOM fixture 或静态 selector 检查通过，均不能单独写成 E2E PASS。

## 执行前检查

1. 使用独立、无敏感内容的测试会话与图片/文件；不要拿私人会话做回归样本。生图若消耗额度或费用，先取得测试授权；未获授权记 BLOCKED。
2. 记录 provider、日期、当前 commit、浏览器、扩展构建来源，以及 manual / auto-save 路径。不要记录账号、cookie、token 或完整私人 URL。
3. 本地开发扩展必须来自准备验证的当前代码；重载后确认页面已重新连接扩展。
4. 虚拟列表、懒加载或后台 tab 必须先进入一次前台并确认正文已 hydrate。空壳 DOM 只能记 INCONCLUSIVE，不能记 FAIL。
5. 除 streaming / editing 专项用例外，采集前必须确认回复已完成、页面不处于编辑态。
6. 先检查 Source，再触发 capture。站点本身没有生成出目标结构时，重新取样，不把错误源数据当回归样本。
7. 修改 Markdown、公式或视觉样式时，最终必须检查 App 和 popup；只验证 capture 文本不够。
8. 代码级 gate 按 [`CONTRIBUTING.md`](CONTRIBUTING.md) 执行并单独记录，不在本页复制易漂移的测试数量。

## 标准执行流程

每个用例按同一顺序执行：

1. **发送**：发送本页给定的合成提示词。
2. **Source 校验**：核对用户消息和 assistant 的当前真实 DOM。需要结构语义时看 DOM，不只看视觉截图。
3. **Capture 校验**：执行 collector capture，核对 Markdown、role、order、message identity、attachment 和 `captureMeta`。
4. **Persist 校验**：保存到 SyncNos 后通过当前 CLI / 本地 read-back 再读一次，确认内容与 identity 没有漂移。
5. **Render 校验**：受 Markdown / formula / UI 影响时，在 App 与 popup 实际打开同一条记录。
6. **连续性校验**：涉及 identity、history、auto-save 时，再做重复保存、reload、滚动或后台 → 前台恢复。
7. **记录结论**：每层分别写 PASS / FAIL / INCONCLUSIVE / BLOCKED / N/A，并附最小证据。

任何一步改变了测试对象本身，例如删掉测试会话、重载打断生成、切换到另一分支，都必须重新判断后续步骤是否仍有效。

## 思考过程专项验收

在 ChatGPT 或 DeepSeek 的独立测试会话中，让站点生成**可见**的思考摘要与最终回答。
分别在开关开启、关闭状态保存：核对思考与最终回答的原始内容和顺序；
开启时在 SyncNos 插件中确认“思考过程”默认折叠、键盘可以展开、展开后代码/公式正常显示，
底部可收起并返回顶部标题；收起时思考正文不再渲染，正式回答始终可见。
关闭后确认新保存内容中只有正式回答、已有历史记录不会被改写。
ChatGPT 应覆盖 DOM 和 Advanced API，DeepSeek 应覆盖历史扫描与自动保存。
对于源站不提供思考内容或已过滤思考内容的其它 provider，记 N/A，不推断私有内容。
再次保存及刷新后核对稳定消息 ID 和内容，特别检查仅有思考、尚未完成的回复不会入库。

## 核心用例

### INPUT-01：用户正文原样性

验证用户消息的换行、缩进、空行和代码内容不会被逐行 trim，也不会混入“展开 / 收起”等页面控件。

发送下面整段内容：

````text
SYNCNOS-INPUT-01-BEGIN
- Parent
  - Child

```ts
  first();

  last();
```

请只回复：SYNCNOS-INPUT-01-ACK
````

断言：

- Source：网页里的用户正文仍包含二级缩进、代码块内部缩进和空行。
- Capture / Persist：用户 `contentMarkdown` 与 Source 语义一致；不得出现“显示完整信息”“收起”等 UI 文案。
- 如果站点会折叠长消息，展开前后正文与稳定 fingerprint / message identity 不得变化。

### DOM-01：基础角色与特殊字符

验证 role、CJK、emoji、换行和 HTML 特殊字符。

```text
请严格按下面 5 行回复，不要增加解释：

SYNCNOS-DOM-01-BEGIN
中文：你好，世界。
English: Hello, SyncNos.
符号：1 < 2 && 3 > 2；"quote" 'apostrophe' 😀
SYNCNOS-DOM-01-END
```

断言：

- Source 中 user / assistant 均存在且顺序正确。
- Capture / Persist 中 `<`、`>`、`&` 仍是文本，不被解释成额外 HTML。
- CJK、emoji、引号与行序保持一致。

### DOM-02：富 Markdown 结构

验证标题、嵌套列表、任务列表、引用、链接、表格、对齐、竖线转义和显式换行。

```text
请输出下面结构，不要把整段放进代码块，也不要增加解释。

# SYNCNOS-DOM-02
#### Deep heading

普通段落包含 **粗体**、*斜体*、~~删除线~~ 和 `inline_code()`。

- Parent
  - Child

10. Ten
11. Eleven

- [x] Done
- [ ] Todo

> 引用：SYNCNOS-BLOCKQUOTE

链接：[OpenAI](https://openai.com/)

| Left | Center | Right |
| :--- | :---: | ---: |
| **Bold** a \| b | `code` | 中文 😀 |

同一段落第一行  
同一段落第二行

SYNCNOS-DOM-02-END
```

断言：

- 站点 Source 必须真实渲染出这些结构；如果模型自己生成错表格、列表或换行，本轮记 INCONCLUSIVE 并重新取样。
- Capture / Persist 保留 H1/H4、嵌套层级、`10.`/`11.`、任务勾选状态、blockquote、link 和 inline code。
- 表格保留三列、左右/居中对齐；单元格里的 `|` 不得拆列。
- 显式换行不得被无条件压成普通空格。
- thinking、复制、重试、工具栏等控制节点不得混入正文。

### DOM-03：代码与公式

验证 fenced code、代码空白、语言信息、inline math 和独立 block math。

````text
请按下面结构回复，不要省略任何标记。

SYNCNOS-DOM-03-BEGIN

行内公式：$E=mc^2$

独立块公式：
$$
\int_0^1 x^2\,dx=\frac{1}{3}
$$

TypeScript 代码：

```ts
const html = '<div data-x="a&b">中文 😀</div>';

console.log(html);
```

无语言代码块：

```
  first();

  last();
```

SYNCNOS-DOM-03-END
````

断言：

- block math 必须在 Source 中独立于相邻表格、列表和段落；Source 自己嵌套错误时不判 collector FAIL。
- Capture / Persist 中 inline math 与 block math 不重复、不丢失，独立 block math 保持块级语义。
- fenced code 保留尖括号、`&`、引号、缩进和空行。
- 站点提供语言信息时应保留；站点不提供时允许无语言 fence，但不得把代码降成普通段落或混入工具栏标签。

### DOM-04：流式生成

用于区分“生成中”和“生成完成”。

```text
从 001 到 080 逐行输出，格式必须是：
SYNCNOS-STREAM-001
SYNCNOS-STREAM-002
……
SYNCNOS-STREAM-080

不要合并行，不要提前总结，最后单独输出：
SYNCNOS-STREAM-END
```

必须采两次：

1. **生成中**：当前 capture 不得把未完成尾部当成可 destructive replace 的完整历史；应排除未完成 assistant，或按该 provider 的契约明确降级为 partial / unresolved。
2. **生成完成后**：最终 assistant 只出现一次，并包含 `001`、`080`、`END`。
3. auto-save provider 还要确认完成态更新同一稳定消息，而不是追加重复 assistant。

如果扩展重载、tab 生命周期或人为操作中断了生成中的观察，本项记 INCONCLUSIVE，不能补写成 PASS。

### DOM-05：多轮、长历史与虚拟列表

在同一个测试会话连续发送下面模板，`NN` 从 `01` 到 `12`。

```text
这是 SyncNos 多轮测试第 NN 轮。
请只回复：SYNCNOS-TURN-NN-ACK
```

断言：

- 12 个 user / assistant turn 顺序和配对正确。
- 滚动到旧消息离开当前窗口后再回来，稳定 message identity 不因卸载 / 重挂而改变。
- 后台 → 前台恢复后重新确认页面已 hydrate，再判断 capture。
- 新建会话首次生成后，检查是否同时存在零高度 home `<main>` 和可见 transcript `<main>`；
  即使第一个 `<main>` 为空，采集也必须从第二个可见根节点获得消息。
- partial capture 只能安全 merge / append，不能删除窗口外旧消息。
- 只有真正证明完整历史时才能产生 complete / destructive snapshot。
- 手动采集若会 sweep 历史，结束后应恢复到底部或原滚动偏移；
  验证用户启动时位于会话中部、底部以及滚动中途插入旧页的情况。
- ChatGPT DOM 首次采集直接执行一次底部→顶部滚动扫描，依靠网页正常滚动触发旧历史加载；
  不通过 `IntersectionObserver` 加载节点位移预加载，不调用 React 私有函数或 Advanced API。
  即使页面显示原生历史加载节点，也必须启动滚动扫描；不能因为预加载不可用停在底部。
  图片或字体重排、React 节点重建以及单纯高度变化均不代表历史已经完整。
- ChatGPT DOM 首次采集只做一次底部→顶部扫描：分批历史（例如 5→10→15→27 轮）
  到达 `fallback-turn-0` 后不得返回底部重扫，而应在顶端等待加载并沿新增历史继续向上。
  顶部完成必须同时验证：物理滚动位置、最早回合编号、独立于回合外的真实加载器已消失。
  现实 ChatGPT 的历史加载器在 `[data-chatgpt-conversation-selection-target="<会话ID>"]`
  中，由 `[role="status"] [data-loading-indicator]` 渲染；
  切勿将选择器误写成 `data-chatgpt-conversation-selection-target="true"`。
  `fallback-turn-0` 与正在加载的状态可以同时存在，不能据此提前宣告完成。
  顶部无加载指示、却缺少起点编号时，必须立即 partial，不能反复边缘滚动；
  加载中保持原位等待新窗口，超时也只报告 partial。
  已存会话只有持久化了完整 DOM 历史起点验证状态，才允许按最近的正式消息键提前停止；
  旧数据没有状态、首次采集中断或最后一条为临时/合成键时必须继续补扫或选稳定键，
  不得永久遗漏更早的对话。增量扫描若因后台/超时/导航未找到已保存的交界，
  其 partial 追加必须在同一消息事务内使历史验证状态失效，即使本次没有新消息也不能继续信任该状态。
  即使找到旧交界但出现未解决消息、提取异常或滚动恢复失败，也必须撤销标记。
  同一会话在两个标签页的历史长度不同时，旧标签不能在较新标签撤销标记后再次错误认证；
  只有本次完整扫描逐键保存成功且已存消息总量等于扫描的唯一消息键数，才能重新认证；
  10,000 条消息规模也要验证性能，不得每次认证逐条扫描已存数据库游标。
  合并重复会话记录后应撤销原有历史认证，并保证消息内容无损。
  ZIP Backup 不导出此本地认证；即使导入文件人为包含该字段，也必须撤销并重新核验。
  下一次采集应补扫中间缺失的回合，直到完整扫描后才能重新写入验证状态。
  同一标签同时发起的采集共用一次任务，导航变更后不可沿用旧任务或落库旧会话。
  编辑、重试与换分支导致锚点失效时才向旧消息继续扫描，始终安全追加。
  不读取整个 IndexedDB 消息列表；途中导航、中断或加载超时只允许安全追加，不得删除旧消息、
  改变已有正文或导致重复消息。无变化的重复抓取不应推进活动时间。

涉及虚拟列表、分页历史或完整性语义的改动，本用例必须跑满 12 轮。

### DOM-06：编辑、重试与分支

仅在站点原生支持时执行。

1. 发送：`请只回复 SYNCNOS-BRANCH-A`
2. 编辑原 user message 为：`请只回复 SYNCNOS-BRANCH-B`，或使用站点原生 retry / regenerate。
3. 存在 sibling / branch UI 时切换一次分支。

断言：

- 当前 Source 与 capture 只包含当前可见分支，不混入隐藏 sibling、旧 streaming 内容或控制按钮。
- provider 能提供 durable branch identity 时保持稳定。
- 无法证明 branch identity / completeness 时必须降级为 partial-safe，禁止猜测 destructive replace。

### DOM-07：普通文件附件

站点原生支持文件上传时，上传内容为 `SYNCNOS-ATTACHMENT-TEXT` 的无敏感文本文件，发送：

```text
请确认你收到了测试附件，并在回复最后输出：
SYNCNOS-ATTACHMENT-ACK
```

断言：Source、Capture、Persist 中用户正文与文件附件关联正确，不混入附件按钮、页面图标或其它控件；重复保存不产生重复消息。站点支持视频附件时，另用无敏感短视频核对关联与实际媒体内容，不能只检查封面缩略图。**图片另按 IMG-01 / IMG-02 验收**，不能只凭这里的附件名称判定图片已保存。

### DOM-08：重复保存、identity 与标题

对同一个真实会话至少执行：

1. 保存一次并记录 SyncNos conversation id。
2. 不改会话再次保存。
3. 追加一轮消息后再次保存。
4. reload / 重新打开原会话后再次保存。

断言：

- 四次操作始终复用同一 SyncNos conversation id。
- 已存在消息复用稳定 message identity，不产生正文相同的重复项。
- 无关 query、host alias 或入口参数变化不能拆分真实会话。
- 已有图片缓存、评论和同步目标继续附着在同一会话上。
- 标题优先取当前会话对应的历史链接；ChatGPT 在已核验正式会话身份且链接未挂载时，可使用当前页面非通用 `<title>`，不能取浮动聊天或其它会话的标题。
- 无可靠标题时，才允许从首条 user semantic text 生成短标题。

### API-01：ChatGPT Advanced 分页与恢复

复用 DOM-05 的 12 轮测试会话，分别用默认页面采集和 Advanced 采集；必须使用已登录的正式会话，不用分享页或临时会话。

**核对运行时代码版本**：更新 unpacked 扩展构建后，必须重载扩展并刷新目标 ChatGPT 页面，确认当前 Service Worker 的启动时间晚于构建产物时间，且新版本的消息协议真实生效。对比磁盘构建与扩展资源的 SHA-256 不足以证明已启动的 Worker 使用新代码；旧 Worker 会使增量结果被误判为功能退化。

- **完整历史**：首次 Advanced 读取当前页面未渲染的全部旧轮次，历史末页和最新节点稳定时才可覆盖全量历史。
  默认 DOM 始终保持 `partial`，即使滚到顶部也不能删除既有消息。
- **增量效率**：完整采集后立即重复 Fetch，再新增 1 轮与跨 10 turns 增量 Fetch；
  可信交界落在首窗时应只请求一次 10 轮窗口和一次落库前 HEAD；交界落在窗外时必须继续向前分页。
  核对 API 页数、Session/HEAD 请求、传输量和本地 IndexedDB 访问量。
  历史超过 130 页时，新增 1 轮不得重取全部旧页；无变化不能推进活跃时间或发送空同步。
- **当前分支**：在专用测试会话重新生成最后回答、编辑最后提问并切换当前回复；
  验证同一 SyncNos conversation id，消息键、角色、Markdown、顺序与重新全量采集当前分支一致，
  被替换的旧消息消失；父链无法判定且没有已知分支冲突时只能 partial-safe，不能猜测删除。
  同名同类型附件替换为不同文件 ID，须使可信锚点失效；存在无法消歧的兄弟分支时必须报错，
  验证旧记录和修订号不变，不得暂存废弃分支。
- **生成中与设置**：未完成回复先 Fetch 再完成后 Fetch，旧回复不应被提前删除；
  Thinking 开关变化及纯思考、工具进度、图片与附件不丢失或错序，完成后能恢复正确增量。
- **导航、并发和恢复**：首页、正式与 Project 会话互切、返回/前进及刷新时均需确认当前身份。
  分页/HEAD/存储失败及同时两个标签页采集时，不得以过期快照覆盖历史；重试后应恢复。
  尤其要验证完整采集 HEAD 已通过、写入前另一标签页更新消息的竞态：旧完整快照必须事务拒绝，
  本地新增消息和消息修订号保持不变。
  查看 App/CLI、IndexedDB 与 Markdown/JSON ZIP 导出，核实结果及图片缓存、备份恢复。
  模拟图片下载失败后恢复网络、关闭再启动后台 Worker，确认持久任务重试并且未失败的会话不会重复扫描。
  无法安全注入故障或缺少专用会话时逐项注明替代证据与验收限制，不将单元测试记为实机通过。

### IMG-01：用户上传图片

适用于原生支持图片上传的站点。准备一张**无敏感信息的 PNG**，包含独特的可见标记 `SYNCNOS-UPLOAD-IMAGE`，使用已知尺寸（建议大于 1000 px，便于识别缩略图）；记录原文件尺寸与 SHA-256。将图片与「这张图是什么？最后回复 `SYNCNOS-IMAGE-UPLOAD-ACK`」一起发到独立测试会话。

断言：

- **Source**：确认用户消息确实包含上传后的图片，记录页面可取得的**完整尺寸**图片资源及其类型（`blob:`、`data:`、HTTP 等）；不要把缩略图、文件名或模型的 ACK 当成图片证据。
- **Capture**：图片归属于正确的 user message，与正文一起保存；Markdown 含真实图片引用或可恢复的稳定图片身份，不混入站点图标、复制按钮或工具截图；无法读取图片时正文仍可保存，并按 provider 契约记录不完整状态。
- **Persist**：read-back 后图片引用仍存在；可读取的图片最终进入本地资源缓存，重复保存或 reload 不产生重复消息/图片。不得持久化短效 `blob:`、私有签名 URL 或会话凭据；图片变化不能被旧 fingerprint 吞掉。
- **Render / 导出**：App、popup 重新打开后能够显示图片；Markdown ZIP 中存在实际可解码的图片文件，Markdown 链接指向该文件。比较导出图片与站点可取得的**完整图片**的尺寸、字节量及可比较时的 SHA-256；站点压缩过上传文件时，不能强行要求与用户原始 PNG 哈希相同。

支持 manual 和 auto-save 的站点须分别检查：手动采集能保存图片，自动保存能在图片稍后加载时补齐图片，而不是只更新文字。只得到文字、缩略图或不可恢复的图片 URL，不能判 PASS；图片资源暂不可得时，应记录 Capture/Persist/导出的具体缺口。

### IMG-02：AI 生成图片

仅在站点**原生支持生图**、且已获测试额度授权时执行。在独立会话发送：

```text
请直接生成一张图片：浅色背景，画面里有一个橙色圆形和一个蓝色正方形。
不要只返回绘图代码、ASCII 图或图片网址。完成后输出 SYNCNOS-IMAGE-GEN-ACK。
```

断言：

- **Source**：等待生成任务结束，确认页面实际显示 AI 生成的图片。模型只回复说明、链接或未完成生成时记 INCONCLUSIVE，不是图片采集 PASS；站点不支持生图才记 N/A。
- **Capture**：生成图归属于当前 assistant/生成结果消息，即使正文为空也不能丢；普通 tool/MCP 截图、过程预览及隐藏中间产物不能冒充用户可见成品。
- **Persist / Render / 导出**：对照 IMG-01 检查稳定图片身份、本地缓存、App/popup 重开、Markdown ZIP 图片文件及可验证的完整图片尺寸/字节。重复保存不得重复挂载，切换分支或补充后续回答不能把图错挂到别的消息。
- **失败语义**：站点图片失效或缓存失败不得丢弃已保存正文/其它图片；支持 auto-save 时，生成图延迟出现后须能更新同一消息。记录部分失败，不得以「保存成功」掩盖缺图。

### RICH-01：ChatGPT 结构化图表与静态图片

在独立 ChatGPT 测试会话发送：

```text
请直接渲染原生交互式折线图（Chart，不要生成位图或代码块）。
标题：SyncNos 图表真机测试。
横轴：2021、2022、2023、2024、2025、2026。
数值：11、18、14、29、24、38。
图表下输出 SN-REAL-CHART-20261009。
```

依次使用手动 DOM、用户显式开启的 Advanced API 保存同一会话，并实际导出 Markdown ZIP：

- Source 必须确实出现图表或可验证的结构化数据；站点无法加载时记 INCONCLUSIVE。
- 两条采集路径均保存 6 行原始数值，以及静态 PNG（可用时）；不可把 SVG 坐标或像素猜成数值。
- 图片进入 `syncnos-asset://` 缓存，重复保存不得产生重复消息；完整性状态不能因正文未使用的元数据引用而误降级。
- 导出 Markdown 中数据表单独成块，并将图片引用改成 ZIP 内真实可解码的 PNG 附件。
- 切换采集模式、后台测试或重新打开会话不得删除现存数据；测试后恢复原采集设置与页面焦点。

### UI-01：Markdown 展示压力测试

此用例专门验证 Render 层。可复用 DOM-02 / DOM-03 的已保存记录，再补一条宽表和双位数列表。共享正文、公式或字体变更还需按 [`Markdown 与公式渲染`](markdown-rendering.md#排障与验证) 覆盖文章及评论入口；不必为纯显示改动重新触发无关站点采集。

```text
请先输出从 10 到 12 的三项有序列表，再输出一个 8 列 Markdown 表格。
每个表格单元格使用至少 12 个 ASCII 字符，最后输出：SYNCNOS-UI-01-END
```

App 与 popup 都要检查：

- 表格边框真实可见，不只是声明了 border width。
- 宽表在表格区域横向滚动，不把整个 bubble 撑宽。
- 单元格使用正常换行，不因外层强制断词变成逐字符竖排。
- `10.`、`11.`、`12.` 的 marker 完整可见，不被左侧裁切。
- code block、KaTeX 和长链接不越出消息容器。

Capture / Persist 已 PASS 但上述视觉错误存在时，只记 Render FAIL。

## 最小回归矩阵

按改动范围选择，不机械跑所有用例：

| 改动 | 最低真实回归 |
| --- | --- |
| 普通 provider collector | DOM-01、DOM-02、DOM-04 完成态、DOM-05 至少 4 轮、DOM-08；新接入或改动图片能力时另跑适用的 IMG-01 / IMG-02 |
| 用户正文提取 / 折叠控件 | INPUT-01、DOM-08 |
| Markdown / shared Markdown helper | DOM-02、DOM-03、UI-01；触发问题的 provider + 至少一个同 helper 的其它 provider |
| streaming / auto-save | DOM-04 生成中 + 完成后、DOM-08 |
| 虚拟列表 / 分批历史 / completeness | DOM-05 全 12 轮、后台 → 前台恢复、DOM-08 |
| ChatGPT Advanced API / 分页持久化 | API-01、DOM-05、DOM-06、DOM-08；能安全执行时覆盖中途失败与恢复 |
| branch / edit / retry | DOM-06、DOM-08 |
| 普通文件 / 视频附件 | DOM-07、DOM-08（按站点支持情况） |
| 用户上传图片、DOM Blob、图片缓存、导出 | IMG-01、DOM-08；核对 App / popup 及 ZIP 实际图片文件 |
| AI 生图、生成图身份 / 归属 | IMG-02、DOM-08；只对站点原生支持的能力执行 |
| ChatGPT 交互式图表 / Rich UI | RICH-01、DOM-08、UI-01 |
| conversation / message identity / title | DOM-05、DOM-08 |
| Markdown UI / CSS | DOM-02、DOM-03、UI-01，App + popup |

共享 helper 的单元测试应覆盖其结构边界，但真实回归仍需至少一个触发问题的 provider 和一个其它实际消费者，避免把某个站点的 DOM 偶然性当成共享契约。

## 记录模板

### 环境

| 项目 | 记录 |
| --- | --- |
| Provider / 日期 |  |
| Git commit |  |
| Browser / extension build |  |
| manual / auto-save |  |
| 测试 route 形态 |  |
| 代码 gate | 命令 + PASS / FAIL |

### 用例

| Case | Source | Capture | Persist | Render | Overall | 证据 / 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| INPUT-01 |  |  |  | N/A |  |  |
| DOM-01 |  |  |  |  |  |  |
| DOM-02 |  |  |  |  |  |  |
| DOM-03 |  |  |  |  |  |  |
| DOM-04 生成中 |  |  |  | N/A |  |  |
| DOM-04 完成后 |  |  |  |  |  |  |
| DOM-05 |  |  |  | N/A |  |  |
| DOM-06 |  |  |  | N/A |  |  |
| DOM-07 |  |  |  |  |  |  |
| DOM-08 |  |  |  | N/A |  |  |
| API-01 |  |  |  |  |  |  |
| IMG-01 |  |  |  |  |  |  |
| IMG-02 |  |  |  |  |  |  |
| RICH-01 |  |  |  |  |  |  |
| UI-01 |  |  |  |  |  |  |

证据只保留足以复核的事实：断言锚点、capture / read-back 结果、conversation/message identity、`captureMeta`、必要截图和阻塞原因。不要保存账号凭据、私人对话或认证材料。

## E2E 通过标准

一次真实站点回归只有同时满足以下条件才算通过：

- Source 样本有效，测试对象和扩展 revision 明确；
- collector 与 Source 的语义一致；
- SyncNos 本地 read-back 与 collector 一致；
- identity / completeness 没有违反当前 provider 契约；
- 受展示影响时，App / popup 的实际 UI 也通过；适用的 IMG-01 / IMG-02 必须核对实际图片与导出文件，不能只看 Markdown 引用；
- 所有未执行或证据不足的项目明确标为 N/A、BLOCKED 或 INCONCLUSIVE。

“测试跑绿了”“页面看起来差不多”“保存成功了”都不是完整 E2E 结论。