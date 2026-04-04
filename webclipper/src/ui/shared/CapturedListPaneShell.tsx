import type { ReactNode } from 'react';

import { getURL as runtimeGetURL } from '@services/shared/runtime';

export type CapturedListPaneShellProps = {
  rightSlot?: ReactNode;
  belowHeader?: ReactNode;
  children: ReactNode;
};

export function CapturedListPaneShell({ rightSlot, belowHeader, children }: CapturedListPaneShellProps) {
  const logoUrl = runtimeGetURL('icons/icon-128.png');

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-primary)]">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-3">
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="SyncNos"
                className="tw-size-8 tw-rounded-xl tw-object-contain"
                draggable={false}
              />
            ) : (
              <span
                className="tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-text-[11px] tw-font-black tw-tracking-[0.12em] tw-text-[var(--text-primary)]"
                aria-hidden="true"
              >
                SN
              </span>
            )}
          </div>

          {rightSlot ? <div className="tw-flex tw-items-center tw-gap-2">{rightSlot}</div> : null}
        </div>
      </div>

      {belowHeader ?? null}
      {children}
    </div>
  );
}
