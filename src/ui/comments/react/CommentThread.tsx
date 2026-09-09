import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { CommentOverflowMenu, type CommentOverflowAction } from './CommentOverflowMenu';
import { CommentReplyList } from './CommentReplyList';

function formatTime(ts: number | null | undefined): string {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return '';
  }
}

function avatarLabel(name: string | null | undefined): string {
  const value = String(name || 'You').trim();
  return Array.from(value)[0]?.toUpperCase() || 'Y';
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  try {
    return element.isContentEditable || Boolean(element.closest('button,input,textarea,a,label,select,option'));
  } catch (_error) {
    return false;
  }
}

type CommentThreadProps = {
  root: CommentSidebarItem;
  replies: readonly CommentSidebarItem[];
  active: boolean;
  busy: boolean;
  openMenuId: number | null;
  rootMenuActions: readonly CommentOverflowAction[];
  getReplyMenuActions: (reply: CommentSidebarItem) => readonly CommentOverflowAction[];
  quotePreview?: ReactNode;
  rootMenuTriggerRef?: Ref<HTMLButtonElement>;
  getReplyMenuTriggerRef?: (replyId: number) => Ref<HTMLButtonElement>;
  children?: ReactNode;
  onActivate: (rootId: number) => void;
  onRootMenuToggle: (root: CommentSidebarItem, replies: readonly CommentSidebarItem[]) => void | Promise<void>;
  onReplyMenuToggle: (id: number) => void | Promise<void>;
  onMenuAction: (id: number, action: CommentOverflowAction) => void | Promise<void>;
};

export function CommentThread({
  root,
  replies,
  active,
  busy,
  openMenuId,
  rootMenuActions,
  getReplyMenuActions,
  quotePreview,
  rootMenuTriggerRef,
  getReplyMenuTriggerRef,
  children,
  onActivate,
  onRootMenuToggle,
  onReplyMenuToggle,
  onMenuAction,
}: CommentThreadProps) {
  const rootId = Number(root.id);
  const author = String(root.authorName || 'You');
  return (
    <article
      className={`webclipper-inpage-comments-panel__thread${active ? ' is-active' : ''}`}
      data-thread-root-id={String(rootId)}
      role="listitem"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      aria-label={`Comment by ${author}`}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        const primaryComment = target?.closest('.webclipper-inpage-comments-panel__comment');
        if (primaryComment && !isInteractiveTarget(event.target)) onActivate(rootId);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (isInteractiveTarget(event.target)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate(rootId);
      }}
    >
      {quotePreview}
      <div className="webclipper-inpage-comments-panel__comment">
        <div className="webclipper-inpage-comments-panel__avatar" aria-hidden="true">
          {avatarLabel(author)}
        </div>
        <div className="webclipper-inpage-comments-panel__comment-main">
          <div className="webclipper-inpage-comments-panel__comment-header">
            <div className="webclipper-inpage-comments-panel__comment-meta">
              <span className="webclipper-inpage-comments-panel__comment-author">{author}</span>
              <time className="webclipper-inpage-comments-panel__comment-time">{formatTime(root.createdAt)}</time>
            </div>
            <div className="webclipper-inpage-comments-panel__comment-actions">
              <CommentOverflowMenu
                targetLabel="Comment actions"
                open={openMenuId === rootId}
                disabled={busy}
                actions={rootMenuActions}
                triggerRef={rootMenuTriggerRef}
                onToggle={() => onRootMenuToggle(root, replies)}
                onAction={(action) => onMenuAction(rootId, action)}
              />
            </div>
          </div>
          {String(root.commentText || '').trim() ? (
            <div className="webclipper-inpage-comments-panel__text">{String(root.commentText || '')}</div>
          ) : null}
        </div>
      </div>
      <CommentReplyList
        replies={replies}
        busy={busy}
        openMenuId={openMenuId}
        getMenuActions={getReplyMenuActions}
        getMenuTriggerRef={getReplyMenuTriggerRef}
        onMenuToggle={onReplyMenuToggle}
        onMenuAction={onMenuAction}
      />
      {children}
    </article>
  );
}
