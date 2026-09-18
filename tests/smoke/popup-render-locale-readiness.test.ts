import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeLocale: vi.fn(),
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  default: { createRoot: (...args: unknown[]) => mocks.createRoot(...args) },
}));

vi.mock('@ui/popup/PopupShell', () => ({
  default: () => null,
}));

vi.mock('@i18n', () => ({
  initializeLocale: (...args: unknown[]) => mocks.initializeLocale(...args),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe('popup render locale readiness', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => ({ id: 'root' })),
    });
  });

  it('mounts the popup before locale storage readiness settles', async () => {
    const locale = deferred<'zh'>();
    mocks.initializeLocale.mockReturnValue(locale.promise);

    const { mountPopup } = await import('../../src/entrypoints/popup/render');
    mountPopup();

    expect(mocks.createRoot).toHaveBeenCalledTimes(1);
    expect(mocks.render).toHaveBeenCalledTimes(1);

    locale.resolve('zh');
    await flushMicrotasks();

    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it('keeps the first render when locale initialization fails', async () => {
    mocks.initializeLocale.mockRejectedValue(new Error('storage unavailable'));

    const { mountPopup } = await import('../../src/entrypoints/popup/render');
    mountPopup();
    await flushMicrotasks();

    expect(mocks.render).toHaveBeenCalledTimes(1);
  });
});
