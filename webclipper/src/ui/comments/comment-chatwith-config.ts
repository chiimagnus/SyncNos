import { resolveChatWithCommentActions } from '@services/integrations/chatwith/chatwith-comment-actions';
import type { ChatWithOpenPlatformPort } from '@services/integrations/chatwith/chatwith-open-port';
import type { ThreadedCommentsPanelCommentChatWithConfig, ThreadedCommentsPanelCommentChatWithContext } from './types';

type ResolveBooleanLike = () => boolean | Promise<boolean>;
type ResolveOpenPortLike = () =>
  | ChatWithOpenPlatformPort
  | null
  | undefined
  | Promise<ChatWithOpenPlatformPort | null | undefined>;

export type CreateThreadedCommentChatWithConfigInput = {
  resolveContext: () =>
    | ThreadedCommentsPanelCommentChatWithContext
    | Promise<ThreadedCommentsPanelCommentChatWithContext>;
  isEnabled?: ResolveBooleanLike;
  hasConversation?: ResolveBooleanLike;
  resolveOpenPort?: ResolveOpenPortLike;
};

function safeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeContext(input: unknown): ThreadedCommentsPanelCommentChatWithContext {
  const context = (input || {}) as Partial<ThreadedCommentsPanelCommentChatWithContext>;
  return {
    articleTitle: safeText(context.articleTitle),
    canonicalUrl: safeText(context.canonicalUrl),
  };
}

async function resolveGate(flagResolver: ResolveBooleanLike | undefined): Promise<boolean> {
  if (typeof flagResolver !== 'function') return true;
  return Boolean(await flagResolver());
}

async function resolveOpenPort(resolver: ResolveOpenPortLike | undefined): Promise<ChatWithOpenPlatformPort | null> {
  if (typeof resolver !== 'function') return null;
  const resolved = await resolver();
  return resolved || null;
}

export function createThreadedCommentChatWithConfig(
  input: CreateThreadedCommentChatWithConfigInput,
): ThreadedCommentsPanelCommentChatWithConfig {
  const resolveContext = async (): Promise<ThreadedCommentsPanelCommentChatWithContext> => {
    return normalizeContext(await input.resolveContext());
  };

  return {
    resolveContext,
    resolveActions: async (rootComment, context) => {
      if (!(await resolveGate(input.isEnabled))) return [];
      if (!(await resolveGate(input.hasConversation))) return [];

      const normalizedContext = normalizeContext(context || {});
      const effectiveContext =
        normalizedContext.articleTitle || normalizedContext.canonicalUrl ? normalizedContext : await resolveContext();

      return await resolveChatWithCommentActions({
        quoteText: String(rootComment?.quoteText || ''),
        commentText: String(rootComment?.commentText || ''),
        articleTitle: safeText(effectiveContext.articleTitle),
        canonicalUrl: safeText(effectiveContext.canonicalUrl),
        openPort: await resolveOpenPort(input.resolveOpenPort),
      });
    },
  };
}
