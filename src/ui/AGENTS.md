# WebClipper UI 约束（Scope: `src/ui/**`）

根 `AGENTS.md` 的分层和产品 invariant 对本目录全部生效。本文件只补充 UI 层无法从源码结构自然推导的局部约束。

## 边界

- `src/ui/**` 只负责组件、样式和 DOM 面板；不得直接访问 `src/platform/**`。
- 数据读取、写入、归一化和跨界面状态编排放在 ViewModel / Service，不要在组件中形成第二套业务逻辑。
- 设计 token 的唯一事实源是 `src/ui/styles/tokens.css`；不要在文档或组件旁复制完整 token 清单。

## 视觉与交互

- 新样式优先复用现有 token、shared style 和已有组件模式，不创建局部设计系统。
- 非 reset 的圆角使用现有 radius token；按钮不得用硬编码超大圆角模拟 pill。
- 详情页次级操作优先沿用右上角更多菜单模式，避免在正文 header 平铺一组并列操作。
- 可交互元素必须保留清晰的 `focus-visible` 状态，不以鼠标视觉效果换掉键盘可访问性。
- 修改共享视觉规则时先改 canonical token/shared style，再让消费者继承，不在多个组件中同步手抄常量。

## 验证

架构扫描、通用构建/测试要求和提交前验证统一遵循根 `AGENTS.md` 与 `docs/CONTRIBUTING.md`。涉及视觉行为时同时检查受影响的 popup / app / in-page surface，避免只验证单一入口。
