import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectDedaoCourseArticleAnnotationsInMainWorld } from '@collectors/web/dedao-course-article-annotations';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dedao course article annotations', () => {
  it('reads verified Vue markerTexts and skips entries without a stable source id', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://www.dedao.cn/course/article?id=example',
    });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('location', dom.window.location);

    const root = dom.window.document.createElement('div');
    root.className = 'editor-show';
    (root as any).__vue__ = {
      $options: { name: 'RichTextPanelWithMarker' },
      $props: {
        markerTexts: [
          {
            id: 'later',
            meta: {
              noteLine: '纽约出租车司机的每日目标收入。',
              note: '',
              createTime: 20,
              updateTime: 20,
            },
          },
          {
            id: 'note',
            meta: {
              noteLine: '第二是「现状偏见」。',
              note: '我会更喜欢待在学校，习惯作为一个学生。',
              notesOwner: { name: '持弛' },
              createTime: 10,
              updateTime: 11,
            },
          },
          {
            id: 'first',
            meta: {
              noteLine: '人们冒险往往不是为了贪图更多，而是为了“回本”。',
              note: '',
              createTime: 5,
              updateTime: 5,
            },
          },
          {
            meta: {
              noteLine: '没有稳定来源 ID 的条目不会导入。',
              note: '',
              createTime: 30,
              updateTime: 30,
            },
          },
        ],
      },
    };
    dom.window.document.body.append(root);

    const result = collectDedaoCourseArticleAnnotationsInMainWorld();

    expect(result).toMatchObject({ ready: true });
    expect(result.annotations.map((item) => item.id)).toEqual(['later', 'note', 'first']);
    expect(result.annotations[1]).toMatchObject({
      quote: '第二是「现状偏见」。',
      note: '我会更喜欢待在学校，习惯作为一个学生。',
    });
    expect(result.annotations[1]).not.toHaveProperty('authorName');
  });

  it('does not match non-course Dedao pages', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://www.dedao.cn/knowledge/note/detail?id=example',
    });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('location', dom.window.location);

    expect(collectDedaoCourseArticleAnnotationsInMainWorld()).toEqual({ ready: false, annotations: [] });
  });
});
