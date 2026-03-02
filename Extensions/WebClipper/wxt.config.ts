import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

const READABILITY_FILE = 'src/collectors/web/readability.js';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // Keep legacy article fetch working during migration:
    // `chrome.scripting.executeScript({ files: ["src/collectors/web/readability.js"] })`
    // requires the file to exist in the final extension package, but WXT only
    // auto-copies `public/` by default. So we explicitly copy the legacy file.
    'build:publicAssets': (_wxt, files) => {
      files.push({
        absoluteSrc: resolve(process.cwd(), READABILITY_FILE),
        relativeDest: READABILITY_FILE,
      });
    },
    // Also allow `browser.runtime.getURL("src/collectors/web/readability.js")` in TS.
    'prepare:publicPaths': (_wxt, paths) => {
      paths.push(READABILITY_FILE);
    },
  },
  manifest: {
    // P1-05: migrate-time behavior. Keep permissions aligned with `manifest.json`;
    // do not "optimize" permissions/hosts during the scaffolding migration.
    name: 'SyncNos-AI+Web Clipper',
    version: '0.18.0',
    description:
      'Clip AI chats to local storage, export to JSON or Markdown, and sync to Notion on demand.',
    permissions: [
      'storage',
      'downloads',
      'tabs',
      'webNavigation',
      'activeTab',
      'scripting',
    ],
    host_permissions: [
      'https://chat.openai.com/*',
      'https://chatgpt.com/*',
      'https://www.chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
      'https://chat.deepseek.com/*',
      'https://chat.z.ai/*',
      'https://kimi.moonshot.cn/*',
      'https://kimi.com/*',
      'https://*.kimi.com/*',
      'https://www.doubao.com/*',
      'https://yuanbao.tencent.com/*',
      'https://poe.com/*',
      'https://*.notion.so/*',
      'https://*.notionusercontent.com/*',
      'https://img.notionusercontent.com/*',
      'https://api.notion.com/*',
      'https://syncnos-notion-oauth.chiimagnus.workers.dev/*',
      'https://chiimagnus.github.io/*',
      'http://*/*',
      'https://*/*',
    ],
  },
});
