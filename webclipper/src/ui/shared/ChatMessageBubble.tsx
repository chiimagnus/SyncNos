import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createMarkdownRenderer } from '@ui/shared/markdown-core';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { getMarkdownReadingProfilePreset } from '@ui/shared/markdown-reading-profile-presets';

type BubbleRole = 'user' | 'assistant';

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function stripAngleBrackets(url: string): string {
  const text = String(url || '').trim();
  if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
  return text;
}

function parseSyncnosAssetId(url: unknown): number | null {
  const text = String(url || '').trim();
  const matched = /^syncnos-asset:\/\/(\d+)$/i.exec(text);
  if (!matched) return null;
  const id = Number(matched[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function collectOrderedSyncnosAssetIds(markdown: string): number[] {
  const raw = String(markdown || '');
  if (!raw) return [];
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  const seen = new Set<number>();
  const out: number[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = MARKDOWN_IMAGE_RE.exec(raw)) != null) {
    const urlPart = match[2] ? String(match[2]) : '';
    const assetId = parseSyncnosAssetId(stripAngleBrackets(urlPart));
    if (!assetId) continue;
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    out.push(assetId);
  }
  return out;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e);
    }
  });
}

function normalizeRole(role: unknown): BubbleRole {
  const r = String(role || '')
    .trim()
    .toLowerCase();
  if (!r) return 'assistant';

  // Normalize common variants from legacy data / different collectors.
  if (r === 'user' || r === 'human' || r === 'me' || r === 'you') return 'user';
  if (r === 'assistant' || r === 'ai' || r === 'bot' || r === 'model') return 'assistant';
  return 'assistant';
}

export type ChatMessageBubbleProps = {
  role?: unknown;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  markdown: string;
  conversationId?: number;
  readingProfile?: unknown;
  className?: string;
};

// Shared singleton to avoid per-message renderer instantiation.
const sharedMd = createMarkdownRenderer({ openLinksInNewTab: true, renderMath: false });
let sharedMathMd: ReturnType<typeof createMarkdownRenderer> | null = null;
let sharedMathMdPromise: Promise<ReturnType<typeof createMarkdownRenderer>> | null = null;

const MATH_BLOCK_RE = /\$\$[\s\S]+?\$\$/;
const MATH_INLINE_RE = /(^|[^\\])\$(?!\$)[^$\n]+?\$(?!\$)/;
const MATH_BRACKET_RE = /\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/;

function markdownLikelyContainsMath(markdown: string): boolean {
  const text = String(markdown || '');
  if (!text) return false;
  return MATH_BLOCK_RE.test(text) || MATH_INLINE_RE.test(text) || MATH_BRACKET_RE.test(text);
}

async function ensureSharedMathRenderer(): Promise<ReturnType<typeof createMarkdownRenderer>> {
  if (sharedMathMd) return sharedMathMd;
  if (!sharedMathMdPromise) {
    sharedMathMdPromise = import('@ui/shared/markdown-math').then((mod) => {
      const renderer = mod.createKatexMarkdownRenderer({ openLinksInNewTab: true });
      sharedMathMd = renderer;
      return renderer;
    });
  }
  return sharedMathMdPromise;
}

