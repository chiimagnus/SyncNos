import type { VideoChapter } from '@services/shared/video-capture';

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

function readNonNegativeNumber(value: unknown): number | null {
  if (value == null) return null;
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '') return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
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
    cues.push({ start, ...(end != null && end >= start ? { end } : null), text: joined });
  }

  return cues;
}

export function parseYoutubeTimedtextXml(text: string): TranscriptCue[] {
  const src = normalizeText(text);
  if (!src) return [];
  const cues: TranscriptCue[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gim;
  const readAttribute = (attributes: string, name: string) => {
    const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return match ? (match[1] ?? match[2] ?? '') : null;
  };

  for (;;) {
    const match = re.exec(src);
    if (!match) break;
    const start = readNonNegativeNumber(readAttribute(match[1] || '', 'start'));
    if (start == null) continue;
    const duration = readNonNegativeNumber(readAttribute(match[1] || '', 'dur'));
    const end = duration == null ? undefined : start + duration;
    const raw = decodeHtmlEntities(
      String(match[2] || '')
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
      const tStartMs = readNonNegativeNumber(ev?.tStartMs);
      const dDurationMs = readNonNegativeNumber(ev?.dDurationMs);
      if (tStartMs == null) continue;
      const start = tStartMs / 1000;
      const end = dDurationMs == null ? undefined : start + dDurationMs / 1000;
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
    const body = Array.isArray(json?.body) ? json.body : [];
    const out: TranscriptCue[] = [];
    for (const item of body) {
      const start = readNonNegativeNumber(item?.from);
      const end = readNonNegativeNumber(item?.to);
      const content = normalizeText(item?.content);
      if (start == null || !content) continue;
      out.push({ start, ...(end != null && end >= start ? { end } : null), text: content });
    }
    return out;
  } catch (_e) {
    return [];
  }
}

export function parseBilibiliViewPointsJson(text: string): VideoChapter[] | null {
  const src = normalizeText(text);
  if (!src) return null;
  try {
    const json: any = JSON.parse(src);
    if (Number(json?.code) !== 0 || !Array.isArray(json?.data?.view_points)) return null;

    const chapters: VideoChapter[] = [];
    for (const item of json.data.view_points) {
      const title = normalizeText(item?.content).replace(/\s+/g, ' ');
      const startSeconds = readNonNegativeNumber(item?.from);
      const end = readNonNegativeNumber(item?.to);
      if (!title || startSeconds == null) continue;
      chapters.push({
        title,
        startSeconds,
        endSeconds: end != null && end >= startSeconds ? end : null,
      });
    }
    return chapters;
  } catch (_error) {
    return null;
  }
}
