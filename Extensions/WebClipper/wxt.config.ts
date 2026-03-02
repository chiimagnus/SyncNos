import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

const READABILITY_FILE = 'src/vendor/readability.js';
const PUBLIC_FILES = [
  READABILITY_FILE,
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  // Legacy popup/about assets (kept for migration compatibility).
  'icons/notion.svg',
  'icons/author-avatar.png',
  'icons/buymeacoffee1.jpg',
] as const;

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // Keep article fetch working:
    // `chrome.scripting.executeScript({ files: ["src/vendor/readability.js"] })`
    // requires the file to exist in the final extension package, but WXT only
    // auto-copies `public/` by default. So we explicitly copy the legacy file.
    'build:publicAssets': (_wxt, files) => {
      for (const rel of PUBLIC_FILES) {
        files.push({
          absoluteSrc: resolve(process.cwd(), rel),
          relativeDest: rel,
        });
      }
    },
    // Also allow `browser.runtime.getURL("src/vendor/readability.js")` in TS.
    'prepare:publicPaths': (_wxt, paths) => {
      for (const rel of PUBLIC_FILES) paths.push(rel);
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
    web_accessible_resources: [
      {
        resources: ['icons/icon-128.png'],
        matches: [
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
          'http://*/*',
          'https://*/*',
        ],
      },
    ],
    icons: {
      16: 'icons/icon-16.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
});
