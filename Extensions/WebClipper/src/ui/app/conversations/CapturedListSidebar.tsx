import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import { useConversationsApp } from './conversations-context';

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function itemClass(active: boolean) {
  const base = 'tw-w-full tw-rounded-xl tw-border tw-p-2.5 tw-text-left tw-transition-colors tw-duration-200';
  if (active) return `${base} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)]`;
  return `${base} tw-border-[var(--border)] tw-bg-white hover:tw-border-[var(--border-strong)] hover:tw-bg-[var(--panel)]`;
}

function settingsClass(isActive: boolean) {
  const base =
    'tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-xl tw-border tw-px-3 tw-py-2 tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200';
  if (isActive) return `${base} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  return `${base} tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]`;
}

export function CapturedListSidebar({ onCollapse }: { onCollapse: () => void }) {
  const {
    loadingList,
    items,
    activeId,
    selectedIds,
    toggleAll,
    toggleSelected,
    setActiveId,
    exporting,
    syncingNotion,
    syncingObsidian,
    deleting,
    exportSelectedMarkdown,
    syncSelectedNotion,
    syncSelectedObsidian,
    deleteSelected,
  } = useConversationsApp();
  const navigate = useNavigate();
  const location = useLocation();

  const allIds = items.map((x) => Number(x.id)).filter((x) => Number.isFinite(x) && x > 0);
  const allSelected = !!allIds.length && selectedIds.length === allIds.length;
  const hasSelection = selectedIds.length > 0;
  const busy = exporting || syncingNotion || syncingObsidian || deleting;
  const pct = allIds.length ? Math.floor((selectedIds.length / allIds.length) * 100) : 0;

  const actionButtonBase =
    'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3 tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';
  const actionButton = `${actionButtonBase} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)] hover:tw-bg-[var(--btn-bg-hover)]`;
  const dangerButton = `${actionButtonBase} tw-border-[var(--danger)] tw-bg-[var(--danger-bg)] tw-text-[var(--danger)] hover:tw-bg-[#ffd7d3]`;

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-2">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <span
            className="tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[11px] tw-font-black tw-tracking-[0.12em] tw-text-[var(--text)]"
            aria-hidden="true"
          >
            SN
          </span>
          <div className="tw-min-w-0">
            <p className="tw-m-0 tw-truncate tw-text-[13px] tw-font-black tw-leading-none tw-text-[var(--text)]">Captured List</p>
            <p className="tw-mt-1 tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
              {selectedIds.length}/{items.length} selected
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCollapse}
          className="tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]"
          aria-label="Collapse sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6.25 3.25L3 6.5L6.25 9.75"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M3.2 6.5H12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="tw-mt-1 tw-flex tw-items-center tw-justify-between tw-gap-3">
        <span className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{loadingList ? 'Refreshing...' : 'Ready'}</span>
        <span className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{items.length} total</span>
      </div>

      <div className="route-scroll tw-mt-2 tw-grid tw-min-h-0 tw-flex-1 tw-gap-2 tw-overflow-auto tw-pr-1">
        {items.length ? null : (
          <div className="tw-rounded-xl tw-border tw-border-dashed tw-border-[var(--border)] tw-bg-[var(--panel)]/70 tw-p-3 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
            No conversations yet.
          </div>
        )}

        {items.map((c) => {
          const id = Number(c.id);
          const active = Number(c.id) === Number(activeId) && location.pathname !== '/settings';
          const title = c.title && String(c.title).trim() ? String(c.title).trim() : '(Untitled)';
          return (
            <button
              key={String(c.id)}
              onClick={() => {
                setActiveId(id);
                navigate('/');
              }}
              type="button"
              className={itemClass(active)}
            >
              <div className="tw-flex tw-items-center tw-gap-2.5">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(id)}
                  onChange={() => toggleSelected(id)}
                  onClick={(e) => e.stopPropagation()}
                  className="tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]"
                />
                <div className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-bold tw-text-[var(--text)]">{title}</div>
              </div>
              <div className="tw-mt-1 tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
                {c.source} · {formatTime(c.lastCapturedAt)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="tw-mt-2 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/75 tw-p-3">
        {hasSelection ? (
          <div className="tw-grid tw-gap-2">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <div className="tw-text-xs tw-font-extrabold tw-text-[var(--text)]">{selectedIds.length} selected</div>
              <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">{busy ? 'Working…' : 'Actions'}</div>
            </div>
            <div className="tw-flex tw-flex-wrap tw-gap-2">
              <button type="button" className={dangerButton} onClick={() => deleteSelected().catch(() => {})} disabled={busy}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                className={actionButton}
                onClick={() => exportSelectedMarkdown({ mergeSingle: true }).catch(() => {})}
                disabled={busy}
              >
                {exporting ? 'Exporting…' : 'Export'}
              </button>
              <button type="button" className={actionButton} onClick={() => syncSelectedObsidian().catch(() => {})} disabled={busy}>
                {syncingObsidian ? 'Syncing…' : 'Obsidian'}
              </button>
              <button type="button" className={actionButton} onClick={() => syncSelectedNotion().catch(() => {})} disabled={busy}>
                {syncingNotion ? 'Syncing…' : 'Notion'}
              </button>
            </div>
          </div>
        ) : (
          <div className="tw-grid tw-gap-2">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <label className="tw-inline-flex tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]"
                />
                Select all
              </label>
              <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">
                {selectedIds.length}/{items.length} selected
              </div>
            </div>
            <div className="tw-h-2 tw-overflow-hidden tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-[var(--panel)]/70">
              <div
                className="tw-h-full tw-bg-[var(--border-strong)]"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        <div className="tw-mt-3">
          <NavLink to="/settings" className={({ isActive }) => settingsClass(isActive)}>
            Settings
          </NavLink>
        </div>
      </div>
    </div>
  );
}
