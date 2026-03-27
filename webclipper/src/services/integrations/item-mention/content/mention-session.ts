import {
  parseMentionTrigger,
  type MentionTriggerMatch,
} from '@services/integrations/item-mention/content/mention-trigger-parser';

export type MentionSessionState = {
  open: boolean;
  triggerStart: number;
  triggerEnd: number;
  query: string;
  highlightIndex: number;
  // When set, keep the session closed until the input text changes.
  closedText: string | null;
};

type UpdateInput = {
  text: string;
  cursor: number;
  close?: boolean;
};

function buildState(match: MentionTriggerMatch, open: boolean, previous?: MentionSessionState | null, text?: string) {
  const queryChanged = previous ? previous.query !== match.query || previous.triggerStart !== match.triggerStart : true;
  const highlightIndex = queryChanged ? 0 : Math.max(0, Number(previous?.highlightIndex || 0));
  return {
    open,
    triggerStart: match.triggerStart,
    triggerEnd: match.triggerEnd,
    query: match.query,
    highlightIndex,
    closedText: open ? null : String(text || ''),
  } satisfies MentionSessionState;
}

export function updateMentionSession(
  previous: MentionSessionState | null,
  input: UpdateInput,
): MentionSessionState | null {
  const text = String(input.text || '');
  const cursor = Number(input.cursor);
  const match = parseMentionTrigger({ text, cursor });
  if (!match) return null;

  if (input.close) {
    return buildState(match, false, previous, text);
  }

  if (previous && previous.open === false && previous.closedText === text) {
    // Keep closed if the user only navigated (cursor changes) without editing.
    return buildState(match, false, previous, text);
  }

  return buildState(match, true, previous, text);
}
