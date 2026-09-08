import { t } from '@i18n';

export type ApiError = { message: string; extra: unknown } | null;
export type ApiResponse<T> = { ok: boolean; data: T | null; error: ApiError };

export function unwrap<T>(res: ApiResponse<T>): T {
  if (!res || typeof res.ok !== 'boolean') throw new Error('no response from background');
  if (res.ok) return res.data as T;
  const message = res.error?.message ?? 'unknown error';
  throw new Error(message);
}

export function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function formatProgress(p: { total: number; done: number; stage?: string }) {
  const safeTotal = Math.max(0, Number(p.total) || 0);
  const safeDone = Math.min(safeTotal || 0, Math.max(0, Number(p.done) || 0));
  const pct = safeTotal ? Math.floor((safeDone / safeTotal) * 100) : 0;
  const stageLabels: Record<string, string> = {
    conversations: t('importStageConversations'),
    messages: t('importStageMessages'),
    mappings: t('importStageMappings'),
    settings: t('importStageSettings'),
  };
  const rawStage = String(p.stage || '').trim();
  const stageLabel = rawStage ? stageLabels[rawStage] || rawStage : '';
  const labelStage = stageLabel ? ` ${stageLabel}` : '';
  return { pct, text: `${t('importingDots')} ${pct}% (${safeDone}/${safeTotal})${labelStage}`.trim() };
}

export type NotionPageOption = { id: string; title: string };

export function openHttpUrl(url: string) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const anyGlobal: any = globalThis as any;
    const tabs = anyGlobal.browser?.tabs ?? anyGlobal.chrome?.tabs;
    if (tabs?.create) {
      tabs.create({ url: u });
      return true;
    }
  } catch (_e) {
    // ignore
  }
  try {
    window.open(u, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_e) {
    return false;
  }
}
