import { describe, expect, it } from 'vitest';
import { conversationKinds } from '@services/protocols/conversation-kinds.ts';

describe('video kind', () => {
  function getVideoKind() {
    const video = conversationKinds.list().find((kind) => kind && kind.id === 'video') as any;
    expect(video).toBeTruthy();
    return video;
  }

  it('registers the stable SyncNos-Videos identity without obsolete diagnostic properties', () => {
    const video = getVideoKind();
    expect(String(video.notion.dbSpec.title || '')).toBe('SyncNos-Videos');
    expect(String(video.notion.dbSpec.storageKey || '')).toBe('notion_db_id_syncnos_videos');
    expect(video.notion.dbSpec.properties).not.toHaveProperty('Transcript Source');
    expect(video.notion.dbSpec.properties).not.toHaveProperty('Has Timestamps');
    expect(video.notion.dbSpec.ensureSchemaPatch).not.toHaveProperty('Transcript Source');
    expect(video.notion.dbSpec.ensureSchemaPatch).not.toHaveProperty('Has Timestamps');
    expect(video.view).toMatchObject({ renderer: 'article', commentsSidebar: false });
    expect(video.obsidian.folder).toBe('SyncNos-Videos');
  });

  it('projects a nullable non-negative Video duration without changing other metadata', () => {
    const pageSpec = getVideoKind().notion.pageSpec;
    const base = {
      title: 'Video',
      url: 'https://www.bilibili.com/video/BV1TEST12345/',
      author: 'Author',
      platform: 'bilibili',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      lastActivityAt: 1_700_000_000_000,
    };

    expect(pageSpec.buildCreateProperties({ ...base, durationSeconds: 123.5 }).Duration).toEqual({ number: 123.5 });
    expect(pageSpec.buildCreateProperties({ ...base, durationSeconds: null }).Duration).toEqual({ number: null });
    expect(pageSpec.buildUpdateProperties({ ...base, durationSeconds: -1 }).Duration).toEqual({ number: null });
    expect(pageSpec.buildUpdateProperties({ ...base, durationSeconds: 'bad' }).Duration).toEqual({ number: null });
    expect(pageSpec.buildCreateProperties(base)).not.toHaveProperty('Transcript Source');
    expect(pageSpec.buildCreateProperties(base)).not.toHaveProperty('Has Timestamps');
  });

  it('keeps Article Comment Threads number semantics unchanged', () => {
    const article = conversationKinds.list().find((kind) => kind && kind.id === 'article') as any;
    const properties = article.notion.pageSpec.buildCreateProperties({
      title: 'Article',
      url: 'https://example.com/article',
      lastActivityAt: 1,
      commentThreadCount: null,
    });
    expect(properties['Comment Threads']).toEqual({ number: 0 });
  });
});
