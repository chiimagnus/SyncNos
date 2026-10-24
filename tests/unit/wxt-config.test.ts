import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import type { ConfigEnv, TargetBrowser } from 'wxt';

import { KEYBOARD_SHORTCUT_COMMAND_ORDER } from '../../src/services/shortcuts/keyboard-shortcut-contract';
import wxtConfig from '../../wxt.config';

function buildEnv(browser: TargetBrowser): ConfigEnv {
  return {
    mode: 'production',
    command: 'build',
    browser,
    manifestVersion: 3,
  };
}

async function resolveViteConfig(browser: TargetBrowser) {
  if (!wxtConfig.vite) throw new Error('WXT vite config callback is missing');
  return await wxtConfig.vite(buildEnv(browser));
}

async function resolveManifest(browser: TargetBrowser) {
  if (!wxtConfig.manifest) throw new Error('WXT manifest config is missing');
  return typeof wxtConfig.manifest === 'function' ? await wxtConfig.manifest(buildEnv(browser)) : wxtConfig.manifest;
}

function loadManifestLocale(locale: 'en' | 'zh_CN' | 'zh_TW') {
  return JSON.parse(
    fs.readFileSync(new URL(`../../public/_locales/${locale}/messages.json`, import.meta.url), 'utf8'),
  ) as Record<string, { message?: string }>;
}

describe('WXT browser-scoped Vite config', () => {
  it('disables JS module preload only for Chrome builds', async () => {
    const chrome = await resolveViteConfig('chrome');
    const firefox = await resolveViteConfig('firefox');
    const safari = await resolveViteConfig('safari');

    expect(chrome.build?.modulePreload).toBe(false);
    expect(firefox.build?.modulePreload).toBeUndefined();
    expect(safari.build?.modulePreload).toBeUndefined();
  });

  it('resolves ESM imports and CommonJS requires to one KaTeX engine without redirecting CSS', async () => {
    for (const browser of ['chrome', 'firefox', 'safari'] as const) {
      const config = await resolveViteConfig(browser);
      const aliases = config.resolve?.alias;
      if (!Array.isArray(aliases)) throw new Error('Expected ordered Vite aliases');
      const katexAlias = aliases.find((alias) => alias.find instanceof RegExp && alias.find.test('katex'));
      expect(katexAlias?.replacement).toBe(path.resolve('node_modules/katex/dist/katex.mjs'));
      expect(fs.existsSync(katexAlias!.replacement)).toBe(true);
      expect((katexAlias!.find as RegExp).test('katex/dist/katex.min.css')).toBe(false);
    }
  });

  it('keeps the shared chunk warning limit for every browser', async () => {
    for (const browser of ['chrome', 'firefox', 'safari'] as const) {
      const config = await resolveViteConfig(browser);
      expect(config.build?.chunkSizeWarningLimit).toBe(2000);
    }
  });

  it('keeps every supported manifest on a single background actor', async () => {
    for (const browser of ['chrome', 'firefox', 'safari'] as const) {
      const manifest = await resolveManifest(browser);
      expect(manifest.incognito).not.toBe('split');
    }
  });

  it('keeps only the canonical explicit ChatGPT web-accessible-resource match', async () => {
    const manifest = await resolveManifest('chrome');
    const matches = manifest.web_accessible_resources?.flatMap((entry: any) => entry.matches || []) || [];
    expect(matches).toContain('https://chatgpt.com/*');
    expect(matches).not.toContain('https://www.chatgpt.com/*');
    expect(matches).not.toContain('https://chat.openai.com/*');
  });

  it('declares nativeMessaging as optional only for Chrome and Firefox builds', async () => {
    const chrome = await resolveManifest('chrome');
    const firefox = await resolveManifest('firefox');
    const safari = await resolveManifest('safari');

    expect(chrome.permissions).not.toContain('nativeMessaging');
    expect(firefox.permissions).not.toContain('nativeMessaging');
    expect(chrome.optional_permissions).toEqual(['nativeMessaging']);
    expect(firefox.optional_permissions).toEqual(['nativeMessaging']);
    expect(safari.permissions).not.toContain('nativeMessaging');
    expect(safari.optional_permissions).toBeUndefined();
  });

  it('registers the existing app settings route as the browser-native options page', async () => {
    for (const browser of ['chrome', 'firefox', 'safari'] as const) {
      const manifest = await resolveManifest(browser);
      expect(manifest.options_ui).toEqual({
        page: 'app.html#/settings',
        open_in_tab: true,
      });
    }
  });

  it('declares the same unbound keyboard commands for every browser', async () => {
    for (const browser of ['chrome', 'firefox', 'safari'] as const) {
      const manifest = await resolveManifest(browser);
      expect(Object.keys(manifest.commands ?? {})).toEqual([...KEYBOARD_SHORTCUT_COMMAND_ORDER]);
      for (const command of Object.values(manifest.commands ?? {})) {
        expect(command).not.toHaveProperty('suggested_key');
        expect(command).not.toHaveProperty('global');
      }
    }
  });

  it('keeps localized custom-command descriptions resolvable from manifest locales', async () => {
    const manifest = await resolveManifest('chrome');
    expect(manifest.commands?.['capture-current-page']?.description).toBe(
      '__MSG_commandCaptureCurrentPageDescription__',
    );
    expect(manifest.commands?.['open-syncnos-app']?.description).toBe('__MSG_commandOpenSyncnosTabDescription__');
    expect(manifest.commands?.['_execute_action']?.description).toBeUndefined();

    for (const locale of ['en', 'zh_CN', 'zh_TW'] as const) {
      const messages = loadManifestLocale(locale);
      expect(messages.commandCaptureCurrentPageDescription?.message).toBeTruthy();
      expect(messages.commandOpenSyncnosTabDescription?.message).toBeTruthy();
    }
  });
});
