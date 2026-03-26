import { t } from '@i18n';
import type { ThreadedCommentsPanelChatWithAction, ThreadedCommentsPanelChatWithConfig } from './types';

type CreateChatWithMenuControllerOptions = {
  config: ThreadedCommentsPanelChatWithConfig | null;
  showNotice: (message: string) => void;
};

export type ChatWithMenuController = {
  attachRoot: (root: HTMLElement) => void;
  closeMenu: () => void;
  isMenuOpen: () => boolean;
  handleShadowClick: (target: Element | null) => void;
  handleShadowEscape: (event?: KeyboardEvent | null) => boolean;
  cleanup: () => void;
};

export function createChatWithMenuController(options: CreateChatWithMenuControllerOptions): ChatWithMenuController {
  const config = options.config;
  const showNotice = options.showNotice;

  let rootEl: HTMLElement | null = null;
  let triggerEl: HTMLButtonElement | null = null;
  let triggerClickHandler: ((event: MouseEvent) => void) | null = null;

  const state = {
    open: false,
    loading: false,
    actions: [] as ThreadedCommentsPanelChatWithAction[],
    requestId: 0,
  };

  const defaultTriggerLabel = () => t('detailHeaderChatWithMenuLabel') || 'Chat with...';

  const getTrigger = () =>
    (rootEl?.querySelector?.('.webclipper-inpage-comments-panel__chatwith-trigger') as HTMLButtonElement | null) ??
    null;
  const getMenu = () =>
    (rootEl?.querySelector?.('.webclipper-inpage-comments-panel__chatwith-menu') as HTMLElement | null) ?? null;
  const getMenuBody = () =>
    (rootEl?.querySelector?.('.webclipper-inpage-comments-panel__chatwith-menu-body') as HTMLElement | null) ?? null;

  const closeMenu = () => {
    if (!state.open) return;
    state.open = false;
    const trigger = getTrigger();
    const menu = getMenu();
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  };

  const applyTrigger = (input: { label: string; hasMenu: boolean }) => {
    const trigger = getTrigger();
    if (!trigger) return;
    trigger.textContent = input.label;
    if (input.hasMenu) {
      trigger.setAttribute('aria-haspopup', 'menu');
      return;
    }
    trigger.removeAttribute('aria-haspopup');
    if (state.open) closeMenu();
  };

  const applyTriggerFromActions = (actions: ThreadedCommentsPanelChatWithAction[]) => {
    if (actions.length === 1) {
      applyTrigger({ label: actions[0].label, hasMenu: false });
      return;
    }
    applyTrigger({ label: defaultTriggerLabel(), hasMenu: true });
  };

  const normalizeActions = (items: ThreadedCommentsPanelChatWithAction[]) => {
    if (!Array.isArray(items)) return [] as ThreadedCommentsPanelChatWithAction[];
    const out: ThreadedCommentsPanelChatWithAction[] = [];
    for (const item of items) {
      const id = String((item as any)?.id || '').trim();
      const label = String((item as any)?.label || '').trim();
      const onTrigger = (item as any)?.onTrigger;
      if (!id || !label || typeof onTrigger !== 'function') continue;
      out.push({
        id,
        label,
        onTrigger,
        disabled: Boolean((item as any)?.disabled),
      });
    }
    return out;
  };

  const runAction = (action: ThreadedCommentsPanelChatWithAction | null | undefined) => {
    if (!action || action.disabled) return;
    closeMenu();
    void Promise.resolve()
      .then(() => action.onTrigger?.())
      .catch((error) => {
        const message =
          error instanceof Error && error.message ? error.message : String(error || t('actionFailedFallback'));
        showNotice(message);
      });
  };

  const renderMenuActions = (actions: ThreadedCommentsPanelChatWithAction[]) => {
    const menuBody = getMenuBody();
    if (!menuBody) return;
    menuBody.textContent = '';

    if (!actions.length) {
      const empty = document.createElement('div');
      empty.className = 'webclipper-inpage-comments-panel__chatwith-state';
      empty.textContent = 'No AI platforms enabled';
      menuBody.appendChild(empty);
      return;
    }

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'webclipper-btn webclipper-btn--menu-item';
      button.textContent = action.label;
      button.disabled = Boolean(action.disabled);
      button.addEventListener('click', () => {
        runAction(action);
      });
      menuBody.appendChild(button);
    }
  };

  const openMenu = () => {
    if (!rootEl || !config) return;
    state.open = true;
    const trigger = getTrigger();
    const menu = getMenu();
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    if (menu) menu.hidden = false;
  };

  const preloadSingleActionLabel = () => {
    if (!config || typeof config.resolveSingleActionLabel !== 'function') return;
    void Promise.resolve()
      .then(() => config.resolveSingleActionLabel?.())
      .then((label) => {
        if (!rootEl) return;
        if (state.actions.length > 0) return;
        const text = String(label || '').trim();
        if (!text) return;
        applyTrigger({
          label: text,
          hasMenu: false,
        });
      })
      .catch(() => {
        // ignore label preload failure
      });
  };

  const onTriggerClick = () => {
    if (!rootEl || !config) return;
    if (state.loading) return;
    if (state.open) {
      closeMenu();
      return;
    }
    state.loading = true;
    const requestId = state.requestId + 1;
    state.requestId = requestId;
    void Promise.resolve()
      .then(() => config.resolveActions())
      .then((items) => {
        if (!rootEl || requestId !== state.requestId) return;
        const actions = normalizeActions(items as any);
        state.actions = actions;
        applyTriggerFromActions(actions);
        if (!actions.length) {
          showNotice('No AI platforms enabled');
          return;
        }
        if (actions.length === 1) {
          runAction(actions[0]);
          return;
        }
        openMenu();
        renderMenuActions(actions);
      })
      .catch((error) => {
        if (!rootEl || requestId !== state.requestId) return;
        const message =
          error instanceof Error && error.message ? error.message : String(error || t('actionFailedFallback'));
        showNotice(message);
      })
      .finally(() => {
        if (!rootEl || requestId !== state.requestId) return;
        state.loading = false;
      });
  };

  const attachRoot = (root: HTMLElement) => {
    if (!config) return;
    rootEl = root;
    rootEl.textContent = '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className =
      'webclipper-inpage-comments-panel__chatwith-trigger webclipper-btn webclipper-btn--tone-muted';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.textContent = defaultTriggerLabel();
    rootEl.appendChild(trigger);
    triggerEl = trigger;

    const menu = document.createElement('div');
    menu.className = 'webclipper-inpage-comments-panel__chatwith-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('detailHeaderChatWithMenuAria'));
    menu.hidden = true;
    rootEl.appendChild(menu);

    const menuBody = document.createElement('div');
    menuBody.className = 'webclipper-inpage-comments-panel__chatwith-menu-body';
    menu.appendChild(menuBody);

    triggerClickHandler = () => onTriggerClick();
    trigger.addEventListener('click', triggerClickHandler);

    preloadSingleActionLabel();
  };

  const isMenuOpen = () => state.open;

  const handleShadowClick = (target: Element | null) => {
    if (!state.open || !rootEl) return;
    const inMenu = Boolean(target?.closest?.('.webclipper-inpage-comments-panel__chatwith'));
    if (!inMenu) closeMenu();
  };

  const handleShadowEscape = (event?: KeyboardEvent | null): boolean => {
    if (!state.open) return false;
    try {
      event?.preventDefault?.();
    } catch (_e) {
      // ignore
    }
    closeMenu();
    return true;
  };

  const cleanup = () => {
    closeMenu();
    state.loading = false;
    state.actions = [];
    state.requestId += 1;
    if (triggerEl && triggerClickHandler) {
      try {
        triggerEl.removeEventListener('click', triggerClickHandler);
      } catch (_e) {
        // ignore
      }
    }
    triggerEl = null;
    triggerClickHandler = null;
    rootEl = null;
  };

  return {
    attachRoot,
    closeMenu,
    isMenuOpen,
    handleShadowClick,
    handleShadowEscape,
    cleanup,
  };
}
