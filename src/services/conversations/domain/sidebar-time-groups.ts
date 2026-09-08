import type { Conversation } from '@services/conversations/domain/models';

export type ConversationSidebarGroupLabels = {
  today: string;
  yesterday: string;
  earlier: string;
};

export type ConversationSidebarRenderItem =
  | {
      type: 'section';
      key: string;
      label: string;
    }
  | {
      type: 'conversation';
      key: string;
      conversation: Conversation;
    };

function toStartOfLocalDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function toMonthKey(ts: number): { year: number; month: number } {
  const date = new Date(ts);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function formatExactDateLabel(ts: number, locale: string, includeYear: boolean): string {
  return new Intl.DateTimeFormat(
    locale,
    includeYear ? { year: 'numeric', month: 'numeric', day: 'numeric' } : { month: 'numeric', day: 'numeric' },
  ).format(new Date(ts));
}

function formatRecentDayLabel(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(new Date(ts));
}

function formatMonthLabel(ts: number, locale: string, includeYear: boolean): string {
  return new Intl.DateTimeFormat(locale, includeYear ? { year: 'numeric', month: 'long' } : { month: 'long' }).format(
    new Date(ts),
  );
}

function resolveSection(input: { ts: number; nowTs: number; locale: string; labels: ConversationSidebarGroupLabels }): {
  key: string;
  label: string;
} {
  const { ts, nowTs, locale, labels } = input;
  if (!Number.isFinite(ts) || ts <= 0) {
    return { key: 'earlier', label: labels.earlier };
  }

  const currentDay = toStartOfLocalDay(nowTs);
  const targetDay = toStartOfLocalDay(ts);
  const dayDiff = (currentDay - targetDay) / 86400000;

  if (dayDiff === 0) {
    return { key: 'today', label: labels.today };
  }
  if (dayDiff === 1) {
    return { key: 'yesterday', label: labels.yesterday };
  }
  if (dayDiff > 1 && dayDiff <= 6) {
    return { key: `day:${targetDay}`, label: formatRecentDayLabel(ts, locale) };
  }

  const nowMonth = toMonthKey(nowTs);
  const targetMonth = toMonthKey(ts);
  if (dayDiff < 0) {
    const includeYear = nowMonth.year !== targetMonth.year;
    return {
      key: `future-day:${targetDay}`,
      label: formatExactDateLabel(ts, locale, includeYear),
    };
  }

  const includeYear = nowMonth.year !== targetMonth.year;
  const label = formatMonthLabel(ts, locale, includeYear);
  return {
    key: includeYear ? `month:${targetMonth.year}-${targetMonth.month}` : `month:${targetMonth.month}`,
    label,
  };
}

export function buildConversationSidebarRenderItems(input: {
  conversations: Conversation[];
  locale: string;
  labels: ConversationSidebarGroupLabels;
  now?: number;
}): ConversationSidebarRenderItem[] {
  const conversations = Array.isArray(input.conversations) ? input.conversations : [];
  const locale = String(input.locale || '').trim() || 'en';
  const nowTs = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const labels = input.labels;
  const items: ConversationSidebarRenderItem[] = [];
  let activeSectionKey = '';

  for (const conversation of conversations) {
    const id = Number((conversation as any)?.id);
    const ts = Number((conversation as any)?.lastActivityAt) || 0;
    const section = resolveSection({ ts, nowTs, locale, labels });
    if (section.key !== activeSectionKey) {
      activeSectionKey = section.key;
      items.push({
        type: 'section',
        key: `section:${section.key}`,
        label: section.label,
      });
    }
    items.push({
      type: 'conversation',
      key: `conversation:${Number.isFinite(id) && id > 0 ? id : items.length}`,
      conversation,
    });
  }

  return items;
}
