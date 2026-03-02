# WebClipper CI 打包脚本迁移与文档收敛实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 将 WebClipper 发布打包能力迁移到 `.github` 目录并由 GitHub Actions 直接调用，清理 `legacy` 命名与本地 npm 打包入口，同时保持发布产物与业务兼容行为稳定。  
**Non-goals（非目标）:** 不修改 WebClipper 业务功能/采集逻辑/同步行为；不移除 `legacy JSON 导入` 兼容能力；不改国际化字段。  
**Approach（方案）:** 先搬迁并重命名打包脚本（保持参数与产物名兼容），再改 workflow 直接调用 `.github` 脚本，随后删除 `package.json` 中发布打包命令与旧脚本，最后统一更新 business logic + AGENTS 文档口径。  
**Acceptance（验收）:** CI 工作流脚本路径与命令完成切换；`package.json` 不再包含 `legacy:build*`/`package:amo-source`/`check:dist:*`；文档不再出现 `legacy` 构建命名（仅保留 `legacy JSON 导入` 业务兼容措辞）；`compile/test/build` 通过且发布脚本可本地 smoke。

---

## P1（最高优先级）：脚本迁移到 `.github`

### Task 1: 迁移并重命名发布脚本到 `.github/scripts/webclipper`

**Files:**
- Create: `.github/scripts/webclipper/package-release-assets.mjs`
- Create: `.github/scripts/webclipper/check-dist.mjs`
- Create: `.github/scripts/webclipper/package-amo-source.mjs`
- Create: `.github/scripts/webclipper/publish-amo.mjs`

**Step 1: 实现**
- 从 `Extensions/WebClipper/scripts/` 迁移对应逻辑，脚本目录改为仓库级（repo-root）。
- 统一脚本内部路径解析为“从仓库根定位 `Extensions/WebClipper`”。
- 保持参数语义兼容（`target/out/zip/zip-name`、AMO env 名称）以降低 workflow 改动风险。
- 明确约束：发布产物文件名保持不变（避免 Release 链接和上传路径失效）。

**Step 2: 验证**
- Run: `node .github/scripts/webclipper/check-dist.mjs --root=Extensions/WebClipper/.output/chrome-mv3`
- Run: `node .github/scripts/webclipper/package-amo-source.mjs`
- Expected: 命令可运行，路径解析正确，产物生成位置与预期一致。

**Step 3: 原子提交**
- Run: `git add .github/scripts/webclipper/*.mjs`
- Run: `git commit -m "refactor: task1 - move webclipper release scripts to github scripts"`

---

### Task 2: GitHub Actions 改为直接调用 `.github` 脚本

**Files:**
- Modify: `.github/workflows/webclipper-release.yml`
- Modify: `.github/workflows/webclipper-cws-publish.yml`
- Modify: `.github/workflows/webclipper-amo-publish.yml`

**Step 1: 实现**
- `webclipper-release.yml`：
  - 移除 `npm --prefix ... run build:edge`（当前命令不存在，属于断链点）。
  - 改为直接调用 `.github/scripts/webclipper/package-release-assets.mjs` 生成 Chrome/Edge/Firefox 产物。
- `webclipper-cws-publish.yml`：
  - `Build Chrome zip` 步骤改为调用 `.github/scripts/webclipper/package-release-assets.mjs`。
- `webclipper-amo-publish.yml`：
  - `Build AMO source zip` 改为 `.github/scripts/webclipper/package-amo-source.mjs`。
  - `Submit to AMO` 改为 `.github/scripts/webclipper/publish-amo.mjs`。

**Step 2: 验证**
- Run: `rg "legacy:build|build:edge|package:amo-source|Extensions/WebClipper/scripts/" .github/workflows -n`
- Expected: 无旧入口命中；workflow 仅引用 `.github/scripts/webclipper/`。

**Step 3: 原子提交**
- Run: `git add .github/workflows/webclipper-*.yml`
- Run: `git commit -m "ci: task2 - switch webclipper workflows to github scripts"`

---

## P2：扩展目录打包入口清理

### Task 3: 删除 npm 发布打包命令与旧脚本

**Files:**
- Modify: `Extensions/WebClipper/package.json`
- Delete: `Extensions/WebClipper/scripts/build.mjs`
- Delete: `Extensions/WebClipper/scripts/check.mjs`
- Delete: `Extensions/WebClipper/scripts/package-amo-source.mjs`
- Delete: `Extensions/WebClipper/scripts/amo-publish.mjs`

**Step 1: 实现**
- 从 `package.json` 删除以下脚本：
  - `legacy:build`
  - `legacy:build:edge`
  - `legacy:build:firefox`
  - `check:dist:edge`
  - `check:dist:firefox`
  - `package:amo-source`
- 保留开发与质量脚本：`dev/build/build:firefox/test/compile/check/check:no-runtime-js`。
- 保留 `legacy JSON` 导入业务兼容（代码与文档均不删该能力）。

**Step 2: 验证**
- Run: `node -e "const s=require('./Extensions/WebClipper/package.json').scripts; console.log(Object.keys(s).sort().join('\n'))"`
- Run: `rg "legacy:build|check:dist|package:amo-source" Extensions/WebClipper/package.json -n`
- Expected: 旧 npm 打包命令不再存在。

**Step 3: 原子提交**
- Run: `git add Extensions/WebClipper/package.json Extensions/WebClipper/scripts/*.mjs`
- Run: `git commit -m "chore: task3 - remove local packaging npm scripts and legacy build wrappers"`

