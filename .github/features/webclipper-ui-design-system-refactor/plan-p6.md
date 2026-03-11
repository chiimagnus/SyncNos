# Plan P6 - webclipper-ui-design-system-refactor

**Goal:** 删除本轮重构遗留的“无引用/多余/老旧”代码，保持 shared helpers 目录干净，避免误用与漂移。

**Non-goals:**
- 不改动 i18n 文案。
- 不进行大范围重构/重命名（只删确定无引用的 dead code，并同步相关文档/审计记录）。

**Acceptance:**
- 删除 `webclipper/src/ui/shared/nav-styles.ts` 中无引用的 helper。
- 所有相关文档与审计记录同步更新。
- `npm --prefix webclipper run compile/test/build` 通过。

---

## P6-T1 删除无引用的 UI 样式 helper

**Files:**
- Modify: `webclipper/src/ui/shared/nav-styles.ts`
- Modify: `.github/features/webclipper-ui-design-system-refactor/buttons-inventory.md`
- Modify: `.github/features/webclipper-ui-design-system-refactor/audit-p4.md`
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`
- Add: `.github/features/webclipper-ui-design-system-refactor/plan-p6.md`

**Step 1: 删除 dead code**
- 删除 `navMiniIconButtonClassName()`（已确认全仓 `webclipper/src/ui/**` 内无调用点）。

**Step 2: 同步文档/审计**
- `buttons-inventory.md` 移除对应条目。
- `audit-p4.md` 将该 finding 标记为已处理（或补充 fix log）。

**Step 3: 验证（快速）**
- Run: `npm --prefix webclipper run compile`

**Step 4: 原子提交**
- Run: `git add webclipper/src/ui/shared/nav-styles.ts .github/features/webclipper-ui-design-system-refactor/buttons-inventory.md .github/features/webclipper-ui-design-system-refactor/audit-p4.md .github/features/webclipper-ui-design-system-refactor/todo.toml .github/features/webclipper-ui-design-system-refactor/plan-p6.md`
- Run: `git commit -m "chore: task27 - 删除无引用的 nav helper"`

---

## P6-T2 Phase 验证（compile/test/build）

**Files:**
- Modify: `.github/features/webclipper-ui-design-system-refactor/todo.toml`

**Step 1: Phase 验证**
- Run: `npm --prefix webclipper run compile`
- Run: `npm --prefix webclipper run test`
- Run: `npm --prefix webclipper run build`

**Step 2: 原子提交**
- Run: `git add .github/features/webclipper-ui-design-system-refactor/todo.toml`
- Run: `git commit -m "chore: task28 - P6 验证通过（compile/test/build）"`

---

## Phase Audit

- Audit file: `audit-p6.md`

