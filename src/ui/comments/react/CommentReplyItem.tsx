import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import type { Ref } from 'react';
import { CommentOverflowMenu, type CommentOverflowAction } from './CommentOverflowMenu';

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

type CommentReplyItemProps = {
  reply: CommentSidebarItem;
  busy: boolean;
  menuOpen: boolean;
  menuActions: readonly CommentOverflowAction[];
  menuTriggerRef?: Ref<HTMLButtonElement>;
  onMenuToggle: (id: number) => void;
  onMenuAction: (id: number, action: CommentOverflowAction) => void | Promise<void>;
};

export function CommentReplyItem({
  reply,
  busy,
  menuOpen,
  menuActions,
  menuTriggerRef,
  onMenuToggle,
  onMenuAction,
}: CommentReplyItemProps) {
  const author = String(reply.authorName || 'You');
  return (
    <div className="webclipper-inpage-comments-panel__reply" data-reply-id={String(reply.id)} role="listitem">
      <div className="webclipper-inpage-comments-panel__avatar" aria-hidden="true">
        {avatarLabel(author)}
      </div>
      <div className="webclipper-inpage-comments-panel__reply-main">
        <div className="webclipper-inpage-comments-panel__reply-header">
          <div className="webclipper-inpage-comments-panel__reply-meta">
            <span className="webclipper-inpage-comments-panel__comment-author">{author}</span>
            <time className="webclipper-inpage-comments-panel__comment-time">{formatTime(reply.createdAt)}</time>
          </div>
          <div className="webclipper-inpage-comments-panel__comment-actions">
            <CommentOverflowMenu
              targetLabel="Reply actions"
              open={menuOpen}
              disabled={busy}
              actions={menuActions}
              triggerRef={menuTriggerRef}
              onToggle={() => onMenuToggle(reply.id)}
              onAction={(action) => onMenuAction(reply.id, action)}
            />
          </div>
        </div>
        <div className="webclipper-inpage-comments-panel__text">{String(reply.commentText || '')}</div>
      </div>
    </div>
  );
}
