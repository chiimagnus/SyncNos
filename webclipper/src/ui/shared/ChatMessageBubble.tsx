import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { createMarkdownRenderer } from './markdown';
import { getImageCacheAssetById } from '../../conversations/data/image-cache-read';

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
  conversationId?: number;
  className?: string;
};

// Shared singleton to avoid per-message renderer instantiation.
const sharedMd = createMarkdownRenderer({ openLinksInNewTab: true });

export function ChatMessageBubble({
  role,
  headerLeft,
  headerRight,
  markdown,
  conversationId,
  className,
}: ChatMessageBubbleProps) {
  const bubbleRole = normalizeRole(role);
  const markdownRef = useRef<HTMLDivElement | null>(null);

  const html = useMemo(() => sharedMd.render(String(markdown || '')), [markdown]);

  useEffect(() => {
    const root = markdownRef.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-syncnos-asset-id]'));
    if (!nodes.length) return;

    const groupedNodes = new Map<number, HTMLImageElement[]>();
    for (const node of nodes) {
      const id = Number(node.dataset.syncnosAssetId);
      if (!Number.isFinite(id) || id <= 0) continue;
      const list = groupedNodes.get(id) || [];
      list.push(node);
      groupedNodes.set(id, list);
    }
    if (!groupedNodes.size) return;

    let disposed = false;
    const objectUrls: string[] = [];

    async function hydrateAssetImages() {
      try {
        for (const [assetId, targetNodes] of groupedNodes.entries()) {
          // eslint-disable-next-line no-await-in-loop
          const asset = await getImageCacheAssetById({ id: assetId, conversationId });
          if (!asset || disposed) continue;
          const objectUrl = URL.createObjectURL(asset.blob);
          objectUrls.push(objectUrl);
          for (const node of targetNodes) node.src = objectUrl;
        }
      } catch (error) {
        console.warn('[ImageAssetRender] failed to hydrate local asset images', {
          error: error instanceof Error ? error.message : String(error || ''),
        });
      }
    }

    void hydrateAssetImages();
    return () => {
      disposed = true;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [html, conversationId]);

  const bubbleBase = 'tw-min-w-0 tw-border tw-rounded-[12px] tw-p-3 tw-shadow-none';

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
      // Notion-like "Small text" body typography (base 14px, 21px line-height).
      'tw-min-w-0 tw-break-words [overflow-wrap:anywhere] tw-overflow-x-hidden tw-text-[14px] tw-leading-[21px] tw-font-normal',
      '[&>*:first-child]:tw-mt-0 [&>*:last-child]:tw-mb-0',

      '[&_p]:tw-mt-0 [&_p]:tw-mb-3',

      // Notion-like heading scale (base = 14px):
      // H1 26.25px/34.125px, H2 21px/27.3px, H3 17.5px/22.75px.
      '[&_h1]:tw-mt-6 [&_h1]:tw-mb-2 [&_h1]:tw-text-[26.25px] [&_h1]:tw-leading-[34.125px] [&_h1]:tw-font-[600]',
      '[&_h2]:tw-mt-5 [&_h2]:tw-mb-2 [&_h2]:tw-text-[21px] [&_h2]:tw-leading-[27.3px] [&_h2]:tw-font-[600]',
      '[&_h3]:tw-mt-4 [&_h3]:tw-mb-2 [&_h3]:tw-text-[17.5px] [&_h3]:tw-leading-[22.75px] [&_h3]:tw-font-[600]',
      '[&_h4]:tw-mt-4 [&_h4]:tw-mb-2 [&_h4]:tw-text-[15.75px] [&_h4]:tw-leading-[21px] [&_h4]:tw-font-[600]',
      '[&_h5]:tw-mt-4 [&_h5]:tw-mb-2 [&_h5]:tw-text-[14px] [&_h5]:tw-leading-[21px] [&_h5]:tw-font-[600]',
      '[&_h6]:tw-mt-4 [&_h6]:tw-mb-2 [&_h6]:tw-text-[14px] [&_h6]:tw-leading-[21px] [&_h6]:tw-font-[600]',

      '[&_strong]:tw-font-[800]',
      '[&_em]:tw-italic',
      '[&_del]:tw-opacity-70',

      '[&_ul]:tw-mt-0 [&_ul]:tw-mb-2 [&_ul]:tw-pl-5 [&_ul]:tw-list-disc',
      '[&_ol]:tw-mt-0 [&_ol]:tw-mb-2 [&_ol]:tw-pl-5 [&_ol]:tw-list-decimal',
      '[&_ul>li+li]:tw-mt-1 [&_ol>li+li]:tw-mt-1',
      '[&_li>p]:tw-mb-1 [&_li>p:last-child]:tw-mb-0',

      // Blockquotes: render as a clean "vertical bar" quote (like Notion),
      // and do not rely on Tailwind preflight (preflight is disabled in this repo).
      '[&_blockquote]:tw-relative [&_blockquote]:tw-mt-0 [&_blockquote]:tw-mb-3 [&_blockquote]:tw-mx-0 [&_blockquote]:tw-pl-5 [&_blockquote]:tw-pr-0 [&_blockquote]:tw-py-0 [&_blockquote]:tw-bg-transparent [&_blockquote]:tw-text-[var(--text-primary)] [&_blockquote]:tw-text-[16.8px] [&_blockquote]:tw-leading-[25.2px]',
      '[&_blockquote]:before:tw-content-[""] [&_blockquote]:before:tw-absolute [&_blockquote]:before:tw-left-0 [&_blockquote]:before:tw-top-1 [&_blockquote]:before:tw-bottom-1 [&_blockquote]:before:tw-w-1 [&_blockquote]:before:tw-rounded-full [&_blockquote]:before:tw-bg-[color-mix(in_srgb,var(--text-secondary)_40%,transparent)]',
      '[&_blockquote_blockquote]:tw-mt-2 [&_blockquote_blockquote]:tw-mb-0 [&_blockquote_blockquote]:before:tw-bg-[color-mix(in_srgb,var(--text-secondary)_28%,transparent)]',

      // Inline code: avoid "too black" chips in dark mode (preflight is disabled).
      // Use currentColor-based translucent background so it adapts to both bubble variants.
      // Notion-like code size: 85% of 14px => 11.9px.
      '[&_code]:tw-px-[5px] [&_code]:tw-py-[1px] [&_code]:tw-rounded-[6px] [&_code]:tw-bg-[color-mix(in_srgb,currentColor_12%,transparent)] [&_code]:tw-font-mono [&_code]:tw-text-[11.9px]',
      '[&_kbd]:tw-inline-flex [&_kbd]:tw-items-center [&_kbd]:tw-rounded-[6px] [&_kbd]:tw-border [&_kbd]:tw-border-[var(--border)] [&_kbd]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_55%,var(--bg-card))] [&_kbd]:tw-px-[6px] [&_kbd]:tw-py-[1px] [&_kbd]:tw-font-mono [&_kbd]:tw-text-[11.9px]',

      // Code blocks: keep contrast high in both light/dark bubbles (avoid near-black background).
      '[&_pre]:tw-mt-0 [&_pre]:tw-mb-2 [&_pre]:tw-px-[10px] [&_pre]:tw-py-[8px] [&_pre]:tw-rounded-[8px] [&_pre]:tw-border [&_pre]:tw-border-[var(--border)] [&_pre]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_55%,var(--bg-card))] [&_pre]:tw-overflow-auto',
      '[&_pre>code]:tw-block [&_pre>code]:tw-p-0 [&_pre>code]:tw-bg-transparent [&_pre>code]:tw-rounded-none [&_pre>code]:tw-text-[11.9px] [&_pre>code]:tw-leading-[17.85px]',

      // Tables can be wider than the viewport; let the table itself scroll instead of the whole bubble.
      '[&_table]:tw-block [&_table]:tw-overflow-x-auto [&_table]:tw-border-collapse [&_table]:tw-w-max [&_table]:tw-max-w-full',
      // Small-text table: 12.25px (14px * 0.875).
      '[&_th]:tw-border [&_th]:tw-border-[var(--border)] [&_th]:tw-px-[6px] [&_th]:tw-py-[4px] [&_th]:tw-align-top [&_th]:tw-text-[12.25px] [&_th]:tw-leading-[18.375px] [&_th]:tw-font-[600]',
      '[&_td]:tw-border [&_td]:tw-border-[var(--border)] [&_td]:tw-px-[6px] [&_td]:tw-py-[4px] [&_td]:tw-align-top [&_td]:tw-text-[12.25px] [&_td]:tw-leading-[18.375px]',
      '[&_thead_th]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))]',
      '[&_tbody_tr:nth-child(even)>td]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_42%,transparent)]',

      '[&_hr]:tw-my-3 [&_hr]:tw-border-0 [&_hr]:tw-h-px [&_hr]:tw-bg-[color-mix(in_srgb,var(--border)_70%,transparent)]',

      // Images: never overflow the bubble, and avoid giant original-size rendering.
      '[&_img]:tw-block [&_img]:tw-h-auto [&_img]:tw-object-contain',
      // "Small image" policy: cap both width and height, but never overflow the bubble.
      '[&_img]:tw-max-w-[min(360px,100%)] [&_img]:tw-max-h-[240px]',
      '[&_img]:tw-rounded-[10px] [&_img]:tw-border [&_img]:tw-border-[var(--border)]',
      // When images fail to load, show an explicit link below the image to keep it discoverable.
      '[&_.syncnos-md-image]:tw-inline-block [&_.syncnos-md-image]:tw-max-w-full',
      // Small-text caption: 12.25px (14px * 0.875), 1.4 line-height, wrapping.
      '[&_.syncnos-md-image-link]:tw-mt-2 [&_.syncnos-md-image-link]:tw-block [&_.syncnos-md-image-link]:tw-max-w-full [&_.syncnos-md-image-link]:tw-whitespace-normal [&_.syncnos-md-image-link]:tw-text-[12.25px] [&_.syncnos-md-image-link]:tw-leading-[17.15px] [&_.syncnos-md-image-link]:tw-text-[var(--text-secondary)] [&_.syncnos-md-image-link]:tw-break-words [&_.syncnos-md-image-link]:[overflow-wrap:anywhere]',
      '[&_.syncnos-md-image-link_a]:tw-text-[var(--text-secondary)] [&_.syncnos-md-image-link_a]:tw-underline [&_.syncnos-md-image-link_a]:tw-underline-offset-[2px] [&_.syncnos-md-image-link_a]:tw-decoration-[color-mix(in_srgb,var(--text-secondary)_55%,transparent)] [&_.syncnos-md-image-link_a:hover]:tw-decoration-[color-mix(in_srgb,var(--text-secondary)_85%,transparent)]',

      // KaTeX blocks: prevent overflow and keep spacing consistent with other blocks.
      '[&_.katex-display]:tw-my-2 [&_.katex-display]:tw-overflow-x-auto [&_.katex-display]:tw-max-w-full',

      // Links: keep a stable cue (underline) while ensuring readability on the green bubble too.
      '[&_a]:tw-text-[var(--info)] [&_a]:tw-underline [&_a]:tw-underline-offset-[1px]',
      '[&_a:hover]:tw-opacity-90',
      '[&_a:focus-visible]:tw-outline [&_a:focus-visible]:tw-outline-2 [&_a:focus-visible]:tw-outline-offset-2 [&_a:focus-visible]:tw-outline-[var(--focus-ring)]',
    ].join(' ') + (className ? ` ${className}` : '');

  const mdRoleOverrides =
    bubbleRole === 'user'
      ? [
          // On the green bubble, keep links clearly "blue" and readable in both light/dark modes:
          // - Light mode: mix with dark `--text-primary` to deepen the blue.
          // - Dark mode: mix with light `--text-primary` to brighten the blue.
          '[&_a]:tw-text-[color-mix(in_srgb,var(--info)_76%,var(--text-primary))]',
          '[&_a]:tw-font-semibold [&_a]:tw-underline-offset-[2px] [&_a]:tw-decoration-2',
          '[&_a]:tw-decoration-[color-mix(in_srgb,var(--info)_62%,var(--text-primary))]',
        ].join(' ')
      : '';

  return (
    <section className={[bubbleBase, bubbleRoleClass].join(' ')}>
      {headerLeft || headerRight ? (
        <header className={headerBase}>
          <div className={headerLeftClass}>{headerLeft}</div>
          <div className={headerRightClass}>{headerRight}</div>
        </header>
      ) : null}
      <div
        ref={markdownRef}
        className={[mdClass, mdRoleOverrides].filter(Boolean).join(' ')}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
