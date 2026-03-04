import { UI_MESSAGE_TYPES } from './message-contracts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type Deps = {
  backgroundInpageWebVisibility: { applyVisibilitySetting?: (input: { reason: string }) => Promise<unknown> } | null;
};

export function registerUiMessageHandlers(router: AnyRouter, deps: Deps) {
  router.register(UI_MESSAGE_TYPES.OPEN_EXTENSION_POPUP, async () => {
    const actionApi = (globalThis as any).chrome?.action ?? (globalThis as any).browser?.action;
    if (!actionApi || typeof actionApi.openPopup !== 'function') {
      return router.err('open popup is not supported in this browser', { code: 'OPEN_POPUP_UNSUPPORTED' });
    }
    try {
      await Promise.resolve(actionApi.openPopup());
      return router.ok({ opened: true });
    } catch (e) {
      const message = (e as any)?.message ?? String(e ?? 'open popup failed');
      return router.err(message, { code: 'OPEN_POPUP_FAILED' });
    }
  });

  router.register(UI_MESSAGE_TYPES.APPLY_INPAGE_VISIBILITY, async () => {
    const api = deps.backgroundInpageWebVisibility;
    if (!api || typeof api.applyVisibilitySetting !== 'function') {
      return router.err('inpage web visibility manager missing', { code: 'INPAGE_VISIBILITY_UNAVAILABLE' });
    }
    const data = await api.applyVisibilitySetting({ reason: 'app' });
    return router.ok(data);
  });
}