export function ChatMessageBubble({
  role,
  headerLeft,
  headerRight,
  markdown,
  conversationId,
  readingProfile,
  className,
}: ChatMessageBubbleProps) {
  const bubbleRole = normalizeRole(role);
  const readingProfilePreset = useMemo(() => getMarkdownReadingProfilePreset(readingProfile), [readingProfile]);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const [mathRenderer, setMathRenderer] = useState<ReturnType<typeof createMarkdownRenderer> | null>(
    () => sharedMathMd,
  );

  const [assetSrcById, setAssetSrcById] = useState<Map<number, string>>(() => new Map());
  const containsMath = useMemo(() => markdownLikelyContainsMath(markdown), [markdown]);

  useEffect(() => {
    if (!containsMath || sharedMathMd) return;
    let disposed = false;
    void ensureSharedMathRenderer()
      .then(() => {
        if (disposed) return;
        setMathRenderer(sharedMathMd);
      })
      .catch((error) => {
        console.warn('[Markdown] failed to load math renderer', {
          error: error instanceof Error ? error.message : String(error || ''),
        });
      });
    return () => {
      disposed = true;
    };
  }, [containsMath]);

  useEffect(() => {
    const ids = collectOrderedSyncnosAssetIds(String(markdown || ''));
    if (!ids.length) {
      setAssetSrcById(new Map());
      return;
    }

    let disposed = false;
    const objectUrls: string[] = [];

    async function resolveAssets() {
      const next = new Map<number, string>();
      try {
        for (const id of ids) {
          const asset = await getImageCacheAssetById({ id, conversationId });
          if (!asset || disposed) continue;
          let url: string | null = null;
          try {
            url = URL.createObjectURL(asset.blob);
            objectUrls.push(url);
          } catch (_e) {
            url = null;
          }
          if (!url) {
            const dataUrl = await blobToDataUrl(asset.blob);
            if (disposed) continue;
            url = dataUrl;
          }
          if (url) next.set(id, url);
        }
      } catch (error) {
        console.warn('[ImageAssetRender] failed to resolve local asset urls', {
          error: error instanceof Error ? error.message : String(error || ''),
        });
      }
      if (!disposed) setAssetSrcById(next);
    }

    void resolveAssets();
    return () => {
      disposed = true;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [markdown, conversationId]);

  const html = useMemo(() => {
    const activeMathRenderer = mathRenderer || sharedMathMd;
    const renderer = containsMath && activeMathRenderer ? activeMathRenderer : sharedMd;
    return renderer.render(String(markdown || ''), { syncnosAssetSrcById: assetSrcById } as any);
  }, [markdown, assetSrcById, containsMath, mathRenderer]);
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  // NOTE: asset URLs are resolved before render via markdown-it env;
  // no post-render DOM hydration is needed, which avoids re-render race conditions.

  const bubbleBase = 'tw-min-w-0 tw-border tw-rounded-[var(--radius-chip)] tw-p-3 tw-shadow-none';

  const bubbleRoleClass =
    bubbleRole === 'user'
      ? 'tw-bg-[var(--bubble-user-bg)] tw-border-[var(--bubble-user-border)] tw-text-[var(--secondary-foreground)]'
      : 'tw-bg-[var(--bg-card)] tw-border-[var(--border)] tw-text-[var(--text-primary)]';
  const profileBubbleClass = String(readingProfilePreset.bubbleClassName || '');
  const profileBubbleRoleClass = String(readingProfilePreset.bubbleRoleOverrides?.[bubbleRole] || '');

  const headerBase = 'tw-flex tw-items-center tw-justify-between tw-gap-2 tw-mb-1.5';
  const headerToneClass =
    bubbleRole === 'user' ? 'tw-text-[var(--secondary-foreground)] tw-opacity-70' : 'tw-text-[var(--text-secondary)]';
  const headerLeftClass = `tw-text-[11px] tw-font-[760] ${headerToneClass}`;
  const headerRightClass = `tw-text-[11px] tw-font-[650] ${headerToneClass}`;

  // Tailwind-only Markdown structural styling (no global CSS selectors).
  const mdStructureClass = [
    // NOTE: Tailwind uses `prefix: "tw-"`. For arbitrary properties/selectors, do NOT
    // prefix the `[...]` segment, only prefix the actual utility (e.g. `[&_p]:tw-mt-0`).
    // Keep the container shrinkable in flex/grid layouts.
    'tw-min-w-0 tw-break-words [overflow-wrap:anywhere] tw-overflow-x-hidden tw-font-normal',
    '[&>*:first-child]:tw-mt-0 [&>*:last-child]:tw-mb-0',

    '[&_p]:tw-mt-0',

    '[&_h1]:tw-mt-6 [&_h1]:tw-mb-2 [&_h1]:tw-font-[600]',
    '[&_h2]:tw-mt-5 [&_h2]:tw-mb-2 [&_h2]:tw-font-[600]',
    '[&_h3]:tw-mt-4 [&_h3]:tw-mb-2 [&_h3]:tw-font-[600]',
    '[&_h4]:tw-mt-4 [&_h4]:tw-mb-2 [&_h4]:tw-font-[600]',
    '[&_h5]:tw-mt-4 [&_h5]:tw-mb-2 [&_h5]:tw-font-[600]',
    '[&_h6]:tw-mt-4 [&_h6]:tw-mb-2 [&_h6]:tw-font-[600]',

    '[&_strong]:tw-font-[800]',
    '[&_em]:tw-italic',
    '[&_del]:tw-opacity-70',

    '[&_ul]:tw-mt-0 [&_ul]:tw-mb-2 [&_ul]:tw-pl-5 [&_ul]:tw-list-disc',
    '[&_ol]:tw-mt-0 [&_ol]:tw-mb-2 [&_ol]:tw-pl-5 [&_ol]:tw-list-decimal',
    '[&_ul>li+li]:tw-mt-1 [&_ol>li+li]:tw-mt-1',
    '[&_li>p]:tw-mb-1 [&_li>p:last-child]:tw-mb-0',

    // Blockquotes are profile-controlled; keep only structural safety rules here.
    '[&_blockquote]:tw-relative [&_blockquote]:tw-mt-0 [&_blockquote]:tw-mx-0',
    '[&_blockquote_blockquote]:tw-mt-2 [&_blockquote_blockquote]:tw-mb-0',

    // Inline code: use currentColor-based translucent background for both bubble variants.
    '[&_code]:tw-px-[5px] [&_code]:tw-py-[1px] [&_code]:tw-rounded-[var(--radius-inline)] [&_code]:tw-bg-[color-mix(in_srgb,currentColor_12%,transparent)] [&_code]:tw-font-mono',
    '[&_kbd]:tw-inline-flex [&_kbd]:tw-items-center [&_kbd]:tw-rounded-[var(--radius-inline)] [&_kbd]:tw-border [&_kbd]:tw-border-[var(--border)] [&_kbd]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_55%,var(--bg-card))] [&_kbd]:tw-px-[6px] [&_kbd]:tw-py-[1px] [&_kbd]:tw-font-mono',

    // Code blocks: keep contrast high in both light/dark bubbles.
    '[&_pre]:tw-mt-0 [&_pre]:tw-mb-2 [&_pre]:tw-px-[10px] [&_pre]:tw-py-[8px] [&_pre]:tw-rounded-[var(--radius-inline)] [&_pre]:tw-border [&_pre]:tw-border-[var(--border)] [&_pre]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_55%,var(--bg-card))] [&_pre]:tw-overflow-auto',
    '[&_pre>code]:tw-block [&_pre>code]:tw-p-0 [&_pre>code]:tw-bg-transparent [&_pre>code]:tw-rounded-none',

    // Tables can be wider than the viewport; let the table itself scroll instead of the whole bubble.
    '[&_table]:tw-block [&_table]:tw-overflow-x-auto [&_table]:tw-border-collapse [&_table]:tw-w-max [&_table]:tw-max-w-full',
    '[&_th]:tw-border [&_th]:tw-border-[var(--border)] [&_th]:tw-px-[6px] [&_th]:tw-py-[4px] [&_th]:tw-align-top [&_th]:tw-font-[600]',
    '[&_td]:tw-border [&_td]:tw-border-[var(--border)] [&_td]:tw-px-[6px] [&_td]:tw-py-[4px] [&_td]:tw-align-top',
    '[&_thead_th]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_70%,var(--bg-card))]',
    '[&_tbody_tr:nth-child(even)>td]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_42%,transparent)]',

    '[&_hr]:tw-my-3 [&_hr]:tw-border-0 [&_hr]:tw-h-px [&_hr]:tw-bg-[color-mix(in_srgb,var(--border)_70%,transparent)]',

    // Images: never overflow the bubble, and avoid giant original-size rendering.
    '[&_img]:tw-block [&_img]:tw-h-auto [&_img]:tw-object-contain',
    '[&_img]:tw-max-w-[min(360px,100%)] [&_img]:tw-max-h-[240px]',
    '[&_img]:tw-rounded-[var(--radius-inline)] [&_img]:tw-border [&_img]:tw-border-[var(--border)]',
    '[&_.syncnos-md-image]:tw-inline-block [&_.syncnos-md-image]:tw-max-w-full',
    '[&_.syncnos-md-image-link]:tw-mt-2 [&_.syncnos-md-image-link]:tw-block [&_.syncnos-md-image-link]:tw-max-w-full [&_.syncnos-md-image-link]:tw-whitespace-normal [&_.syncnos-md-image-link]:tw-text-[var(--text-secondary)] [&_.syncnos-md-image-link]:tw-break-words [&_.syncnos-md-image-link]:[overflow-wrap:anywhere]',
    '[&_.syncnos-md-image-link_a]:tw-text-[var(--text-secondary)] [&_.syncnos-md-image-link_a]:tw-underline [&_.syncnos-md-image-link_a]:tw-underline-offset-[2px] [&_.syncnos-md-image-link_a]:tw-decoration-[color-mix(in_srgb,var(--text-secondary)_55%,transparent)] [&_.syncnos-md-image-link_a:hover]:tw-decoration-[color-mix(in_srgb,var(--text-secondary)_85%,transparent)]',

    // KaTeX blocks: prevent overflow and keep spacing consistent with other blocks.
    '[&_.katex-display]:tw-my-2 [&_.katex-display]:tw-overflow-x-auto [&_.katex-display]:tw-max-w-full',

    // Links are profile-controlled; keep focus accessibility here.
    '[&_a:focus-visible]:tw-outline [&_a:focus-visible]:tw-outline-2 [&_a:focus-visible]:tw-outline-offset-2 [&_a:focus-visible]:tw-outline-[var(--focus-ring)]',
  ].join(' ');

  const mdClass = [mdStructureClass, readingProfilePreset.typographyClassName, className].filter(Boolean).join(' ');
  const mdRoleOverrides = String(readingProfilePreset.roleOverrides?.[bubbleRole] || '');

  return (
    <section className={[bubbleBase, bubbleRoleClass, profileBubbleClass, profileBubbleRoleClass].filter(Boolean).join(' ')}>
      {headerLeft || headerRight ? (
        <header className={headerBase}>
          <div className={headerLeftClass}>{headerLeft}</div>
          <div className={headerRightClass}>{headerRight}</div>
        </header>
      ) : null}
      <div
        ref={markdownRef}
        className={[mdClass, mdRoleOverrides].filter(Boolean).join(' ')}
        dangerouslySetInnerHTML={innerHtml}
      />
    </section>
  );
}
