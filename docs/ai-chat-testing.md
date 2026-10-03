# AI 对话真实站点测试

这套用例用于真实浏览器验证 AI chat collector。它补充 fixture / unit test，不能被模拟 DOM 代替。

## 原则

- 每个 provider 使用独立测试会话，不混入私人内容。
- 提示词里的 `SYNCNOS-*` 标记是断言锚点；不要依赖模型逐字遵守其它自然语言。
- 至少验证三层：网页实际 DOM、collector capture、SyncNos 最终本地会话。
- 自动保存测试必须同时观察“生成中”和“生成完成后”；生成中的未完成 assistant 不应被当成完整消息保存。
- 长历史测试要离开首屏后再验证；只证明当前可见窗口正确，不等于完整历史正确。
- provider 不支持的编辑、分支、附件或公式能力记为 N/A，不用兼容层伪造。
- 当前 manual-only / auto-save 真源是 `src/collectors/ai-chat-sites.ts`，本页不复制易漂移的 provider 名单。

## 核心提示词

### DOM-01：基础角色与特殊字符

验证 user / assistant、换行、CJK、emoji 与 HTML 转义。

```text
请严格按下面 5 行回复，不要增加解释：

SYNCNOS-DOM-01-BEGIN
中文：你好，世界。
English: Hello, SyncNos.
符号：1 < 2 && 3 > 2；"quote" 'apostrophe' 😀
SYNCNOS-DOM-01-END
```

检查：user 与 assistant 都存在；`<`、`>`、`&` 仍是文本而不是 HTML；换行顺序不变。

### DOM-02：Markdown 结构

验证标题、强调、列表、引用、链接、inline code 与表格。

```text
请输出一个 Markdown 测试块，必须包含且只包含下面这些结构：

# SYNCNOS-DOM-02
## 二级标题

普通段落包含 **粗体**、*斜体*、~~删除线~~ 和 `inline_code()`。

- 一级列表 A
  - 二级列表 A.1
- 一级列表 B

1. 有序一
2. 有序二

> 引用：SYNCNOS-BLOCKQUOTE

链接：[OpenAI](https://openai.com/)

| 列 A | 列 B |
| --- | --- |
| alpha | 中文 |
| beta | 😀 |

结尾必须是：SYNCNOS-DOM-02-END
```

检查：结构没有被 collector UI 节点污染；表格、嵌套列表、引用和链接仍有语义。

### DOM-03：代码与公式

验证 fenced code、inline math、block math，以及代码中的 HTML 字符。

```text
请按下面结构回复，不要省略任何标记。

SYNCNOS-DOM-03-BEGIN

行内公式：$E=mc^2$

块公式：
$$
\int_0^1 x^2\,dx=\frac{1}{3}
$$

TypeScript 代码：
```ts
const html = '<div data-x="a&b">中文 😀</div>';
console.log(html);
```

JSON 代码：
```json
{"marker":"SYNCNOS-CODE","ok":true}
```

SYNCNOS-DOM-03-END
```

检查：公式没有重复/丢失；code fence、语言标签、尖括号和引号保持为代码内容。

### DOM-04：流式生成

用于在 assistant 尚未结束时触发一次采集，然后在生成结束后再次采集。

```text
从 001 到 080 逐行输出，格式必须是：
SYNCNOS-STREAM-001
SYNCNOS-STREAM-002
……
SYNCNOS-STREAM-080

不要合并行，不要提前总结，最后单独输出：
SYNCNOS-STREAM-END
```

检查：

1. 生成中：collector 不得把仍 streaming / pending 的 assistant 当成最终完整消息。
2. 生成完成：最终消息应包含 `SYNCNOS-STREAM-001`、`SYNCNOS-STREAM-080` 和 `SYNCNOS-STREAM-END`。
3. auto-save provider：完成后的自动保存最终能更新同一个稳定 message identity，而不是新增重复 assistant。

### DOM-05：多轮顺序与长历史

在同一个测试会话连续发送下面模板，`NN` 从 `01` 到 `12`。

```text
这是 SyncNos 多轮测试第 NN 轮。
请只回复：SYNCNOS-TURN-NN-ACK
```

检查：

- 12 个 user / assistant turn 的顺序与配对正确；
- 稳定 message key 不因滚动、卸载、重新挂载而变化；
- 滚动离开首屏后，auto-save 不得删除本地旧 turn；
- 手动完整采集应恢复完整历史，并在可证明完整时使用 complete 语义。

## 能力型用例

### DOM-06：编辑 / 重试 / 分支

仅在站点原生支持时执行。

1. 先发送：`请只回复 SYNCNOS-BRANCH-A`
2. 编辑原 user message 为：`请只回复 SYNCNOS-BRANCH-B`，或使用站点原生 retry / regenerate。
3. 在有 sibling / branch UI 的站点切换一次分支。

检查：collector 不应把控制按钮、隐藏 sibling 或旧 streaming 内容混入当前正文；站点能提供稳定 branch identity 时应保持身份一致，否则必须降级为 partial / safe merge。

### DOM-07：附件

仅在站点原生支持上传时执行。使用专门的无敏感测试文件：

- 文本文件内容：`SYNCNOS-ATTACHMENT-TEXT`
- 图片内可见文字：`SYNCNOS-ATTACHMENT-IMAGE`

发送提示词：

```text
请确认你收到了测试附件，并在回复最后输出：
SYNCNOS-ATTACHMENT-ACK
```

检查：用户附件与 AI 正文的结构正确；普通 tool / MCP 截图不应被误当成会话内容资产。

## 每次真实回归的最小组合

普通 collector 修改至少执行：

1. DOM-01
2. DOM-02
3. DOM-04
4. DOM-05 至少 4 轮

改 Markdown / formula 时加 DOM-03；改 branch/edit 时加 DOM-06；改附件时加 DOM-07。涉及虚拟列表、分页历史或完整性语义时，DOM-05 必须跑满 12 轮。

## 记录模板

每个 provider 留下下面这些事实即可，不保存账号、cookie、token 或私人对话：

| 项目 | 结果 |
| --- | --- |
| Provider / 日期 |  |
| 测试 URL / route 形态 |  |
| DOM-01 | PASS / FAIL / N/A |
| DOM-02 | PASS / FAIL / N/A |
| DOM-03 | PASS / FAIL / N/A |
| DOM-04 生成中 | PASS / FAIL / N/A |
| DOM-04 完成后 | PASS / FAIL / N/A |
| DOM-05 | PASS / FAIL / N/A |
| DOM-06 | PASS / FAIL / N/A |
| DOM-07 | PASS / FAIL / N/A |
| auto-save | PASS / FAIL / manual-only |
| manual capture | PASS / FAIL |
| SyncNos 本地 read-back | PASS / FAIL |
| 阻塞 / 备注 |  |

真实站点通过的最低标准是：页面事实、collector 结果和 SyncNos 本地 read-back 三者一致。只检查 selector、bundle、fixture 或 DOM snapshot 都不能写成 E2E PASS。
