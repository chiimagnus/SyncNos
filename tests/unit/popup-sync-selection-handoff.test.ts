import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageGetMock = vi.fn();
const storageSetMock = vi.fn();
const storageOnChangedMock = vi.fn();

vi.mock('@services/shared/storage', () => ({
  storageGet: (...args: unknown[]) => storageGetMock(...args),
  storageSet: (...args: unknown[]) => storageSetMock(...args),
  storageOnChanged: (...args: unknown[]) => storageOnChangedMock(...args),
}));

import {
  POPUP_SYNC_SELECTION_HANDOFF_KEY,
  publishPopupSyncSelectionHandoff,
  readPopupSyncSelectionHandoff,
  subscribePopupSyncSelectionHandoff,
} from '@services/conversations/popup-sync-selection-handoff';

describe('popup sync selection handoff', () => {
  beforeEach(() => {
    vi.useRealTimers();
    storageGetMock.mockReset();
    storageSetMock.mockReset();
    storageOnChangedMock.mockReset();
  });

  it('publishes one normalized transient selection payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T02:30:00Z'));

    await publishPopupSyncSelectionHandoff([3, 2, 3, 0, -1, Number.NaN, 5.5] as number[]);

    expect(storageSetMock).toHaveBeenCalledWith({
      [POPUP_SYNC_SELECTION_HANDOFF_KEY]: { conversationIds: [3, 2], createdAt: Date.now() },
    });
  });

  it('reads fresh payloads and rejects expired, far-future, or malformed values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T02:30:00Z'));
    const now = Date.now();

    storageGetMock.mockImplementationOnce(async ([key]: [string]) => ({
      [key]: { conversationIds: [7, 7, 8], createdAt: now - 1_000 },
    }));
    expect(await readPopupSyncSelectionHandoff()).toEqual([7, 8]);

    storageGetMock.mockImplementationOnce(async ([key]: [string]) => ({
      [key]: { conversationIds: [7], createdAt: now - 60_001 },
    }));
    expect(await readPopupSyncSelectionHandoff()).toBeNull();

    storageGetMock.mockImplementationOnce(async ([key]: [string]) => ({
      [key]: { conversationIds: [9], createdAt: now + 60_001 },
    }));
    expect(await readPopupSyncSelectionHandoff()).toBeNull();

    storageGetMock.mockImplementationOnce(async ([key]: [string]) => ({
      [key]: { conversationIds: ['nope'], createdAt: now },
    }));
    expect(await readPopupSyncSelectionHandoff()).toBeNull();
  });

  it('emits only fresh local-storage handoff changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T02:30:00Z'));
    const now = Date.now();
    let storageListener: ((changes: any, areaName: string) => void) | null = null;
    const unsubscribe = vi.fn();
    storageOnChangedMock.mockImplementation((listener) => {
      storageListener = listener;
      return unsubscribe;
    });
    const onSelection = vi.fn();

    const cleanup = subscribePopupSyncSelectionHandoff(onSelection);
    storageListener?.(
      { [POPUP_SYNC_SELECTION_HANDOFF_KEY]: { newValue: { conversationIds: [9, 9, 10], createdAt: now } } },
      'local',
    );
    storageListener?.(
      { [POPUP_SYNC_SELECTION_HANDOFF_KEY]: { newValue: { conversationIds: [11], createdAt: now } } },
      'sync',
    );
    storageListener?.(
      { [POPUP_SYNC_SELECTION_HANDOFF_KEY]: { newValue: { conversationIds: [12], createdAt: now - 60_001 } } },
      'local',
    );

    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(onSelection).toHaveBeenCalledWith([9, 10]);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
