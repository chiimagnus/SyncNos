import type { RefObject } from 'react';

import { formatTime } from '../utils';
import { buttonClassName, buttonStyle, cardClassName, cardStyle } from '../ui';

function ImportStatsList(props: { stats: any }) {
  const stats = props.stats;
  if (!stats) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li>
        Conversations: +{stats.conversationsAdded} / ~{stats.conversationsUpdated}
      </li>
      <li>
        Messages: +{stats.messagesAdded} / ~{stats.messagesUpdated} (skipped {stats.messagesSkipped})
      </li>
      <li>
        Mappings: +{stats.mappingsAdded} / ~{stats.mappingsUpdated}
      </li>
      <li>Settings applied: {stats.settingsApplied}</li>
    </ul>
  );
}

export function BackupSection(props: {
  busy: boolean;
  exportStatus: string;
  importStatus: string;
  importStats: any;
  lastBackupExportAt: number;
  backupImportRef: RefObject<HTMLDivElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onExport: () => void;
  onImportFile: (file: File) => void;
}) {
  const { busy, exportStatus, importStatus, importStats, lastBackupExportAt, backupImportRef, fileInputRef, onExport, onImportFile } = props;

  return (
    <section style={cardStyle as any} className={cardClassName} aria-label="Database Backup">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Database Backup</h2>

      <div ref={backupImportRef} id="settings-backup-import" style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={buttonClassName} style={buttonStyle as any} onClick={onExport} disabled={busy}>
          Export (Zip v2)
        </button>
        <button
          className={buttonClassName}
          style={buttonStyle as any}
          disabled={busy}
          onClick={() => {
            if (busy) return;
            fileInputRef.current?.click();
          }}
        >
          Import…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip,application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
          }}
        />
      </div>
      <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>export: {exportStatus}</div>
      <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>last export: {lastBackupExportAt ? formatTime(lastBackupExportAt) : '—'}</div>
      <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>import: {importStatus}</div>
      <div style={{ marginTop: 10 }}>
        <ImportStatsList stats={importStats} />
      </div>
    </section>
  );
}

