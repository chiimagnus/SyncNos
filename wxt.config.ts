import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { defineConfig, type UserManifestFn } from 'wxt';

import { KEYBOARD_SHORTCUT_COMMAND_IDS } from './src/services/shortcuts/keyboard-shortcut-contract';

const viteAlias = {
  '@ui': path.resolve('src/ui'),
  '@viewmodels': path.resolve('src/viewmodels'),
  '@services': path.resolve('src/services'),
  '@platform': path.resolve('src/platform'),
  '@collectors': path.resolve('src/collectors'),
  '@entrypoints': path.resolve('src/entrypoints'),
  '@i18n': path.resolve('src/ui/i18n'),
};

function filterKatexWoff2(source: string, id: string): string {
  const css = postcss.parse(source, { from: id });
  css.walkAtRules('font-face', (rule) => {
    rule.walkDecls('src', (decl) => {
      const woff2 = decl.value.split(',').find((entry) => entry.includes('.woff2'));
      if (!woff2) throw decl.error('KaTeX font face must provide a WOFF2 source');
      decl.value = woff2.trim();
    });
  });
  return css.toString();
}

// Vite library-mode content scripts inline every asset in CSS ?inline, regardless
// of assetsInlineLimit. Emit shared font assets explicitly through Rollup instead.
function katexShadowStyles() {
  const publicId = 'virtual:syncnos-katex-shadow-css';
  const virtualId = `\0${publicId}`;
  const references = new Set<string>();
  let isBuild = true;
  return {
    name: 'katex-shadow-styles',
    configResolved(config: { command: string }) {
      isBuild = config.command === 'build';
    },
    resolveId(id: string) {
      if (id === publicId) return virtualId;
    },
    load(
      this: { emitFile: (asset: { type: 'asset'; name: string; fileName: string; source: Buffer }) => string },
      id: string,
    ) {
      if (id !== virtualId) return;
      const sourcePath = path.resolve('node_modules/katex/dist/katex.min.css');
      const css = postcss.parse(filterKatexWoff2(fs.readFileSync(sourcePath, 'utf8'), sourcePath));
      const urls: string[] = [];
      css.walkAtRules('font-face', (rule) => {
        rule.walkDecls('src', (decl) => {
          decl.value = decl.value.replace(/url\((['"]?)([^)'"\s]+)\1\)/, (_match, _quote, relativePath: string) => {
            const fontPath = path.resolve(path.dirname(sourcePath), relativePath);
            let expression: string;
            if (isBuild) {
              const ref = this.emitFile({
                type: 'asset',
                name: path.basename(fontPath),
                fileName: `assets/${path.basename(fontPath)}`,
                source: fs.readFileSync(fontPath),
              });
              references.add(ref);
              expression = `import.meta.ROLLUP_FILE_URL_${ref}`;
            } else {
              expression = `new URL(${JSON.stringify(`/@fs/${fontPath.replaceAll('\\', '/')}`)}, import.meta.url).href`;
            }
            const index = urls.push(expression) - 1;
            return `url(__SYNCNOS_KATEX_FONT_${index}__)`;
          });
        });
      });
      const code = JSON.stringify(css.toString()).replace(
        /__SYNCNOS_KATEX_FONT_(\d+)__/g,
        (_match, index: string) => `" + ${urls[Number(index)]} + "`,
      );
      return `export default ${code};`;
    },
    resolveFileUrl({ referenceId, fileName }: { referenceId: string; fileName: string }) {
      if (references.has(referenceId)) return JSON.stringify(`/${fileName}`);
    },
  };
}

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

const resolveManifest: UserManifestFn = (env) => {
  const isSafari = env.browser === 'safari';

  // Base permissions shared by all browsers.
  const permissions: string[] = ['storage', 'contextMenus', 'tabs', 'webNavigation', 'scripting', 'alarms'];

  // `declarativeNetRequestWithHostAccess` is Chrome 128+; Safari uses the
  // plain `declarativeNetRequest` permission instead.  The runtime code
  // already feature-detects DNR and falls back to fetch when unavailable.
  if (isSafari) {
    permissions.push('declarativeNetRequest');
  } else {
    permissions.push('declarativeNetRequestWithHostAccess');
  }

  return {
    name: isSafari ? '__MSG_name__' : '__MSG_extName__',
    version: '1.16.1',
    description: isSafari ? '__MSG_description__' : '__MSG_extDescription__',
    default_locale: 'en',
    permissions,
    options_ui: {
      page: 'app.html#/settings',
      open_in_tab: true,
    },
    commands: {
      [KEYBOARD_SHORTCUT_COMMAND_IDS.openPopup]: {},
      [KEYBOARD_SHORTCUT_COMMAND_IDS.captureCurrentPage]: {
        description: '__MSG_commandCaptureCurrentPageDescription__',
      },
      [KEYBOARD_SHORTCUT_COMMAND_IDS.openTab]: {
        description: '__MSG_commandOpenSyncnosTabDescription__',
      },
    },
    ...(isSafari ? {} : { optional_permissions: ['nativeMessaging'] }),
    host_permissions: ['http://*/*', 'https://*/*'],
    web_accessible_resources: [
      {
        resources: ['assets/KaTeX_*.woff2'],
        matches: ['http://*/*', 'https://*/*'],
      },
      {
        resources: ['icons/icon-128.png'],
        matches: [
          'https://chatgpt.com/*',
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
          'https://app.notion.com/*',
          'https://*.app.notion.com/*',
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
  };
};

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  entrypointsDir: 'src/entrypoints',
  webExt: chromeBinary ? { binaries: { chrome: chromeBinary } } : undefined,
  vite: (env) => ({
    plugins: [katexShadowStyles()],
    define: {
      __SYNCNOS_FEISHU_OAUTH_CLIENT_ID__: JSON.stringify(process.env.SYNCNOS_FEISHU_OAUTH_CLIENT_ID ?? ''),
      __SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL__: JSON.stringify(
        process.env.SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL ?? '',
      ),
    },
    resolve: {
      alias: [
        { find: /^katex$/, replacement: path.resolve('node_modules/katex/dist/katex.mjs') },
        ...Object.entries(viteAlias).map(([find, replacement]) => ({ find, replacement })),
      ],
    },
    build: {
      // Some dependencies (notably `entities` via markdown-it) store compact lookup tables
      // with escaped C0 bytes. The default production minifier can emit those as raw bytes,
      // which Chromium rejects when loading extension scripts. Terser ascii_only keeps them escaped.
      minify: 'terser',
      terserOptions: {
        format: {
          ascii_only: true,
        },
      },
      // Chromium 152 can reject extension-page modulepreload reuse as a cross-world resource mismatch.
      // Firefox/Safari keep Vite's default preload behavior; real ESM imports are unchanged.
      ...(env.browser === 'chrome' ? { modulePreload: false } : {}),
      // KaTeX/Recharts can legitimately push some chunks beyond Vite's default 500kB warning threshold.
      // Keep the warning signal meaningful by using a higher, extension-appropriate limit.
      chunkSizeWarningLimit: 2000,
    },
  }),
  manifest: resolveManifest,
});
