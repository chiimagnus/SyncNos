import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import type { Ref } from 'react';
import { CommentMarkdown } from './CommentMarkdown';
import { CommentOverflowMenu, type CommentOverflowAction } from './CommentOverflowMenu';
import { commentAuthorLabel, commentAvatarLabel, formatCommentTime } from './comment-display';

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
  const author = commentAuthorLabel(reply.authorName);
  return (
    <div className="webclipper-inpage-comments-panel__reply" role="listitem">
      <div className="webclipper-inpage-comments-panel__avatar" aria-hidden="true">
        {commentAvatarLabel(author)}
      </div>
      <div className="webclipper-inpage-comments-panel__reply-main">
        <div className="webclipper-inpage-comments-panel__reply-header">
          <div className="webclipper-inpage-comments-panel__reply-meta">
            <span className="webclipper-inpage-comments-panel__comment-author">{author}</span>
            <time className="webclipper-inpage-comments-panel__comment-time">{formatCommentTime(reply.createdAt)}</time>
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
        <CommentMarkdown markdown={reply.commentText} />
      </div>
    </div>
  );
}
