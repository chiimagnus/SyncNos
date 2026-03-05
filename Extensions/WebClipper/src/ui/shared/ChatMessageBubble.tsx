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

  const bubbleBase =
    'tw-border tw-rounded-[10px] tw-p-2 tw-bg-white tw-text-[var(--text)] tw-shadow-[0_1px_0_rgba(217,89,38,0.06)]';

  const bubbleRoleClass =
    bubbleRole === 'user'
      ? 'tw-bg-[#69BB84] tw-border-[rgba(14,52,32,0.28)] tw-text-[#0e3420]'
      : bubbleRole === 'assistant'
        ? 'tw-bg-white tw-border-[var(--border)] tw-text-[var(--text)]'
        : 'tw-bg-[#fffaf7] tw-border-[var(--border)] tw-text-[var(--text)]';

  const headerBase = 'tw-flex tw-items-center tw-justify-between tw-gap-2 tw-mb-1.5';
  const headerLeftClass =
    bubbleRole === 'user'
      ? 'tw-text-[11px] tw-font-[760] tw-text-[#124629]'
      : 'tw-text-[11px] tw-font-[760] tw-text-[var(--muted)]';
  const headerRightClass =
    bubbleRole === 'user'
      ? 'tw-text-[11px] tw-font-[650] tw-text-[rgba(18,70,41,0.8)]'
      : 'tw-text-[11px] tw-font-[650] tw-text-[var(--muted)]';

  // Tailwind-only Markdown styling (no global CSS selectors).
  const mdClass =
    [
      'tw-break-words tw-[overflow-wrap:anywhere] tw-overflow-x-auto tw-leading-[1.42]',
      'tw-[&>*:first-child]:tw-mt-0 tw-[&>*:last-child]:tw-mb-0',

      'tw-[&_p]:tw-mt-0 tw-[&_p]:tw-mb-2',

      'tw-[&_h1]:tw-mt-2.5 tw-[&_h1]:tw-mb-1.5 tw-[&_h1]:tw-text-[15px] tw-[&_h1]:tw-leading-[1.32] tw-[&_h1]:tw-tracking-[-0.01em] tw-[&_h1]:tw-font-[800]',
      'tw-[&_h2]:tw-mt-2.5 tw-[&_h2]:tw-mb-1.5 tw-[&_h2]:tw-text-[14px] tw-[&_h2]:tw-leading-[1.32] tw-[&_h2]:tw-tracking-[-0.01em] tw-[&_h2]:tw-font-[800]',
      'tw-[&_h3]:tw-mt-2.5 tw-[&_h3]:tw-mb-1.5 tw-[&_h3]:tw-text-[13px] tw-[&_h3]:tw-leading-[1.32] tw-[&_h3]:tw-tracking-[-0.01em] tw-[&_h3]:tw-font-[780]',
      'tw-[&_h4]:tw-mt-2.5 tw-[&_h4]:tw-mb-1.5 tw-[&_h4]:tw-text-[13px] tw-[&_h4]:tw-leading-[1.32] tw-[&_h4]:tw-tracking-[-0.01em] tw-[&_h4]:tw-font-[780]',
      'tw-[&_h5]:tw-mt-2.5 tw-[&_h5]:tw-mb-1.5 tw-[&_h5]:tw-text-[13px] tw-[&_h5]:tw-leading-[1.32] tw-[&_h5]:tw-tracking-[-0.01em] tw-[&_h5]:tw-font-[780]',
      'tw-[&_h6]:tw-mt-2.5 tw-[&_h6]:tw-mb-1.5 tw-[&_h6]:tw-text-[13px] tw-[&_h6]:tw-leading-[1.32] tw-[&_h6]:tw-tracking-[-0.01em] tw-[&_h6]:tw-font-[780]',

      'tw-[&_ul]:tw-mt-0 tw-[&_ul]:tw-mb-2 tw-[&_ul]:tw-pl-5 tw-[&_ul]:tw-list-disc',
      'tw-[&_ol]:tw-mt-0 tw-[&_ol]:tw-mb-2 tw-[&_ol]:tw-pl-5 tw-[&_ol]:tw-list-decimal',
      'tw-[&_ul>li+li]:tw-mt-1 tw-[&_ol>li+li]:tw-mt-1',

      'tw-[&_blockquote]:tw-mt-0 tw-[&_blockquote]:tw-mb-2 tw-[&_blockquote]:tw-px-[9px] tw-[&_blockquote]:tw-py-[6px] tw-[&_blockquote]:tw-border-l-[3px] tw-[&_blockquote]:tw-border-l-[rgba(217,89,38,0.35)] tw-[&_blockquote]:tw-bg-[rgba(255,241,234,0.75)] tw-[&_blockquote]:tw-text-[var(--muted)]',

      'tw-[&_code]:tw-px-[5px] tw-[&_code]:tw-py-[1px] tw-[&_code]:tw-rounded-[6px] tw-[&_code]:tw-bg-[rgba(217,89,38,0.12)] tw-[&_code]:tw-font-mono tw-[&_code]:tw-text-[12px]',

      'tw-[&_pre]:tw-mt-0 tw-[&_pre]:tw-mb-2 tw-[&_pre]:tw-px-[10px] tw-[&_pre]:tw-py-[8px] tw-[&_pre]:tw-rounded-[8px] tw-[&_pre]:tw-border tw-[&_pre]:tw-border-[rgba(217,89,38,0.2)] tw-[&_pre]:tw-bg-[rgba(255,241,234,0.62)] tw-[&_pre]:tw-overflow-auto',
      'tw-[&_pre>code]:tw-block tw-[&_pre>code]:tw-p-0 tw-[&_pre>code]:tw-bg-transparent tw-[&_pre>code]:tw-rounded-none tw-[&_pre>code]:tw-leading-[1.45]',

      'tw-[&_table]:tw-border-collapse tw-[&_table]:tw-w-max tw-[&_table]:tw-max-w-full',
      'tw-[&_th]:tw-border tw-[&_th]:tw-border-[rgba(217,89,38,0.2)] tw-[&_th]:tw-px-[6px] tw-[&_th]:tw-py-[4px] tw-[&_th]:tw-align-top tw-[&_th]:tw-text-[12px] tw-[&_th]:tw-font-[700]',
      'tw-[&_td]:tw-border tw-[&_td]:tw-border-[rgba(217,89,38,0.2)] tw-[&_td]:tw-px-[6px] tw-[&_td]:tw-py-[4px] tw-[&_td]:tw-align-top tw-[&_td]:tw-text-[12px]',
      'tw-[&_thead_th]:tw-bg-[rgba(255,241,234,0.75)]',

      'tw-[&_a]:tw-text-[#2563eb] tw-[&_a]:tw-underline tw-[&_a]:tw-underline-offset-[1px]',
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