---

## P3：文档口径收敛（重点：business logic + AGENTS）

### Task 4: 更新 `Extensions/WebClipper/AGENTS.md` 的构建发布说明

**Files:**
- Modify: `Extensions/WebClipper/AGENTS.md`

**Step 1: 实现**
- 将命令章节中 `legacy` 前缀命令改为“CI 产物流程”描述：
  - 本地只保留 WXT 开发/验证命令；
  - 发布打包由 GitHub Actions + `.github/scripts/webclipper/*` 负责。
- 删除/替换“脚本名保留 legacy 前缀”相关文案。
- 保留 `legacy JSON 导入` 的业务说明（不可删除）。

**Step 2: 验证**
- Run: `rg "legacy:build|脚本名保留 legacy 前缀|check:dist|package:amo-source" Extensions/WebClipper/AGENTS.md -n`
- Expected: 无旧构建命名残留（业务 `legacy JSON` 描述可保留）。

**Step 3: 原子提交**
- Run: `git add Extensions/WebClipper/AGENTS.md`
- Run: `git commit -m "docs: task4 - align webclipper agents docs with ci-only packaging flow"`

---

### Task 5: 更新 `.github/docs/business-logic.md` 与仓库根 AGENTS 索引

**Files:**
- Modify: `.github/docs/business-logic.md`
- Modify: `AGENTS.md`

**Step 1: 实现**
- `business-logic.md`：
  - 修正与现状冲突的描述（例如 Obsidian 输出路径应体现 Local REST API 写入，而非 URL Scheme 新建请求）。
  - 明确 `legacy JSON 导入` 是“数据导入兼容策略”，不是构建发布流程。
- 根 `AGENTS.md`：
  - 核对 WebClipper 指南链接路径与当前目录一致（`LocalRestAPI.zh.md` 等）。
  - 增补“WebClipper 发布产物由 GitHub Actions 生成”的简短说明（如需）。

**Step 2: 验证**
- Run: `rg "obsidian://new|legacy:build|package:amo-source|webclipper-obsidian-local-rest-api-sync" .github/docs/business-logic.md AGENTS.md -n`
- Expected: 文档无过时发布命名；Obsidian 说明与当前架构一致。

**Step 3: 原子提交**
- Run: `git add .github/docs/business-logic.md AGENTS.md`
- Run: `git commit -m "docs: task5 - refresh business logic and root agents for wxt ci release flow"`

---

## P4：总体验收与回归

### Task 6: 端到端回归与收口检查

**Files:**
- Modify（如需补丁）: 本次涉及文件

**Step 1: 验证命令**
- Run: `npm --prefix Extensions/WebClipper run compile`
- Run: `npm --prefix Extensions/WebClipper run test --silent`
- Run: `npm --prefix Extensions/WebClipper run build`
- Run: `npm --prefix Extensions/WebClipper run check:no-runtime-js`
- Run: `node .github/scripts/webclipper/package-release-assets.mjs --target=chrome --zip --zip-name=SyncNos-WebClipper-chrome-smoke.zip`
- Run: `node .github/scripts/webclipper/package-release-assets.mjs --target=edge --out=dist-edge --zip --zip-name=SyncNos-WebClipper-edge-smoke.zip`
- Run: `node .github/scripts/webclipper/package-release-assets.mjs --target=firefox --zip --zip-name=SyncNos-WebClipper-firefox-smoke.xpi`
- Run: `rg "legacy:build|check:dist:|package:amo-source" Extensions/WebClipper/package.json Extensions/WebClipper/AGENTS.md .github/docs/business-logic.md README.md README.zh-CN.md -n`

**Expected:**
- 编译/测试/构建通过；
- 三类 smoke 打包产物生成；
- 文档与脚本中无旧构建命名残留（`legacy JSON` 兼容描述保留）。

**Step 2: 原子提交**
- 若仅验收无代码改动可不提交；
- 若有修复补丁：
  - Run: `git add <修复文件>`
  - Run: `git commit -m "chore: task6 - finalize ci packaging migration and docs cleanup"`

---

## 回归策略（分组结束）

- P1 结束：检查 workflow 引用与脚本路径一致性。
- P2 结束：检查 `package.json` 仅保留开发/验证命令。
- P3 结束：检查 business logic + AGENTS 文档口径一致。
- P4 结束：跑完整编译/测试/构建/打包 smoke，并确认无发布命名遗留。

---

## 风险与应对

1. **风险：脚本搬家后路径解析错误（repo root vs extension root）**
   - 应对：统一封装 `resolveWebClipperRoot()`，每个脚本首步校验关键文件存在（如 `Extensions/WebClipper/package.json`）。
2. **风险：workflow 与产物命名不一致，导致 release 上传失败**
   - 应对：保持历史产物命名完全一致；在 release workflow 增加 `ls -la` 断言步骤（必要时）。
3. **风险：文档删词过度误伤业务兼容语义**
   - 应对：明确只删“构建发布 legacy 命名”，保留“legacy JSON 导入”业务兼容说明。
4. **风险：本地不再提供 npm 打包命令后，团队误用旧文档**
   - 应对：优先更新 `Extensions/WebClipper/AGENTS.md` 与 `.github/docs/business-logic.md`，并在根 AGENTS 标注 CI-only 发布约束。

---

## 执行入口建议

- 下一步可直接进入：`$executing-plans`
- 建议批次：`P1 + P2` 一批，`P3 + P4` 一批（每批结束回报验证结果）。
