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

1. 使用独立、无敏感内容的测试会话；不要拿私人会话做回归样本。
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
- partial capture 只能安全 merge / append，不能删除窗口外旧消息。
- 只有真正证明完整历史时才能产生 complete / destructive snapshot。
- 手动完整采集若会 sweep 历史，结束后应恢复用户原滚动位置。

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

### DOM-07：附件

仅在站点原生支持时执行，使用无敏感测试文件：

- 文本文件内容：`SYNCNOS-ATTACHMENT-TEXT`
- 图片内可见文字：`SYNCNOS-ATTACHMENT-IMAGE`

发送：

```text
请确认你收到了测试附件，并在回复最后输出：
SYNCNOS-ATTACHMENT-ACK
```

断言：

- Source、Capture、Persist 中用户正文与真实附件关联正确。
- 用户上传和 AI 生成的内容图片可作为 conversation 内容。
- 普通 tool / MCP 截图、装饰图标和页面资源不得误判为内容附件。
- 附件变化必须反映到消息 identity / fingerprint 所依赖的语义中。

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
- 标题来自网页内当前会话；浏览器标签页 `<title>` 不得覆盖真实会话标题。
- 网页没有稳定标题时，才允许从首条 user semantic text 生成短标题。

### UI-01：Markdown 展示压力测试

此用例专门验证 Render 层。可复用 DOM-02 / DOM-03 的已保存记录，再补一条宽表和双位数列表。

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
| 普通 provider collector | DOM-01、DOM-02、DOM-04 完成态、DOM-05 至少 4 轮、DOM-08 |
| 用户正文提取 / 折叠控件 | INPUT-01、DOM-08 |
| Markdown / shared Markdown helper | DOM-02、DOM-03、UI-01；触发问题的 provider + 至少一个同 helper 的其它 provider |
| streaming / auto-save | DOM-04 生成中 + 完成后、DOM-08 |
| 虚拟列表 / 分批历史 / completeness | DOM-05 全 12 轮、后台 → 前台恢复、DOM-08 |
| branch / edit / retry | DOM-06、DOM-08 |
| 图片 / 文件 / 视频附件 | DOM-07、DOM-08 |
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
| UI-01 |  |  |  |  |  |  |

证据只保留足以复核的事实：断言锚点、capture / read-back 结果、conversation/message identity、`captureMeta`、必要截图和阻塞原因。不要保存账号凭据、私人对话或认证材料。

## E2E 通过标准

一次真实站点回归只有同时满足以下条件才算通过：

- Source 样本有效，测试对象和扩展 revision 明确；
- collector 与 Source 的语义一致；
- SyncNos 本地 read-back 与 collector 一致；
- identity / completeness 没有违反当前 provider 契约；
- 受展示影响时，App / popup 的实际 UI 也通过；
- 所有未执行或证据不足的项目明确标为 N/A、BLOCKED 或 INCONCLUSIVE。

“测试跑绿了”“页面看起来差不多”“保存成功了”都不是完整 E2E 结论。