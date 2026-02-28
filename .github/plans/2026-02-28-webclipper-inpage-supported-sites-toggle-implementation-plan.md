# WebClipper Inpage 显示范围开关实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 在 WebClipper 的 Settings 最底部新增开关 `仅在支持站点显示 Inpage 按钮`，并让开关实时控制普通网页是否显示 inpage 按钮。  

**Non-goals（非目标）:**  
- 不修改 AI/Notion 采集器本身的抓取逻辑。  
- 不移除普通网页的 `Fetch Current Page`（popup 内）能力。  
- 不做历史版本迁移兼容逻辑（未设置即按默认值处理）。  

**Approach（方案）:**  
- 使用 `chrome.storage.local` 持久化一个布尔配置（建议 key：`inpage_supported_only`）。  
- popup 负责展示/修改该配置；content 负责读取该配置并在 inpage 显示判定时过滤 `web` collector。  
- 默认值为 `false`（全站显示，保持当前行为）。  
- 开关切换后通过 storage 变更监听 + observer tick，当前页面立即生效。  

**Acceptance（验收）:**  
- 开关默认 `OFF`，普通网页仍显示 inpage 按钮。  
- 开关 `ON` 后，普通网页不显示 inpage 按钮；支持站点（AI + Notion）继续显示。  
- 切换开关后当前页面无需刷新即可出现/隐藏按钮。  
- popup 的 `Fetch Current Page` 在开关 `ON/OFF` 下都可用。  
- 相关 smoke tests 通过，`npm --prefix Extensions/WebClipper run check` 通过。  

---

## P1（最高优先级）：实现开关与核心行为

### Task 1: 在 Settings 最底部添加开关 UI 与存储读写

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-core.js`
- Create: `Extensions/WebClipper/src/ui/popup/popup-inpage-visibility.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup.js`
- Modify（如需样式微调）: `Extensions/WebClipper/src/ui/styles/popup.css`

**Step 1: 添加 UI 节点（放在 Settings 最底部）**
- 在 `popup.html` 的 Settings 区域末尾新增一行开关，文案固定为：`仅在支持站点显示 Inpage 按钮`。
- 使用明确 id（例如 `inpageSupportedOnlyToggle`）供 JS 绑定。

**Step 2: 接入 popup 元素引用**
- 在 `popup-core.js` 的 `els` 中注册该开关元素。

**Step 3: 新增 popup 配置模块**
- 新建 `popup-inpage-visibility.js`：
  - 初始化时读取 `chrome.storage.local[inpage_supported_only]`。
  - 未设置时按默认 `false`。
  - 用户切换时写回 storage。
  - 可选：监听 `chrome.storage.onChanged`，保证多 popup/多窗口状态一致。

**Step 4: 在 `popup.js` 初始化新模块**
- 按现有模块化风格，在启动流程中调用 `popupInpageVisibility.init()`。

**Step 5: 验证**
- Run: `npm --prefix Extensions/WebClipper run check`
- Expected: 语法/manifest 检查通过，无新增报错。

---

### Task 2: 在 content 侧接入开关并过滤 web inpage 按钮

**Files:**
- Modify: `Extensions/WebClipper/src/bootstrap/content-controller.js`

**Step 1: 增加配置读取与默认值兜底**
- 在 controller 内维护 `inpageSupportedOnly`（默认 `false`）。
- 封装读取函数：从 `chrome.storage.local` 读取 `inpage_supported_only`，失败时回退 `false`。

**Step 2: 增加实时变更监听**
- 监听 `chrome.storage.onChanged`（仅关注 `inpage_supported_only`）。
- 值变化后更新内存态，使当前页在下一次 tick 立即生效。

**Step 3: 修改 inpage collector 资格判定**
- 在 `getInpageCollector` 或其调用链中加入过滤：
  - 若 collector.id !== `web`：保持原行为。
  - 若 collector.id === `web` 且 `inpageSupportedOnly === true`：跳过该 collector，不显示 inpage 按钮。
  - 其他情况：保持原行为。

**Step 4: 清理监听**
- 在 `stop()` 时移除 storage 监听，避免重复绑定和内存泄漏。

**Step 5: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/content-controller-web-inpage-article-fetch.test.ts`
- Expected: 现有 web 抓取入口测试仍通过（默认行为不变）。

---

### Task 3: 增加/更新测试覆盖开关行为与即时生效

**Files:**
- Modify: `Extensions/WebClipper/tests/smoke/content-controller-web-inpage-article-fetch.test.ts`
- Create: `Extensions/WebClipper/tests/smoke/content-controller-inpage-visibility-setting.test.ts`
- Modify（如需要）: `Extensions/WebClipper/tests/smoke/content-controller-inpage-combo.test.ts`

**Step 1: 覆盖默认值路径**
- 验证未设置 `inpage_supported_only` 时，普通网页下 `collectorId === "web"`（默认全站显示）。

**Step 2: 覆盖开关开启路径**
- 模拟 `inpage_supported_only = true`，验证普通网页下不创建 `web` inpage 按钮。

**Step 3: 覆盖“即时生效”路径**
- 模拟 storage onChanged 事件从 `false -> true`（或反向），验证同一测试会话中按钮显示状态变化。

**Step 4: 回归验证**
- Run: `npm --prefix Extensions/WebClipper run test -- tests/smoke/content-controller-web-inpage-article-fetch.test.ts tests/smoke/content-controller-inpage-visibility-setting.test.ts tests/smoke/content-controller-inpage-combo.test.ts`
- Expected: 全部 PASS。

---

## P2：端到端回归与发布前检查

### Task 4: 手工冒烟与回归命令

**Files:**
- 无代码新增（验证任务）

**Step 1: 本地手工冒烟**
- 在普通网页验证：
  - 开关 `OFF`：inpage 按钮可见；
  - 开关 `ON`：inpage 按钮隐藏；
  - 切换开关后当前页无需刷新即可变化。
- 在支持站点（任一 AI 站点或 Notion）验证：
  - 开关 `ON/OFF` 下均可显示 inpage 按钮（按站点规则）。
- 在 popup 验证：
  - `Fetch Current Page` 在 `ON/OFF` 下都可成功触发。

**Step 2: 自动化回归**
- Run: `npm --prefix Extensions/WebClipper run test`
- Run: `npm --prefix Extensions/WebClipper run check`
- Expected: 全量测试与检查通过。

**Step 3:（可选）原子提交**
- Run: `git add <本次计划涉及文件>`
- Run: `git commit -m "feat: task4 - add inpage supported-sites visibility toggle"`

---

## 边界条件与实现注意点

- `chrome` 不可用或 storage 读取失败时，必须回退默认 `false`，避免误隐藏按钮。  
- storage 里若出现非布尔值，按 `false` 处理（防止脏数据导致不可预期行为）。  
- 仅影响 inpage 按钮显示，不影响 background 的 article fetch 处理链。  
- 保持改动集中在 popup + content，不扩大到 collectors 实现。  

## 不确定项（执行前确认）

- 无（本轮需求已在 brainstorming 中确认）。  

## 执行建议

- 你可以直接进入实现：使用 `executing-plans` 按 `P1 -> P2` 顺序执行。  
- 若要我继续，我可以下一步直接按此计划分批落地并回报每批验证结果。  
