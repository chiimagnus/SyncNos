# WebClipper 脚手架迁移方案
## 目标

把 WebClipper 从「IIFE + `globalThis.WebClipper` 手工装配 + 自研 concat 构建」迁移到 **WXT 框架**，实现：

- 扩展内 SPA（`chrome-extension://<id>/app.html`），加页面 = 加路由
- popup 瘦身为快捷入口，复杂功能跳 `app.html#/xxx`
- 多浏览器构建（Chrome / Firefox / Edge）开箱即用
- 业务逻辑（采集/存储/同步）平移，不重写

---

## 技术选型

| 层 | 选型 | 理由 |
| --- | --- | --- |
| **脚手架** | WXT | 自动生成 manifest、content script 打包为 IIFE、Firefox MV2 fallback 内置、dev 时自动 reload 扩展。底层就是 Vite。 |
| **UI 框架** | React 18+ (或 Preact) | 生态最大、Router 成熟、和未来 web app 共享组件最方便。Preact 可 alias 替换，体积更小。 |
| **语言** | TypeScript (strict) | 模块边界靠类型守住，不靠人 |
| **路由** | React Router v7+ | app.html 内 SPA 路由，hash mode（扩展页不走 HTTP） |
| **状态管理** | Zustand | 轻量、TS 友好、不绑 React 组件树（background 里也能用 store 逻辑） |
| **样式** | Tailwind CSS 4 | 原子类 + purge，扩展包体积可控。content script UI 用 Shadow DOM 隔离 |
| **测试** | Vitest + @webext-core/fake-browser | WXT 生态自带 fake browser API，单测不用真扩展环境 |

---

## WXT 项目结构

```
Extensions/WebClipper/
├── entrypoints/
│   ├── background.ts              # Service Worker 入口
│   ├── popup/                     # 弹窗（轻量快捷操作）
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx
│   ├── app.html                   # ⭐ 扩展内 SPA（unlisted page）
│   ├── app/                       # app.html 的 React 入口
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── routes/
│   │       ├── Conversations.tsx
│   │       ├── SyncJobs.tsx
│   │       ├── Settings.tsx
│   │       └── Debug.tsx
│   └── content.ts                 # Content Script 入口
├── lib/                           # ⭐ 平移过来的业务逻辑
│   ├── protocols/
│   │   └── message-contracts.ts   # ← 从 src/protocols/ 迁移
│   ├── storage/
│   │   ├── schema.ts              # ← IndexedDB schema + migration
│   │   ├── background-storage.ts
│   │   └── incremental-updater.ts
│   ├── collectors/
│   │   ├── registry.ts
│   │   └── runtime-observer.ts
│   ├── messaging/
│   │   └── bridge.ts              # WXT messaging wrapper
│   └── stores/                    # Zustand stores
│       ├── sync-store.ts
│       └── ui-store.ts
├── components/                    # popup 和 app 共享的 React 组件
│   ├── ChatList.tsx
│   ├── SyncStatus.tsx
│   └── ...
├── assets/
│   └── icons/
├── public/
├── wxt.config.ts                  # WXT 配置（替代 manifest.json）
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 关键配置

### wxt.config.ts

```tsx
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SyncNos WebClipper',
    permissions: ['storage', 'activeTab', 'tabs'],
    // 按需申请，不用 <all_urls>
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
  // 多浏览器
  browser: 'chrome', // dev 默认，build 时 --browser firefox
});
```

### app.html（unlisted page = 扩展内 SPA）

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SyncNos</title>
    <!-- WXT unlisted page 不会出现在 manifest 的 chrome_url_overrides 里 -->
    <!-- 用户通过 chrome.runtime.getURL('app.html') 打开 -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./app/main.tsx"></script>
  </body>
</html>
```

### app/main.tsx

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Conversations } from './routes/Conversations';
import { SyncJobs } from './routes/SyncJobs';
import { Settings } from './routes/Settings';
import { Debug } from './routes/Debug';
import { AppShell } from '../components/AppShell';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <AppShell>
      <Routes>
        <Route path="/" element={<Conversations />} />
        <Route path="/sync" element={<SyncJobs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/debug" element={<Debug />} />
      </Routes>
    </AppShell>
  </HashRouter>
);
```

### popup → 跳转 app.html

```tsx
// popup/App.tsx 里的「打开完整界面」按钮
const openApp = (path = '/') => {
  const url = browser.runtime.getURL(`/app.html#${path}`);
  browser.tabs.create({ url });
  window.close(); // 关闭 popup
};
```

### background.ts（平移现有路由逻辑）

```tsx
// entrypoints/background.ts
import { setupMessageRouter } from '@/lib/messaging/bridge';
import { initStorage } from '@/lib/storage/background-storage';
import { registerCollectors } from '@/lib/collectors/registry';

