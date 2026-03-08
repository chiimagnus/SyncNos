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

- 待填写

## Fix Verification

- 待填写
