import { useMemo, useRef, useState } from 'react';

import { exportBackupZipV2 } from '../../../sync/backup/export';
import {
  importBackupLegacyJsonMerge,
  importBackupZipV2Merge,
  type ImportProgress,
  type ImportStats,
} from '../../../sync/backup/import';
import { extractZipEntries } from '../../../sync/backup/zip-utils';

function formatProgress(p: ImportProgress) {
  const safeTotal = Math.max(0, Number(p.total) || 0);
  const safeDone = Math.min(safeTotal || 0, Math.max(0, Number(p.done) || 0));
  const pct = safeTotal ? Math.floor((safeDone / safeTotal) * 100) : 0;
  const labelStage = p.stage ? ` ${p.stage}` : '';
  return { pct, text: `Importing… ${pct}% (${safeDone}/${safeTotal})${labelStage}`.trim() };
}

async function isZipFile(file: File) {
  if (!file) return false;
  const name = file.name ? String(file.name).toLowerCase() : '';
  const type = file.type ? String(file.type).toLowerCase() : '';
  if (name.endsWith('.zip') || type.includes('zip')) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head.length < 4) return false;
    return (
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      ((head[2] === 0x03 && head[3] === 0x04) ||
        (head[2] === 0x05 && head[3] === 0x06) ||
        (head[2] === 0x07 && head[3] === 0x08))
    );
  } catch (_e) {
    return false;
  }
}

function renderStats(stats: ImportStats | null) {
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

export default function Backup() {
  const [exportStatus, setExportStatus] = useState<string>('Idle');
  const [importStatus, setImportStatus] = useState<string>('Ready');
  const [busy, setBusy] = useState(false);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const buttonStyle = useMemo(
    () => ({
      padding: '8px 12px',
      borderRadius: 8,
      border: '1px solid color-mix(in oklab, CanvasText 15%, transparent)',
      background: 'color-mix(in oklab, Canvas 85%, CanvasText 2%)',
      cursor: 'pointer',
    }),
    [],
  );

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    setExportStatus('Exporting…');
    try {
      const res = await exportBackupZipV2();
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      setExportStatus(`Exported (${res.counts.conversations} convos, ${res.counts.messages} msgs)`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      const msg = (e as any)?.message ? String((e as any).message) : String(e || 'export failed');
      setExportStatus(`Error: ${msg}`);
      alert(msg);
    } finally {
      setBusy(false);
    }
  }

  async function importFromFile(file: File) {
    if (busy) return;
    setBusy(true);
    setImportStats(null);
    setImportStatus(`Importing: ${file.name}`);
    try {
      const asZip = await isZipFile(file);
      let stats: ImportStats;
      if (asZip) {
        const entries = await extractZipEntries(file);
        stats = await importBackupZipV2Merge(entries, (p) => {
          const view = formatProgress(p);
          setImportStatus(view.text);
        });
      } else {
        const text = await file.text();
        const doc = JSON.parse(text);
        stats = await importBackupLegacyJsonMerge(doc, (p) => {
          const view = formatProgress(p);
          setImportStatus(view.text);
        });
      }
      setImportStats(stats);
      setImportStatus('Imported ✓');
    } catch (e) {
      const msg = (e as any)?.message ? String((e as any).message) : String(e || 'import failed');
      setImportStatus(`Error: ${msg}`);
      alert(msg);
    } finally {
      setBusy(false);
      try {
        if (inputRef.current) inputRef.current.value = '';
      } catch (_e) {
        // ignore
      }
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
      <h1 style={{ margin: 0 }}>Backup</h1>

      <section
        style={{
          border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
          borderRadius: 12,
          padding: 12,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Export (Zip v2)</h2>
        <button style={buttonStyle as any} onClick={() => handleExport().catch(() => {})} disabled={busy}>
          Export Database Zip
        </button>
        <div style={{ marginTop: 8, opacity: 0.85 }}>{exportStatus}</div>
      </section>

      <section
        style={{
          border: '1px solid color-mix(in oklab, CanvasText 12%, transparent)',
          borderRadius: 12,
          padding: 12,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Import (Zip v2 / Legacy JSON)</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            style={buttonStyle as any}
            disabled={busy}
            onClick={() => {
              if (busy) return;
              inputRef.current?.click();
            }}
          >
            Choose File…
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFromFile(file).catch(() => {});
            }}
          />
          <div style={{ opacity: 0.85 }}>{importStatus}</div>
        </div>
        <div style={{ marginTop: 10 }}>{renderStats(importStats)}</div>
      </section>
    </div>
  );
}