export default defineBackground(() => {
  // 初始化存储层（IndexedDB schema + migration）
  initStorage();
  // 注册消息路由（从 background-router.js 迁移）
  setupMessageRouter();
  // 注册采集器
  registerCollectors();
});
```

---

## 迁移步骤（按顺序执行）

### Phase 0：搭骨架（~1h）

- [ ]  `npx wxt@latest init WebClipper-v2 --template react`
- [ ]  安装依赖：`pnpm add react-router-dom zustand`
- [ ]  安装 dev 依赖：`pnpm add -D tailwindcss @tailwindcss/vite`
- [ ]  配置 `wxt.config.ts`（见上）
- [ ]  创建 `app.html` + `entrypoints/app/main.tsx`（unlisted SPA 入口）
- [ ]  跑通 `pnpm dev`，确认 popup 和 app.html 都能打开

### Phase 1：平移业务逻辑到 lib/（~2-3h）

- [ ]  把 `src/protocols/message-contracts.js` → `lib/protocols/message-contracts.ts`（加类型）
- [ ]  把 `src/storage/schema.js` → `lib/storage/schema.ts`
- [ ]  把 `src/bootstrap/background-storage.js` → `lib/storage/background-storage.ts`
- [ ]  把 `src/bootstrap/background-router.js` → `lib/messaging/bridge.ts`
- [ ]  把 `src/collectors/registry.js` + `runtime-observer.js` → `lib/collectors/`
- [ ]  把 `src/storage/incremental-updater.js` → `lib/storage/incremental-updater.ts`
- [ ]  **不改逻辑**，只加 TS 类型 + ESM import/export

### Phase 2：重写 popup UI（~2h）

- [ ]  `entrypoints/popup/App.tsx`：React 组件化
- [ ]  保留核心功能：当前页采集状态、快速保存、打开 app.html 按钮
- [ ]  通过 `browser.runtime.sendMessage` 和 background 通信（复用 message-contracts）

### Phase 3：搭 app.html SPA 路由页面（~3-4h）

- [ ]  `AppShell`：侧边栏导航 + 顶栏
- [ ]  `/`（Conversations）：对话列表，从 IndexedDB 读取
- [ ]  `/sync`（SyncJobs）：同步任务状态、进度、重试
- [ ]  `/settings`：配置项（Notion token、Parent Page 等）
- [ ]  `/debug`：日志查看、IndexedDB 浏览

### Phase 4：迁移 content script（~1-2h）

- [ ]  `entrypoints/content.ts`：WXT 自动打包为 IIFE
- [ ]  迁移 `inpage-button.js` → 用 `createShadowRootUi` 隔离样式
- [ ]  迁移 `content-controller.js` 逻辑

### Phase 5：多浏览器构建验证（~1h）

- [ ]  `pnpm build` → Chrome 产物
- [ ]  `pnpm build --browser firefox` → Firefox 产物（WXT 自动处理 MV2 fallback）
- [ ]  删除旧 `scripts/build.mjs`、`check.mjs`
- [ ]  更新 `AGENTS.md` 反映新项目结构

---

## 架构决策记录

### 为什么 WXT 而不是裸 Vite？

裸 Vite 需要你自己处理：manifest 生成、content script IIFE 打包、Firefox MV2 background.scripts fallback、开发时扩展自动 reload。这些全是 `build.mjs` 目前在做的事。WXT 内置解决了所有这些，底层就是 Vite。

### 为什么 WXT 而不是 Plasmo？

Plasmo 更「opinionated」，自动注入 content script UI 的方式和你现有的手动控制（registry + observer 模式）冲突较大。WXT 更接近原生 Vite，给你更多控制权，迁移摩擦更小。

### 为什么 unlisted page 而不是 newtab / options？

`app.html` 作为 unlisted page 不会覆盖用户的新标签页，不会出现在 manifest 的 `chrome_url_overrides` 里。用户通过 popup 按钮或 `chrome.runtime.getURL()` 主动打开。未来如果要覆盖 newtab，只需加一个 `entrypoints/newtab.html` 指向同一套 React 组件即可。

### 为什么 HashRouter？

扩展页面走 `chrome-extension://` 协议，不经过 HTTP 服务器，没有 server-side fallback。`HashRouter` 是唯一可靠的选择。

### 为什么 Zustand 而不是 Redux / Jotai / Context？

- 比 Redux 轻得多，没有 boilerplate
- Store 逻辑可以脱离 React 组件树（background 里也能用）
- TS 类型推断天然友好
- 你一个人维护，简单就是正义

---

## 给 Codex 的执行指令

复制以下内容直接发给 Codex：

```
用 WXT 重构 Extensions/WebClipper。具体要求：

1. 在 Extensions/ 下用 `npx wxt@latest init WebClipper-v2 --template react` 初始化
2. 安装 @wxt-dev/module-react, react-router-dom, zustand, tailwindcss, @tailwindcss/vite
3. 配置 wxt.config.ts：React 模块、manifest name "SyncNos WebClipper"、permissions: storage + activeTab + tabs、optional_host_permissions: https://*/* + http://*/*
4. 创建 entrypoints/app.html 作为 unlisted page（扩展内 SPA）
5. 创建 entrypoints/app/main.tsx：HashRouter + 4 个路由（/, /sync, /settings, /debug）
6. popup 保持轻量，加一个按钮通过 browser.runtime.getURL('/app.html') 打开完整界面
7. 把现有 src/ 下的业务逻辑平移到 lib/（加 TS 类型，不改逻辑）：
   - protocols/message-contracts → lib/protocols/
   - storage/schema + background-storage + incremental-updater → lib/storage/
   - bootstrap/background-router → lib/messaging/bridge.ts
   - collectors/registry + runtime-observer → lib/collectors/
8. background.ts 调用 lib/ 的初始化函数
9. content.ts 迁移 content-controller + inpage-button，用 createShadowRootUi
10. 确保 pnpm dev 和 pnpm build 都能跑通，pnpm build --browser firefox 也能跑通
11. 不要修改 lib/ 下的业务逻辑，只做 JS→TS 转换和 ESM 化
```