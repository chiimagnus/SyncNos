export type DiscussionMenuTarget = number | null;

export type DiscussionFocusIntent =
  | { kind: 'root'; epoch: number }
  | { kind: 'reply'; rootId: number; epoch: number }
  | { kind: 'menu'; target: Exclude<DiscussionMenuTarget, null>; epoch: number }
  | null;

export type DiscussionSubmitState = {
  kind: 'root' | 'reply' | null;
  rootId: number | null;
  status: 'idle' | 'submitting' | 'success' | 'error';
  error: string | null;
};

export type DiscussionState = {
  contextKey: string;
  activeRootId: number | null;
  rootDraft: string;
  replyDrafts: Record<number, string>;
  openMenu: DiscussionMenuTarget;
  confirmDelete: number | null;
  focusIntent: DiscussionFocusIntent;
  actionEpoch: number;
  submit: DiscussionSubmitState;
};

export type DiscussionAction =
  | { type: 'context'; contextKey: string }
  | { type: 'reset' }
  | { type: 'activate-root'; rootId: number | null }
  | { type: 'set-root-draft'; value: string }
  | { type: 'set-reply-draft'; rootId: number; value: string }
  | { type: 'clear-reply-draft'; rootId: number }
  | { type: 'reconcile-threads'; rootIds: readonly number[]; commentIds: readonly number[] }
  | { type: 'open-menu'; target: DiscussionMenuTarget }
  | { type: 'confirm-delete'; id: number | null }
  | { type: 'focus-root' }
  | { type: 'focus-reply'; rootId: number }
  | { type: 'focus-menu'; target: Exclude<DiscussionMenuTarget, null> }
  | { type: 'consume-focus'; epoch: number }
  | { type: 'submit-start'; kind: 'root' | 'reply'; rootId?: number | null }
  | { type: 'submit-success'; kind: 'root' | 'reply'; rootId?: number | null }
  | { type: 'submit-error'; kind: 'root' | 'reply'; rootId?: number | null; error: string };

const idleSubmit = (): DiscussionSubmitState => ({
  kind: null,
  rootId: null,
  status: 'idle',
  error: null,
});

export function createDiscussionState(contextKey = ''): DiscussionState {
  return {
    contextKey,
    activeRootId: null,
    rootDraft: '',
    replyDrafts: {},
    openMenu: null,
    confirmDelete: null,
    focusIntent: null,
    actionEpoch: 0,
    submit: idleSubmit(),
  };
}

function clearSubmitError(state: DiscussionState): DiscussionState {
  return state.submit.status === 'error' ? { ...state, submit: idleSubmit() } : state;
}

function validRootId(value: number | null | undefined): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function withFocus(
  state: DiscussionState,
  build: (epoch: number) => Exclude<DiscussionFocusIntent, null>,
): DiscussionState {
  const epoch = state.actionEpoch + 1;
  return { ...state, actionEpoch: epoch, focusIntent: build(epoch) };
}

