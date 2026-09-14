import type { Ref } from 'react';
import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import type { CommentOverflowAction } from './CommentOverflowMenu';
import { CommentReplyItem } from './CommentReplyItem';

type CommentReplyListProps = {
  replies: readonly CommentSidebarItem[];
  busy: boolean;
  openMenuId: number | null;
  getMenuActions: (reply: CommentSidebarItem) => readonly CommentOverflowAction[];
  getMenuTriggerRef?: (replyId: number) => Ref<HTMLButtonElement>;
  onMenuToggle: (id: number) => void;
  onMenuAction: (id: number, action: CommentOverflowAction) => void | Promise<void>;
};

export function CommentReplyList({
  replies,
  busy,
  openMenuId,
  getMenuActions,
  getMenuTriggerRef,
  onMenuToggle,
  onMenuAction,
}: CommentReplyListProps) {
  if (!replies.length) return null;
  return (
    <div className="webclipper-inpage-comments-panel__replies" role="list">
      {replies.map((reply) => (
        <CommentReplyItem
          key={reply.id}
          reply={reply}
          busy={busy}
          menuOpen={openMenuId === reply.id}
          menuActions={getMenuActions(reply)}
          menuTriggerRef={getMenuTriggerRef?.(Number(reply.id))}
          onMenuToggle={onMenuToggle}
          onMenuAction={onMenuAction}
        />
      ))}
    </div>
  );
}
