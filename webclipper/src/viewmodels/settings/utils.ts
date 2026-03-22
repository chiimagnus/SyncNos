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

export async function isZipFile(file: File) {
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

function getPageTitle(page: any) {
  try {
    const props = page && page.properties ? page.properties : {};
    for (const key of Object.keys(props)) {
      const p = props[key];
      if (p && p.type === 'title' && Array.isArray(p.title)) {
        const t = p.title.map((x: any) => x.plain_text || '').join('').trim();
        if (t) return t;
      }
    }
  } catch (_e) {
    // ignore
  }
  return page && page.url ? String(page.url) : 'Untitled';
}

export type NotionPageOption = { id: string; title: string };

export async function searchNotionParentPages(accessToken: string): Promise<NotionPageOption[]> {
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 50 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`notion api failed: HTTP ${res.status} ${text}`);
  const json = text ? JSON.parse(text) : {};
  const results = Array.isArray(json?.results) ? json.results : [];
  const pages = results.filter((item: any) => {
    if (!item || item.object !== 'page') return false;
    if (item.archived === true || item.in_trash === true) return false;
    const parent = item.parent || null;
    if (!parent) return true;
    if (parent.database_id) return false;
    if (parent.type === 'database_id') return false;
    return true;
  });
  return pages
    .map((p: any) => ({ id: String(p.id || ''), title: getPageTitle(p) }))
    .filter((p: NotionPageOption) => !!p.id);
}

export async function retrieveNotionParentPage(accessToken: string, pageId: string): Promise<NotionPageOption | null> {
  const safeId = String(pageId || '').trim();
  if (!safeId) return null;
  const res = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(safeId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': '2022-06-28',
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) return null;
  const json = text ? JSON.parse(text) : {};
  if (!json || json.object !== 'page') return null;
  if (json.archived === true || json.in_trash === true) return null;
  const id = String(json.id || safeId).trim();
  if (!id) return null;
  return { id, title: getPageTitle(json) };
}

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