export function discussionReducer(state: DiscussionState, action: DiscussionAction): DiscussionState {
  switch (action.type) {
    case 'context': {
      const contextKey = String(action.contextKey || '');
      return contextKey === state.contextKey ? state : createDiscussionState(contextKey);
    }
    case 'reset':
      return createDiscussionState(state.contextKey);
    case 'activate-root': {
      const activeRootId = validRootId(action.rootId);
      return {
        ...state,
        activeRootId,
        openMenu: null,
        confirmDelete: null,
      };
    }
    case 'set-root-draft': {
      const next = clearSubmitError(state);
      return { ...next, rootDraft: String(action.value ?? '') };
    }
    case 'set-reply-draft': {
      const rootId = validRootId(action.rootId);
      if (rootId == null) return state;
      const value = String(action.value ?? '');
      const next = clearSubmitError(state);
      if (next.replyDrafts[rootId] === value) return next;
      return { ...next, replyDrafts: { ...next.replyDrafts, [rootId]: value } };
    }
    case 'clear-reply-draft': {
      const rootId = validRootId(action.rootId);
      if (rootId == null || !(rootId in state.replyDrafts)) return state;
      const replyDrafts = { ...state.replyDrafts };
      delete replyDrafts[rootId];
      return { ...state, replyDrafts };
    }
    case 'reconcile-threads': {
      const rootIds = new Set(action.rootIds.map(validRootId).filter((id): id is number => id != null));
      const commentIds = new Set(action.commentIds.map(validRootId).filter((id): id is number => id != null));
      const activeRootId = state.activeRootId != null && rootIds.has(state.activeRootId) ? state.activeRootId : null;
      const replyDrafts = Object.fromEntries(
        Object.entries(state.replyDrafts).filter(([rootId]) => rootIds.has(Number(rootId))),
      );
      const openMenu = state.openMenu != null && !commentIds.has(state.openMenu) ? null : state.openMenu;
      const confirmDelete =
        state.confirmDelete != null && !commentIds.has(state.confirmDelete) ? null : state.confirmDelete;
      const focusIntent =
        state.focusIntent?.kind === 'reply' && !rootIds.has(state.focusIntent.rootId)
          ? null
          : state.focusIntent?.kind === 'menu' && !commentIds.has(state.focusIntent.target)
            ? null
            : state.focusIntent;
      const submit =
        state.submit.kind === 'reply' && state.submit.rootId != null && !rootIds.has(state.submit.rootId)
          ? idleSubmit()
          : state.submit;
      if (
        activeRootId === state.activeRootId &&
        Object.keys(replyDrafts).length === Object.keys(state.replyDrafts).length &&
        openMenu === state.openMenu &&
        confirmDelete === state.confirmDelete &&
        focusIntent === state.focusIntent &&
        submit === state.submit
      ) {
        return state;
      }
      return {
        ...state,
        activeRootId,
        replyDrafts,
        openMenu,
        confirmDelete,
        focusIntent,
        submit,
      };
    }
    case 'open-menu':
      return { ...state, openMenu: action.target, confirmDelete: null };
    case 'confirm-delete':
      return { ...state, confirmDelete: validRootId(action.id) };
    case 'focus-root':
      return withFocus(state, (epoch) => ({ kind: 'root', epoch }));
    case 'focus-reply': {
      const rootId = validRootId(action.rootId);
      return rootId == null ? state : withFocus(state, (epoch) => ({ kind: 'reply', rootId, epoch }));
    }
    case 'focus-menu':
      return withFocus(state, (epoch) => ({ kind: 'menu', target: action.target, epoch }));
    case 'consume-focus':
      return state.focusIntent?.epoch === action.epoch ? { ...state, focusIntent: null } : state;
    case 'submit-start': {
      const rootId = action.kind === 'reply' ? validRootId(action.rootId) : null;
      if (action.kind === 'reply' && rootId == null) return state;
      return {
        ...state,
        submit: { kind: action.kind, rootId, status: 'submitting', error: null },
      };
    }
    case 'submit-success': {
      const rootId = action.kind === 'reply' ? validRootId(action.rootId) : null;
      let next: DiscussionState = {
        ...state,
        submit: { kind: action.kind, rootId, status: 'success', error: null },
      };
      if (action.kind === 'root') next = { ...next, rootDraft: '' };
      if (action.kind === 'reply' && rootId != null) {
        const replyDrafts = { ...next.replyDrafts };
        delete replyDrafts[rootId];
        next = { ...next, replyDrafts };
      }
      return next;
    }
    case 'submit-error': {
      const rootId = action.kind === 'reply' ? validRootId(action.rootId) : null;
      return {
        ...state,
        submit: {
          kind: action.kind,
          rootId,
          status: 'error',
          error: String(action.error || ''),
        },
      };
    }
    default:
      return state;
  }
}
