export type TranscriptCue = {
  start: number;
  end?: number;
  text: string;
};

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function decodeHtmlEntities(input: string): string {
  const text = String(input || '');
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = Number(n);
      if (!Number.isFinite(code)) return '';
      try {
        return String.fromCharCode(code);
      } catch (_e) {
        return '';
      }
    });
}

function parseTimestampSeconds(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  // 00:01:02.345 or 01:02.345 or 01:02
  const m = text.match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const hasHours = !!m[1];
  const hours = hasHours ? Number(String(m[1]).replace(':', '')) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  const ms = m[4] ? Number(String(m[4]).padEnd(3, '0').slice(0, 3)) : 0;
  if (![hours, minutes, seconds, ms].every((x) => Number.isFinite(x))) return null;
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

export function parseWebVtt(text: string): TranscriptCue[] {
  const src = normalizeText(text);
  if (!src) return [];
  const lines = src.split('\n');
  const cues: TranscriptCue[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = String(lines[i] || '').trim();
    i += 1;
    if (!line) continue;
    if (line.startsWith('WEBVTT')) continue;
    // Skip cue identifiers (non-timestamp)
    if (!line.includes('-->')) continue;

    const parts = line.split('-->');
    const startRaw = String(parts[0] || '').trim();
    const endRaw =
      String(parts[1] || '')
        .trim()
        .split(/\s+/)[0] || '';
    const start = parseTimestampSeconds(startRaw);
    const end = parseTimestampSeconds(endRaw);
    if (start == null) continue;

    const texts: string[] = [];
    while (i < lines.length) {
      const t = String(lines[i] || '');
      i += 1;
      if (!t.trim()) break;
      texts.push(t);
    }

    const joined = normalizeText(texts.join('\n').replace(/<[^>]+>/g, ''));
    if (!joined) continue;
    cues.push({ start, ...(end != null ? { end } : null), text: joined });
  }

  return cues;
}

export function parseYoutubeTimedtextXml(text: string): TranscriptCue[] {
  const src = normalizeText(text);
  if (!src) return [];
  const cues: TranscriptCue[] = [];
  const re = /<text\b[^>]*\bstart="([^"]+)"[^>]*?(?:\bdur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/gim;
  for (;;) {
    const m = re.exec(src);
    if (!m) break;
    const start = Number(m[1]);
    const dur = m[2] != null ? Number(m[2]) : NaN;
    if (!Number.isFinite(start)) continue;
    const end = Number.isFinite(dur) ? start + dur : undefined;
    const raw = decodeHtmlEntities(
      String(m[3] || '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    const cleaned = normalizeText(raw);
    if (!cleaned) continue;
    cues.push({ start, ...(end != null ? { end } : null), text: cleaned });
  }
  return cues;
}

export function parseYoutubeJson3(text: string): TranscriptCue[] {
  const src = normalizeText(text);
  if (!src) return [];
  try {
    const json: any = JSON.parse(src);
    const events = Array.isArray(json?.events) ? json.events : [];
    const out: TranscriptCue[] = [];
    for (const ev of events) {
      const tStartMs = Number(ev?.tStartMs);
      const dDurationMs = Number(ev?.dDurationMs);
      if (!Number.isFinite(tStartMs)) continue;
      const start = tStartMs / 1000;
      const end = Number.isFinite(dDurationMs) ? start + dDurationMs / 1000 : undefined;
      const segs = Array.isArray(ev?.segs) ? ev.segs : [];
      const text = normalizeText(
        segs
          .map((s: any) => (s?.utf8 != null ? String(s.utf8) : ''))
          .join('')
          .replace(/\s+/g, ' '),
      );
      if (!text) continue;
      out.push({ start, ...(end != null ? { end } : null), text });
    }
    return out;
  } catch (_e) {
    return [];
  }
}

export function parseBilibiliSubtitleJson(text: string): TranscriptCue[] {
  const src = normalizeText(text);
  if (!src) return [];
  try {
    const json: any = JSON.parse(src);
    const body =
      (Array.isArray(json?.body) ? json.body : null) ??
      (Array.isArray(json?.data?.body) ? json.data.body : null) ??
      (Array.isArray(json?.result?.body) ? json.result.body : null) ??
      (Array.isArray(json?.subtitle?.body) ? json.subtitle.body : null) ??
      [];
    const out: TranscriptCue[] = [];
    for (const item of body) {
      const start = Number(item?.from);
      const end = Number(item?.to);
      const content = normalizeText(String(item?.content || ''));
      if (!Number.isFinite(start) || !content) continue;
      out.push({ start, ...(Number.isFinite(end) ? { end } : null), text: content });
    }
    return out;
  } catch (_e) {
    return [];
  }
}
