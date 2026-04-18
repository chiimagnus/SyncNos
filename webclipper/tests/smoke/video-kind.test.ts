import { describe, expect, it } from 'vitest';
import { conversationKinds } from '@services/protocols/conversation-kinds.ts';

describe('video kind', () => {
  it('registers SyncNos-Videos notion db spec', () => {
    const list = conversationKinds.list();
    const video = list.find((k) => k && k.id === 'video') as any;
    expect(video).toBeTruthy();
    expect(String(video?.notion?.dbSpec?.title || '')).toBe('SyncNos-Videos');
    expect(String(video?.notion?.dbSpec?.storageKey || '')).toBe('notion_db_id_syncnos_videos');
  });
});
