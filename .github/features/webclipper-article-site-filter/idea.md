# Idea - webclipper-article-site-filter

## 背景 / 触发

WebClipper 的会话列表里，Web Articles（`source=web` / `sourceType=article`）目前只能用一级 `Source` 过滤；当用户保存了来自多个站点（例如 `dedao.cn`、`sspai.com`、`github.com`）的文章时，会很难在“只看某个站点的文章”这个高频场景下快速收敛列表。

AI chat 已经天然按平台（source）可筛；Web articles 需要一个**零学习成本**的二级过滤：按文章 URL 的站点域名（site/domain）筛选。

## 核心需求（原始需求精炼）

1. 当会话列表筛选到 Web Articles（`Source = web`）时，显示一个二级 `Site` 下拉筛选：
   - 站点列表来自现有 article 的 `conversation.url` 解析（不新增数据模型/不改 DB schema）。
   - 站点粒度为“可注册域名”（够用优先）：对 `www.` / `m.` 等常见前缀做归并，并对少量常见多级后缀做白名单处理（如 `com.cn`、`co.uk`、`github.io`）。
   - 站点下拉包含：
     - `All`（默认）
     - 各站点域名（按出现次数降序）
     - `Unknown/未知`（url 为空或不可解析域名的文章可被单独筛出）
2. 交互与现有 source filter 对齐，零学习成本：
   - UI 放置在列表底部工具条中，紧挨现有 `Source` 下拉。
   - 仅当 `Source = web` 时显示 `Site` 下拉；切走 `web` 立即隐藏。
3. 默认值与持久化策略：
   - `Site` 记住上次选择（localStorage 持久化）；下次切到 `Source = web` 自动恢复。
4. Insight 的“域名分布”按同一规则归并：
   - 复用同一个 domain util，把 Insight 的 article domain 分布从 `URL.hostname` 改为“可注册域名”归并后的口径（保持 Unknown 聚合逻辑）。

## 默认值与兼容策略

- 新安装：`Source` 默认 `all`；当用户选择 `web` 时，`Site` 默认 `all`。
- 已有用户升级：不引入新 storage key / 不做迁移；行为仅体现在 UI 过滤逻辑上。
- 未来扩展：
  - 如未来需要持久化 `Site` 选择，再引入独立 storage key（本 feature 不做）。
  - 未来如果扩展更多多级后缀规则，优先在 domain util 中集中演进，避免列表与 Insight 口径漂移。

## 非目标（明确不做什么）

- 不新增/不修改 IndexedDB 数据模型字段，不引入 schema migration。
- 不引入完整 Public Suffix List 依赖（采用“够用优先”的启发式归并规则）。
- 不把 `Site` 筛选扩展到 AI chats。
- 未被明确要求时，不修改 i18n locale 表（优先复用现有文案 key 或使用无新增文案的展示方式）。

## 验收标准（可检查）

- 会话列表底部工具条：
  - 当 `Source != web`：仅显示现有 `Source` 下拉（无 `Site`）。
  - 当 `Source = web`：出现 `Site` 下拉；默认选中 `All`。
- `Site` 选项按 count 降序排序；存在不可解析 url 时可看到并可选择 `Unknown/未知`。
- 选择某个站点后：列表只显示该站点的 articles，且列表统计（如 today/total）与批量选择的可见范围一致。
- 切换 `Source`（从/到 `web`）时：`Site` 自动回到 `All`（不持久化）。
- `npm --prefix webclipper run compile` 与 `npm --prefix webclipper run test` 通过。
- Settings → Insight → Articles：域名分布与列表 site filter 采用同一套归并规则（例如 `www.sspai.com` 与 `sspai.com` 归到同一项）。
