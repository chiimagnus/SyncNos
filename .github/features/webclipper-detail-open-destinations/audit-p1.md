# Audit P1 - webclipper-detail-open-destinations

## Scope

- 审计 P1 的协议拆分是否符合协议驱动开发边界
- 审计 popup/app 的 `Open in Notion` 可见性与交互一致性
- 审计 phase1 文档是否与已实现行为一致

## Entry Criteria

- `todo.toml` 中 `P1-T1` 到 `P1-T4` 全部完成
- `plan-p1.md` 中的 compile、test、build 命令已经至少执行一轮

## Checklist

- Notion page URL 构造是否只有一个真源，没有在多个 shell / pane 中重复拼接
- detail header action 协议是否独立于 popup/app 布局层
- popup detail 模式是否移除了旧的 `More` 占位
- app detail header 是否与 popup 使用同一套动作解析规则
- 没有 `notionPageId` 的会话是否完全隐藏右上角入口
- `.github/deepwiki/modules/webclipper.md` 与 `Extensions/WebClipper/AGENTS.md` 是否说明当前只支持 `Open in Notion`
- 本 phase 是否未触碰国际化字段

## Findings

- Medium（已修复）：app 窄屏 detail 路由最初没有接入 header state，导致 `Open in Notion` 只在 popup 和宽屏 app 出现，在窄屏 app detail view 中消失。原因是 `AppShell` 的窄屏路径直接渲染 `ConversationsScene`，但没有消费 `onPopupHeaderStateChange`，同时 `ConversationsScene` 在窄屏 detail 模式下会把 `ConversationDetailPane` 设为 `hideHeader`。修复方式：
  - 抽出共享 `DetailNavigationHeader`
  - popup 改为复用共享导航头
  - app 窄屏 shell 接入同一套 header state，并在 detail 模式渲染右上角动作
  - 新增 `tests/smoke/app-shell-narrow-header-actions.test.ts` 锁定该路由
- 其余 checklist 项未发现新增问题：Notion URL 仍由 `detail-header-actions.ts` 单点生成；popup 与 app 继续复用同一套 action resolver；无 `notionPageId` 时相关入口保持隐藏；本 phase 未触碰国际化字段。

## Fix Verification

- `npm --prefix Extensions/WebClipper run compile`
- `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-shell-header-actions.test.ts tests/smoke/app-detail-header-actions.test.ts tests/smoke/detail-header-actions.test.ts tests/smoke/app-shell-narrow-header-actions.test.ts`
- `npm --prefix Extensions/WebClipper run build`
- 结果：全部通过，P1 审计闭环完成。
