import { t } from '@i18n';

export const CAPTURE_TIP_TITLE_MAX_CHARS = 48;

function normalizeTitle(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateForTip(title: string, maxChars: number): string {
  const value = normalizeTitle(title);
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(1, Math.floor(Number(maxChars))) : 60;
  if (!value) return '';
  if (value.length <= limit) return value;
  const sliceLen = Math.max(0, limit - 1);
  return `${value.slice(0, sliceLen)}…`;
}

export function buildCaptureSuccessTipMessage(input: {
  title?: unknown;
  isNew?: unknown;
  maxTitleChars?: number;
}): string {
  const isNew = input?.isNew !== false;
  const prefix = isNew ? t('savedPrefix') : t('updatedPrefix');
  const maxChars =
    input && typeof input.maxTitleChars === 'number' && Number.isFinite(input.maxTitleChars)
      ? Math.max(1, Math.floor(input.maxTitleChars))
      : CAPTURE_TIP_TITLE_MAX_CHARS;

  const title = truncateForTip(normalizeTitle(input?.title), maxChars);
  if (title) return `${prefix}${title}`;
  return isNew ? t('saved') : t('updated');
}
