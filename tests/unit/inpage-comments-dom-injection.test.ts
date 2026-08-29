import { describe, expect, it, vi } from 'vitest';
import { createInpageCommentsPanelController } from '../../src/services/bootstrap/inpage-comments-panel-content-handlers';

const disposeSession = vi.fn();
vi.mock('../../src/services/comments/sidebar/comment-sidebar-session', () => ({
  createCommentSidebarSession: () => ({ dispose: disposeSession }),
}));
const createInpageAdapter = vi.fn((_runtime: any) => ({ findExistingContext: vi.fn() }));
vi.mock('../../src/services/comments/sidebar/article-comments-sidebar-inpage-adapter', () => ({
  createArticleCommentsSidebarInpageAdapter: (runtime: any) => createInpageAdapter(runtime),
}));
const open = vi.fn(async () => {});
const disposeController = vi.fn();
vi.mock('../../src/services/comments/sidebar/article-comments-sidebar-controller', () => ({
  createArticleCommentsSidebarController: (input: any) => ({
    open: (value: any) => open(value),
    dispose: disposeController,
    resolveComposerSelection: input.resolveComposerSelection,
  }),
}));

describe('inpage comments DOM injection', () => {
  it('uses the injected DOM source without reading page globals and wires runtime into the readonly adapter', async () => {
    const resolveComposerSelection = vi.fn(() => ({ selectionText: 'quote', locator: { v: 2 } }));
    const runtime = { send: vi.fn() };
    const controller = createInpageCommentsPanelController(runtime, {
      createPanelApi: () => ({}) as any,
      domSource: {
        resolveComposerSelection,
        isTopFrame: () => true,
        readPageUrl: () => 'https://example.com/article?utm_source=x',
      },
    });

    await controller.open({ tabId: 7, focusComposer: true });

    expect(createInpageAdapter).toHaveBeenCalledWith(runtime);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        focusComposer: true,
        source: 'inpage',
        ensureContextInput: expect.objectContaining({
          tabId: 7,
          canonicalUrlFallback: 'https://example.com/article?utm_source=x',
        }),
      }),
    );
  });

  it('does not open from a child frame', async () => {
    open.mockClear();
    const controller = createInpageCommentsPanelController(null, {
      createPanelApi: () => ({}) as any,
      domSource: {
        resolveComposerSelection: () => ({ selectionText: '', locator: null }),
        isTopFrame: () => false,
        readPageUrl: () => 'https://example.com',
      },
    });

    await controller.open();
    expect(open).not.toHaveBeenCalled();
  });

  it('disposes once and ignores later open requests', async () => {
    open.mockClear();
    disposeController.mockClear();
    disposeSession.mockClear();
    const controller = createInpageCommentsPanelController(null, {
      createPanelApi: () => ({}) as any,
      domSource: {
        resolveComposerSelection: () => ({ selectionText: '', locator: null }),
        isTopFrame: () => true,
        readPageUrl: () => 'https://example.com',
      },
    });

    controller.dispose();
    controller.dispose();
    await controller.open();

    expect(disposeController).toHaveBeenCalledTimes(1);
    expect(disposeSession).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
