# 仓库指南

## 分层与依赖方向

- `src/ui/**`：React 组件、样式和 DOM surface。
- `src/viewmodels/**`：UI 状态编排，只调用 service。
- `src/services/**`：业务流程、协议和可复用算法。
- `src/platform/**`：浏览器 runtime、storage、messaging、IndexedDB 等适配。
- `src/collectors/**`：站点 DOM 采集与视频字幕解析。
- `src/entrypoints/**`：background、content、popup、app 等装配入口。

依赖方向必须保持：

```text
ui -> viewmodels -> services -> platform/domain/client/shared
entrypoints -> ui/viewmodels/services/platform
collectors -> services/shared
```

禁止：

- `src/ui/**` 或 `src/viewmodels/**` import `@platform/*`。
- `src/services/**` import `@ui/*` 或 `@viewmodels/*`。
- 把可复用数据处理留在组件内。

路径别名：`@ui/*`、`@viewmodels/*`、`@services/*`、`@platform/*`、`@collectors/*`、`@entrypoints/*`、`@i18n/*`。

## 必须保持的契约

- UI 圆角只使用 `src/ui/styles/tokens.css` 中的 `--radius-*`；细则见 `src/ui/AGENTS.md`。
- 会话列表必须使用 `bootstrap + loadMore` 分页，禁止恢复全量读取。
- ChatGPT 与 Google AI Studio 的虚拟列表会卸载离屏轮次，禁止加入 `AI_CHAT_AUTO_SAVE_COLLECTOR_IDS`；完整历史只走手动抓取和 `prepareManualCapture()`。
- 评论选区只附加到根评论 composer；reply 输入框和评论面板内选区不得覆盖正文引用。
- 评论定位只接受全局唯一 exact Range，不新增模糊匹配、比例滚动或父元素高亮回退。
- `$` mention 使用 `$` 打开候选，`Tab`/`Enter` 插入；站点支持真源在 `src/collectors/ai-chat-sites.ts`。
- `markdown_reading_profile_v1` 未知值归一到 `medium`。
- `anti_hotlink_rules_v1` 命中后补 referer 并尝试缓存图片，但图片失败不得阻断正文采集。

长期说明统一放在 [docs/overview.md](docs/overview.md) 导航下；不要在 README、AGENTS 和多个模块页重复维护同一事实。

## 修改约定

- 默认不查看或编辑 i18n 文案，除非任务明确涉及文案。
- Commit message 使用 Conventional Commits；一个提交只做一件可验证的事。
- 新 API、新状态或新文件必须接入生产入口，同时删除被替代的旧路径、兼容分支和测试假设。
- 先从代码和脚本确认行为，再改文档；不要根据旧文档互相抄写。
- 版本、DB schema、权限和迁移等易漂移事实只在对应源文件或一个 canonical 文档中维护，其他页面只链接。

## 验证

日常功能改动至少运行：

```bash
npm run compile
npm run test
```

提交前运行：

```bash
npm run gate:ci
```

发布或构建相关改动再运行：

```bash
npm run gate
```

边界扫描：

```bash
rg -n "@platform/|src/platform|/platform/" src/ui src/viewmodels
rg -n "@ui/|@viewmodels/" src/services
rg -n "border-radius:\\s*[0-9]|tw-rounded-\\[" src/ui src/entrypoints
```
