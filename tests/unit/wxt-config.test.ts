import { describe, expect, it } from 'vitest';
import type { ConfigEnv, TargetBrowser } from 'wxt';

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

describe('WXT browser-scoped Vite config', () => {
  it('disables JS module preload only for Chrome builds', async () => {
    const chrome = await resolveViteConfig('chrome');
    const firefox = await resolveViteConfig('firefox');
    const safari = await resolveViteConfig('safari');

    expect(chrome.build?.modulePreload).toBe(false);
    expect(firefox.build?.modulePreload).toBeUndefined();
    expect(safari.build?.modulePreload).toBeUndefined();
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
});
