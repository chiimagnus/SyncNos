import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'wxt';

const viteAlias = {
  '@ui': path.resolve('src/ui'),
  '@viewmodels': path.resolve('src/viewmodels'),
  '@services': path.resolve('src/services'),
  '@platform': path.resolve('src/platform'),
  '@collectors': path.resolve('src/collectors'),
  '@entrypoints': path.resolve('src/entrypoints'),
  '@i18n': path.resolve('src/ui/i18n'),
};

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function resolveChromiumBinaryForMac(): string | undefined {
  const configured = process.env.WXT_CHROME_BINARY?.trim();
  if (configured) return configured;

  const defaultChrome = firstExistingPath([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ]);
  if (defaultChrome) return undefined;

  return firstExistingPath([
    '/Applications/Arc.app/Contents/MacOS/Arc',
    path.join(process.env.HOME ?? '', 'Applications/Arc.app/Contents/MacOS/Arc'),
  ]);
}

const chromeBinary = process.platform === 'darwin' ? resolveChromiumBinaryForMac() : undefined;

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  entrypointsDir: 'src/entrypoints',
  webExt: chromeBinary ? { binaries: { chrome: chromeBinary } } : undefined,
  vite: () => ({
    resolve: {
      alias: viteAlias,
    },
    build: {
      // KaTeX/Recharts can legitimately push some chunks beyond Vite's default 500kB warning threshold.
      // Keep the warning signal meaningful by using a higher, extension-appropriate limit.
      chunkSizeWarningLimit: 2000,
    },
  }),
  manifest: {
    name: 'SyncNos-AI+Web Clipper',
    version: '1.4.0',
    description: 'Clip AI chats to local storage, export to JSON or Markdown, and sync to Notion on demand.',
    permissions: ['storage', 'contextMenus', 'tabs', 'webNavigation', 'activeTab', 'scripting'],
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
      128: 'icons/icon-128.png',
    },
  },
});
