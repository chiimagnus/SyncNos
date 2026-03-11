import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { createMarkdownRenderer } from './markdown';

type BubbleRole = 'user' | 'assistant' | 'other';

function normalizeRole(role: unknown): BubbleRole {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return 'other';

  // Normalize common variants from legacy data / different collectors.
  if (r === 'user' || r === 'human' || r === 'me' || r === 'you') return 'user';
  if (r === 'assistant' || r === 'ai' || r === 'bot' || r === 'model') return 'assistant';
  return 'other';
}

export type ChatMessageBubbleProps = {
  role?: unknown;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  markdown: string;
  className?: string;
};

// Shared singleton to avoid per-message renderer instantiation.
const sharedMd = createMarkdownRenderer({ openLinksInNewTab: true });

export function ChatMessageBubble({ role, headerLeft, headerRight, markdown, className }: ChatMessageBubbleProps) {
  const bubbleRole = normalizeRole(role);

  const html = useMemo(() => sharedMd.render(String(markdown || '')), [markdown]);

  const bubbleBase = 'tw-min-w-0 tw-border tw-rounded-[10px] tw-p-2 tw-shadow-none';

  const bubbleRoleClass =
    bubbleRole === 'user'
      ? 'tw-bg-[var(--bubble-user-bg)] tw-border-[var(--bubble-user-border)] tw-text-[var(--secondary-foreground)]'
      : bubbleRole === 'assistant'
        ? 'tw-bg-[var(--bg-card)] tw-border-[var(--border)] tw-text-[var(--text-primary)]'
        : 'tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))] tw-border-[var(--border)] tw-text-[var(--text-primary)]';

  const headerBase = 'tw-flex tw-items-center tw-justify-between tw-gap-2 tw-mb-1.5';
  const headerToneClass = bubbleRole === 'user' ? 'tw-text-[var(--secondary-foreground)] tw-opacity-70' : 'tw-text-[var(--text-secondary)]';
  const headerLeftClass = `tw-text-[11px] tw-font-[760] ${headerToneClass}`;
  const headerRightClass = `tw-text-[11px] tw-font-[650] ${headerToneClass}`;

  // Tailwind-only Markdown styling (no global CSS selectors).
  const mdClass =
    [
      // NOTE: Tailwind uses `prefix: "tw-"`. For arbitrary properties/selectors, do NOT
      // prefix the `[...]` segment, only prefix the actual utility (e.g. `[&_p]:tw-mt-0`).
      // Keep the container shrinkable in flex/grid layouts.
      'tw-min-w-0 tw-break-words [overflow-wrap:anywhere] tw-overflow-x-hidden tw-leading-[1.42]',
      '[&>*:first-child]:tw-mt-0 [&>*:last-child]:tw-mb-0',

      '[&_p]:tw-mt-0 [&_p]:tw-mb-2',

      '[&_h1]:tw-mt-2.5 [&_h1]:tw-mb-1.5 [&_h1]:tw-text-[15px] [&_h1]:tw-leading-[1.32] [&_h1]:tw-tracking-[-0.01em] [&_h1]:tw-font-[800]',
      '[&_h2]:tw-mt-2.5 [&_h2]:tw-mb-1.5 [&_h2]:tw-text-[14px] [&_h2]:tw-leading-[1.32] [&_h2]:tw-tracking-[-0.01em] [&_h2]:tw-font-[800]',
      '[&_h3]:tw-mt-2.5 [&_h3]:tw-mb-1.5 [&_h3]:tw-text-[13px] [&_h3]:tw-leading-[1.32] [&_h3]:tw-tracking-[-0.01em] [&_h3]:tw-font-[780]',
      '[&_h4]:tw-mt-2.5 [&_h4]:tw-mb-1.5 [&_h4]:tw-text-[13px] [&_h4]:tw-leading-[1.32] [&_h4]:tw-tracking-[-0.01em] [&_h4]:tw-font-[780]',
      '[&_h5]:tw-mt-2.5 [&_h5]:tw-mb-1.5 [&_h5]:tw-text-[13px] [&_h5]:tw-leading-[1.32] [&_h5]:tw-tracking-[-0.01em] [&_h5]:tw-font-[780]',
      '[&_h6]:tw-mt-2.5 [&_h6]:tw-mb-1.5 [&_h6]:tw-text-[13px] [&_h6]:tw-leading-[1.32] [&_h6]:tw-tracking-[-0.01em] [&_h6]:tw-font-[780]',

      '[&_ul]:tw-mt-0 [&_ul]:tw-mb-2 [&_ul]:tw-pl-5 [&_ul]:tw-list-disc',
      '[&_ol]:tw-mt-0 [&_ol]:tw-mb-2 [&_ol]:tw-pl-5 [&_ol]:tw-list-decimal',
      '[&_ul>li+li]:tw-mt-1 [&_ol>li+li]:tw-mt-1',

      '[&_blockquote]:tw-mt-0 [&_blockquote]:tw-mb-2 [&_blockquote]:tw-px-[9px] [&_blockquote]:tw-py-[6px] [&_blockquote]:tw-border-l-[3px] [&_blockquote]:tw-border-l-[var(--border)] [&_blockquote]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))] [&_blockquote]:tw-text-[var(--text-secondary)]',

      '[&_code]:tw-px-[5px] [&_code]:tw-py-[1px] [&_code]:tw-rounded-[6px] [&_code]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_85%,var(--bg-card))] [&_code]:tw-font-mono [&_code]:tw-text-[12px]',

      '[&_pre]:tw-mt-0 [&_pre]:tw-mb-2 [&_pre]:tw-px-[10px] [&_pre]:tw-py-[8px] [&_pre]:tw-rounded-[8px] [&_pre]:tw-border [&_pre]:tw-border-[var(--border)] [&_pre]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))] [&_pre]:tw-overflow-auto',
      '[&_pre>code]:tw-block [&_pre>code]:tw-p-0 [&_pre>code]:tw-bg-transparent [&_pre>code]:tw-rounded-none [&_pre>code]:tw-leading-[1.45]',

      // Tables can be wider than the viewport; let the table itself scroll instead of the whole bubble.
      '[&_table]:tw-block [&_table]:tw-overflow-x-auto [&_table]:tw-border-collapse [&_table]:tw-w-max [&_table]:tw-max-w-full',
      '[&_th]:tw-border [&_th]:tw-border-[var(--border)] [&_th]:tw-px-[6px] [&_th]:tw-py-[4px] [&_th]:tw-align-top [&_th]:tw-text-[12px] [&_th]:tw-font-[700]',
      '[&_td]:tw-border [&_td]:tw-border-[var(--border)] [&_td]:tw-px-[6px] [&_td]:tw-py-[4px] [&_td]:tw-align-top [&_td]:tw-text-[12px]',
      '[&_thead_th]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))]',

      // Images: never overflow the bubble, and avoid giant original-size rendering.
      '[&_img]:tw-block [&_img]:tw-h-auto [&_img]:tw-object-contain',
      // "Small image" policy: cap both width and height, but never overflow the bubble.
      '[&_img]:tw-max-w-[min(360px,100%)] [&_img]:tw-max-h-[240px]',
      '[&_img]:tw-rounded-[10px] [&_img]:tw-border [&_img]:tw-border-[var(--border)]',

      '[&_a]:tw-text-[var(--info)] [&_a]:tw-underline [&_a]:tw-underline-offset-[1px]',
      '[&_a:focus-visible]:tw-outline [&_a:focus-visible]:tw-outline-2 [&_a:focus-visible]:tw-outline-offset-2 [&_a:focus-visible]:tw-outline-[var(--focus-ring)]',
    ].join(' ') + (className ? ` ${className}` : '');

  return (
    <section className={[bubbleBase, bubbleRoleClass].join(' ')}>
      {headerLeft || headerRight ? (
        <header className={headerBase}>
          <div className={headerLeftClass}>{headerLeft}</div>
          <div className={headerRightClass}>{headerRight}</div>
        </header>
      ) : null}
      <div className={mdClass} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
