# Markdown 与公式渲染

本页面向维护者，说明文章、聊天和评论的共享渲染边界、字体构建与排障方法；不涉及站点内容采集或外部 Provider 的排版。

## 不变量

- 三类正文统一使用 `MarkdownContent`，共享解析规则、公式运行时和样式生命周期。只允许布局与图片显示策略不同，不另建评论解析器。
- 公式以 KaTeX HTML 进行视觉排版；`htmlAndMathml` 中隐藏的 MathML 用于无障碍，不能当作冗余删除，也不切换为原生 MathML 视觉排版。
- 渲染不改写持久化 Markdown。ChatGPT 富组件中的布局、分隔线、引用等通过安全的纯文本转换呈现，已有记录可直接阅读；真正的代码块保持原样。兼容 `**标题。**正文` 等标点紧邻格式时，仍须保留嵌套语义、转义和代码字面量。
- 原始 HTML 作为文本；链接保留 URL 校验、`target="_blank"` 与 `rel="noreferrer noopener"`。这些信任边界不属于可删除的兼容代码。

## 入口与显示策略

文章和聊天经 `ChatMessageBubble` 使用 [`MarkdownContent`](../src/ui/shared/MarkdownContent.tsx)，评论和回复直接使用同一组件。

- 文章、聊天保留内容图片与已解析的本地资源映射。
- 评论使用紧凑布局和 `renderImages={false}`：图片语法显示为文字或 HTTP(S) 链接，不创建图片元素。
- 评论中的原文引用由 `CommentQuotePreview` 显示为文本，不重新解释为 Markdown 或公式。

支持 `$...$`、`$$...$$` 和 `\(...\)`、`\[...\]` 公式。普通正文不初始化公式运行时；检测到公式后才加载共享运行时，按内容与资源映射缓存渲染结果。加载失败时保留普通 Markdown 显示并记录 warning，不伪造公式加载成功。按需初始化不等于真正拆包：content script 的 IIFE 构建可能把动态导入合入同一个文件，需检查产物而非只看 `import()`。

## 样式生命周期

[`markdown-math-styles.ts`](../src/ui/shared/markdown-math-styles.ts) 从同一份 KaTeX 样式拆出字体声明与排版规则：

- 字体声明按所属 document 共享。Chromium 不能仅靠 ShadowRoot 内的 `@font-face` 注册字体。
- 排版规则挂到正文实际所在的 document 或 ShadowRoot；页内评论的排版规则不写入宿主页。
- 多个正文共享样式引用计数；最后一个使用者离开或不再含公式时移除对应样式。卸载一个评论不能破坏其它仍打开的公式。
- 页内字体 URL 必须指向扩展自身，不能把 `/assets/` 解析到正在访问的网站。

## 字体与构建

[`wxt.config.ts`](../wxt.config.ts) 是构建真源：统一 KaTeX ESM 入口，避免 CJS/ESM 两份引擎；从供应商 CSS 在资源收集前只保留 WOFF2，并通过 Rollup 输出共享字体文件。保留全部字体族、样式和字形，不靠构建后删文件减小体积，也不维护第二份手写字体清单。

当前 content script 的 Vite library 构建会把普通 CSS `?inline` 中的字体内嵌进 JavaScript，不能仅靠 `assetsInlineLimit` 阻止。虚拟样式模块显式输出共享字体资源；manifest 仅为页内字体开放 `assets/KaTeX_*.woff2`，不扩大为全部扩展资源。更换构建方式或升级依赖后，先验证没有内嵌或重复字体，再简化这条路径。

体积预算与 gate 使用方式见 [`CONTRIBUTING.md`](CONTRIBUTING.md#验证)；具体阈值只由 [`check-dist.mjs`](../.github/scripts/webclipper/check-dist.mjs) 维护。运行时懒加载、解压体积和启动开销是不同指标，不能互相冒充。

## 排障与验证

公式错位、重复或缺字时，先检查 KaTeX 排版规则是否在正确 root、隐藏 MathML 是否仍被隐藏、字体是否从扩展加载成功；不要先改公式源码、删除字体或放宽体积预算。

自动回归分别由以下测试拥有：

- [`markdown-renderer.test.ts`](../tests/unit/markdown-renderer.test.ts)：Markdown、公式、链接与图片策略。
- [`comment-markdown-rendering.test.ts`](../tests/unit/comment-markdown-rendering.test.ts)：跨正文一致性、评论/回复与引用边界、重渲染和 StrictMode 生命周期。
- [`markdown-math-styles.test.ts`](../tests/unit/markdown-math-styles.test.ts)：document/ShadowRoot 隔离、共享与释放。
- [`wxt-config.test.ts`](../tests/unit/wxt-config.test.ts)：ESM 入口、供应商排版规则与完整 WOFF2 资源、manifest 开放范围。

修改共享渲染、样式或字体构建后，还需在受影响的实际浏览器与扩展中核对：

1. 文章、聊天以及应用内/页内评论和回复；包含普通 Markdown、代码/转义、图片与原文引用。
2. 行内/块级公式、分式、根式、求和、矩阵、对齐、分段、伸缩括号、花体、方框、划除和上下标；检查字体加载、单一可见公式及容器内滚动。
3. 浅色/深色、窄/宽容器、宿主页冲突样式，以及打开多个正文、逐个关闭和重新打开后的样式共享与释放。

验证责任遵循 [`CONTRIBUTING.md`](CONTRIBUTING.md#验证)：尽可能覆盖受影响的适用环境与条件，逐项说明未执行项及影响。JSDOM、独立组件预览和构建通过不能代替已安装扩展的真实路径；新增浏览器目标或升级 KaTeX 时重新核对字体支持与公式显示。

## 更新时机

共享入口、Markdown 规则、公式输出、图片策略、样式生命周期、字体构建或对应验证边界变化时更新本页；用户操作变化时同时核对中英文[评论文档](../website/content/docs/zh/comments.md)。
