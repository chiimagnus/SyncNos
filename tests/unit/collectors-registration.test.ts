import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { SUPPORTED_AI_CHAT_SITES } from '@collectors/ai-chat-sites';
import { createCollectorEnv } from '@collectors/collector-env';
import { registerAllCollectors } from '@collectors/register-all';
import { createCollectorsRegistry } from '@collectors/registry';
import normalizeApi from '@services/shared/normalize';

describe('collector registration', () => {
  it('registers every supported AI chat site and activates Claude on its conversation route', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://claude.ai/chat/conv-1' });
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const registry = createCollectorsRegistry();

    registerAllCollectors(registry, env);

    const registeredIds = new Set(registry.list().map((definition) => definition.id));
    for (const site of SUPPORTED_AI_CHAT_SITES) expect(registeredIds.has(site.id)).toBe(true);
    expect(
      registry.pickActive({
        href: 'https://claude.ai/chat/conv-1',
        hostname: 'claude.ai',
        pathname: '/chat/conv-1',
      })?.id,
    ).toBe('claude');
  });
});
