import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commandsOnCommand } from '@platform/webext/commands';

const previousBrowser = (globalThis as any).browser;
const previousChrome = (globalThis as any).chrome;

describe('WebExtension commands adapter', () => {
  beforeEach(() => {
    delete (globalThis as any).browser;
    delete (globalThis as any).chrome;
  });

  afterEach(() => {
    if (previousBrowser === undefined) delete (globalThis as any).browser;
    else (globalThis as any).browser = previousBrowser;
    if (previousChrome === undefined) delete (globalThis as any).chrome;
    else (globalThis as any).chrome = previousChrome;
  });

  it('prefers the browser commands listener when available', () => {
    const browserAddListener = vi.fn();
    const chromeAddListener = vi.fn();
    const listener = vi.fn();
    (globalThis as any).browser = { commands: { onCommand: { addListener: browserAddListener } } };
    (globalThis as any).chrome = { commands: { onCommand: { addListener: chromeAddListener } } };

    expect(commandsOnCommand(listener)).toBe(true);

    expect(browserAddListener).toHaveBeenCalledWith(listener);
    expect(chromeAddListener).not.toHaveBeenCalled();
  });

  it('falls back to the chrome commands listener', () => {
    const chromeAddListener = vi.fn();
    const listener = vi.fn();
    (globalThis as any).chrome = { commands: { onCommand: { addListener: chromeAddListener } } };

    expect(commandsOnCommand(listener)).toBe(true);

    expect(chromeAddListener).toHaveBeenCalledWith(listener);
  });

  it('returns false when the commands API is unavailable', () => {
    expect(commandsOnCommand(vi.fn())).toBe(false);
  });

  it('returns false when listener registration throws', () => {
    (globalThis as any).browser = {
      commands: {
        onCommand: {
          addListener: () => {
            throw new Error('unsupported');
          },
        },
      },
    };

    expect(commandsOnCommand(vi.fn())).toBe(false);
  });
});
