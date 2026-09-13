import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  launch: vi.fn(),
}));

vi.mock('@services/integrations/openin/openin-targets', () => {
  class OpenTargetError extends Error {
    code: string;
    extra: Record<string, unknown> | null;
    constructor(code: string, message: string, extra: Record<string, unknown> | null = null) {
      super(message);
      this.code = code;
      this.extra = extra;
    }
  }
  return {
    OpenTargetError,
    resolveOpenTargetsByConversationId: (...args: unknown[]) => mocks.resolve(...args),
    launchOpenTargetByConversationId: (...args: unknown[]) => mocks.launch(...args),
  };
});

import { registerOpenTargetHandlers } from '@services/integrations/openin/background-handlers';
import { OpenTargetError } from '@services/integrations/openin/openin-targets';
import { OPEN_TARGET_MESSAGE_TYPES } from '@services/protocols/message-contracts';

function createRouter() {
  const handlers = new Map<string, (message: any) => Promise<any> | any>();
  return {
    handlers,
    ok: (data: unknown) => ({ ok: true, data, error: null }),
    err: (message: string, extra: unknown = null) => ({ ok: false, data: null, error: { message, extra } }),
    register: (type: string, handler: (message: any) => Promise<any> | any) => handlers.set(type, handler),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('open target background handlers', () => {
  it('resolves by conversation id and optional provider without forwarding arbitrary URL fields', async () => {
    const router = createRouter();
    registerOpenTargetHandlers(router);
    mocks.resolve.mockResolvedValue([{ provider: 'source', available: true, target: 'https://current.example/' }]);

    const response = await router.handlers.get(OPEN_TARGET_MESSAGE_TYPES.RESOLVE)?.({
      conversationId: 7,
      target: 'source',
      url: 'javascript:alert(1)',
    });

    expect(response).toEqual({
      ok: true,
      data: { targets: [{ provider: 'source', available: true, target: 'https://current.example/' }] },
      error: null,
    });
    expect(mocks.resolve).toHaveBeenCalledWith({ conversationId: 7, target: 'source' });
  });

  it('launches only by conversation id + provider and ignores caller URL/path payloads', async () => {
    const router = createRouter();
    registerOpenTargetHandlers(router);
    mocks.launch.mockResolvedValue({
      ok: true,
      target: {
        provider: 'notion',
        available: true,
        kind: 'external-url',
        target: 'https://www.notion.so/current',
        availabilityState: 'ready',
      },
    });

    const response = await router.handlers.get(OPEN_TARGET_MESSAGE_TYPES.LAUNCH)?.({
      conversationId: 9,
      target: 'notion',
      url: 'https://attacker.example/',
      resolvedNotePath: '/tmp/attacker.md',
    });

    expect(response).toMatchObject({ ok: true, data: { launched: true, target: { provider: 'notion' } } });
    expect(mocks.launch).toHaveBeenCalledWith({ conversationId: 9, target: 'notion' });
  });

  it('preserves safe unavailable target state as structured Background error metadata', async () => {
    const router = createRouter();
    registerOpenTargetHandlers(router);
    mocks.launch.mockResolvedValue({
      ok: false,
      target: {
        provider: 'github',
        available: false,
        kind: 'external-url',
        availabilityState: 'not_synced',
        error: { code: 'not_synced', message: 'github target is unavailable.' },
      },
      error: { code: 'not_synced', message: 'github target is unavailable.' },
    });

    const response = await router.handlers.get(OPEN_TARGET_MESSAGE_TYPES.LAUNCH)?.({
      conversationId: 10,
      target: 'github',
    });
    expect(response).toMatchObject({
      ok: false,
      error: {
        message: 'github target is unavailable.',
        extra: { code: 'not_synced', target: { provider: 'github', availabilityState: 'not_synced' } },
      },
    });
  });

  it('maps domain validation failures to stable safe codes', async () => {
    const router = createRouter();
    registerOpenTargetHandlers(router);
    mocks.resolve.mockRejectedValue(
      new OpenTargetError('conversation_not_found', 'Conversation not found', { conversationId: 404 }),
    );

    const response = await router.handlers.get(OPEN_TARGET_MESSAGE_TYPES.RESOLVE)?.({ conversationId: 404 });
    expect(response).toEqual({
      ok: false,
      data: null,
      error: {
        message: 'Conversation not found',
        extra: { code: 'conversation_not_found', details: { conversationId: 404 } },
      },
    });
  });
});
