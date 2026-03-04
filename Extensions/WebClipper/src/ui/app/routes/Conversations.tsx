import { useMemo, useState } from 'react';
import { createZipBlob } from '../../../sync/backup/zip-utils';
import { buildConversationBasename } from '../../../conversations/domain/file-naming';
import { formatConversationMarkdown } from '../../../conversations/domain/markdown';
import { deleteConversations, getConversationDetail } from '../../../conversations/client/repo';
import { syncNotionConversations, syncObsidianConversations } from '../../../sync/repo';
import { useConversationsApp } from '../conversations/conversations-context';

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function Conversations() {
  const {
    items,
    activeId,
    selectedIds,
    loadingList,
    listError,
    selectedConversation: selected,
    loadingDetail,
    detailError,
    detail,
    refreshList,
    refreshActiveDetail,
    clearSelected,
  } = useConversationsApp();

  const [exporting, setExporting] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [syncingObsidian, setSyncingObsidian] = useState(false);

  const onDeleteSelected = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    const ok = confirm(`Delete ${ids.length} conversation(s)? This cannot be undone.`);
    if (!ok) return;

    // keep UI responsive; list refresh happens after delete
    try {
      await deleteConversations(ids);
      clearSelected();
      if (activeId != null && ids.includes(Number(activeId))) {
        // Let provider pick the next active conversation on refresh.
      }
      await refreshList();
      await refreshActiveDetail();
    } catch (e) {
      // Provider owns the primary list error surface; show a best-effort alert here.
      alert((e as any)?.message ?? String(e ?? 'failed'));
    }
  };

  const exportSelectedMarkdown = async ({ mergeSingle }: { mergeSingle: boolean }) => {
    const ids = selectedIds.slice();
    if (!ids.length) return;

    setExporting(true);
    try {
      const selectedConversations = items.filter((c) => ids.includes(Number(c.id)));
      if (!selectedConversations.length) return;

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const files: Array<{ name: string; data: string }> = [];

      if (mergeSingle) {
        const docs: string[] = [];
        for (const c of selectedConversations) {
          // eslint-disable-next-line no-await-in-loop
          const d = await getConversationDetail(Number(c.id));
          docs.push(formatConversationMarkdown(c, d.messages || []));
        }
        const text = docs.join('\n---\n\n');
        files.push({ name: `webclipper-export-${stamp}.md`, data: text });
      } else {
        for (const c of selectedConversations) {
          // eslint-disable-next-line no-await-in-loop
          const d = await getConversationDetail(Number(c.id));
          files.push({
            name: `${buildConversationBasename(c)}.md`,
            data: formatConversationMarkdown(c, d.messages || []),
          });
        }
      }

      const zipBlob = await createZipBlob(files);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webclipper-export-${stamp}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert((e as any)?.message ?? String(e ?? 'export failed'));
    } finally {
      setExporting(false);
    }
  };

  const onSyncNotion = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingNotion(true);
    try {
      await syncNotionConversations(ids);
    } catch (e) {
      alert((e as any)?.message ?? String(e ?? 'notion sync failed'));
    } finally {
      setSyncingNotion(false);
    }
  };

  const onSyncObsidian = async () => {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    setSyncingObsidian(true);
    try {
      await syncObsidianConversations(ids);
    } catch (e) {
      alert((e as any)?.message ?? String(e ?? 'obsidian sync failed'));
    } finally {
      setSyncingObsidian(false);
    }
  };

  const baseButtonClass =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3 tw-text-xs tw-font-bold tw-transition-colors tw-duration-200 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const neutralButtonClass = `${baseButtonClass} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)] hover:tw-bg-[var(--btn-bg-hover)]`;
  const primaryButtonClass = `${baseButtonClass} tw-border-[var(--text)] tw-bg-[var(--text)] tw-text-white hover:tw-bg-[#c94f20]`;
  const dangerButtonClass = `${baseButtonClass} tw-border-[var(--danger)] tw-bg-[var(--danger-bg)] tw-text-[var(--danger)] hover:tw-bg-[#ffd7d3]`;

  return (
    <section className="tw-h-full tw-min-h-0">
      <section className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3" aria-label="Conversation detail">
        <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-pb-2">
          <div className="tw-min-w-0">
            <h2 className="tw-m-0 tw-max-w-[85%] tw-truncate tw-text-[20px] tw-font-extrabold tw-tracking-[-0.01em] tw-text-[var(--text)]">
              {selected ? selected.title || '(Untitled)' : 'Detail'}
            </h2>
            <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
              {selected ? `${selected.source} · ${selected.conversationKey}` : 'Select one conversation from sidebar'}
            </div>
          </div>

          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
            <button
              onClick={() => refreshList().catch(() => {})}
              disabled={loadingList}
              type="button"
              className={primaryButtonClass}
            >
              {loadingList ? 'Loading…' : 'Refresh List'}
            </button>
            <button
              onClick={() => refreshActiveDetail().catch(() => {})}
              disabled={!activeId || loadingDetail}
              type="button"
              className={neutralButtonClass}
            >
              {loadingDetail ? 'Loading…' : 'Reload Detail'}
            </button>
            <button
              onClick={() => onSyncObsidian().catch(() => {})}
              disabled={!selectedIds.length || syncingObsidian}
              type="button"
              className={neutralButtonClass}
            >
              {syncingObsidian ? 'Syncing…' : 'Obsidian'}
            </button>
            <button
              onClick={() => onSyncNotion().catch(() => {})}
              disabled={!selectedIds.length || syncingNotion}
              type="button"
              className={neutralButtonClass}
            >
              {syncingNotion ? 'Syncing…' : 'Notion'}
            </button>
            <button
              onClick={() => exportSelectedMarkdown({ mergeSingle: true }).catch(() => {})}
              disabled={!selectedIds.length || exporting}
              type="button"
              className={neutralButtonClass}
            >
              Export 1 file
            </button>
            <button
              onClick={() => exportSelectedMarkdown({ mergeSingle: false }).catch(() => {})}
              disabled={!selectedIds.length || exporting}
              type="button"
              className={neutralButtonClass}
            >
              Export multi
            </button>
            <button
              onClick={() => onDeleteSelected().catch(() => {})}
              disabled={!selectedIds.length || loadingList}
              type="button"
              className={dangerButtonClass}
            >
              Delete
            </button>
          </div>
        </header>

        {listError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{listError}</p> : null}
        {loadingDetail ? <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Loading…</p> : null}
        {detailError ? <p className="tw-mt-2 tw-text-sm tw-font-semibold tw-text-[var(--danger)]">{detailError}</p> : null}

        {detail?.messages?.length ? (
          <div className="route-scroll tw-mt-3 tw-grid tw-gap-2.5 lg:tw-min-h-0 lg:tw-flex-1 lg:tw-overflow-auto lg:tw-pr-1">
            {detail.messages.map((m) => (
              <article key={String(m.id)} className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--panel)]/55 tw-p-3">
                <header className="tw-flex tw-items-center tw-justify-between tw-gap-2">
                  <div className="tw-font-mono tw-text-[11px] tw-font-black tw-uppercase tw-tracking-[0.08em] tw-text-[var(--text)]">{m.role}</div>
                  <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{formatTime(m.updatedAt)}</div>
                </header>
                <pre className="tw-m-0 tw-mt-2 tw-whitespace-pre-wrap tw-font-mono tw-text-[12px] tw-leading-5 tw-text-[var(--muted)]">
                  {m.contentMarkdown || m.contentText || ''}
                </pre>
              </article>
            ))}
          </div>
        ) : activeId ? (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">No messages.</p>
        ) : (
          <p className="tw-mt-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Select a conversation.</p>
        )}
      </section>
    </section>
  );
}
