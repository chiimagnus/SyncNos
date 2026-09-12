import type { VideoChapter } from '@services/shared/video-capture';

export type VideoTranscriptCue = {
  startSeconds: number;
  endSeconds: number | null;
  text: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function normalizeSingleLine(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function readNonNegativeNumber(value: unknown): number | null {
  if (value == null) return null;
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '') return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeEnd(value: unknown, startSeconds: number): number | null {
  const endSeconds = readNonNegativeNumber(value);
  return endSeconds != null && endSeconds >= startSeconds ? endSeconds : null;
}

export function toCanonicalVideoTranscriptCues(value: unknown): VideoTranscriptCue[] {
  if (!Array.isArray(value)) return [];
  const cues: VideoTranscriptCue[] = [];
  for (const item of value) {
    const startSeconds = readNonNegativeNumber((item as any)?.start);
    const text = normalizeText((item as any)?.text);
    if (startSeconds == null || !text) continue;
    cues.push({
      startSeconds,
      endSeconds: normalizeEnd((item as any)?.end, startSeconds),
      text,
    });
  }
  return cues;
}

export function normalizeCanonicalVideoTranscriptCues(value: unknown): VideoTranscriptCue[] {
  if (!Array.isArray(value)) return [];
  const cues: VideoTranscriptCue[] = [];
  for (const item of value) {
    const startSeconds = readNonNegativeNumber((item as any)?.startSeconds);
    const text = normalizeText((item as any)?.text);
    if (startSeconds == null || !text) continue;
    cues.push({
      startSeconds,
      endSeconds: normalizeEnd((item as any)?.endSeconds, startSeconds),
      text,
    });
  }
  return cues;
}

export function normalizeCanonicalVideoChapters(value: unknown): VideoChapter[] {
  if (!Array.isArray(value)) return [];
  const chapters: VideoChapter[] = [];
  for (const item of value) {
    const title = normalizeSingleLine((item as any)?.title);
    const startSeconds = readNonNegativeNumber((item as any)?.startSeconds);
    if (!title || startSeconds == null) continue;
    chapters.push({
      title,
      startSeconds,
      endSeconds: normalizeEnd((item as any)?.endSeconds, startSeconds),
    });
  }
  return chapters;
}

export function formatVideoTimecode(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const totalMilliseconds = Math.round(safeSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const base =
    hours > 0 ? `${pad2(hours)}:${pad2(minutes)}:${pad2(wholeSeconds)}` : `${pad2(minutes)}:${pad2(wholeSeconds)}`;
  return milliseconds ? `${base}.${String(milliseconds).padStart(3, '0')}` : base;
}

export function formatVideoTranscriptMarkdown(cues: VideoTranscriptCue[]): string {
  return cues
    .map((cue) => {
      const start = formatVideoTimecode(cue.startSeconds);
      const range = cue.endSeconds == null ? start : `${start} → ${formatVideoTimecode(cue.endSeconds)}`;
      return `[${range}] ${cue.text}`;
    })
    .join('\n')
    .trim();
}

export function formatVideoChaptersMarkdown(chapters: VideoChapter[]): string {
  if (!chapters.length) return '';
  const lines = chapters.map((chapter) => {
    const start = formatVideoTimecode(chapter.startSeconds);
    const range = chapter.endSeconds == null ? start : `${start} → ${formatVideoTimecode(chapter.endSeconds)}`;
    return `- [${range}] ${chapter.title}`;
  });
  return `## Chapters\n\n${lines.join('\n')}`;
}
