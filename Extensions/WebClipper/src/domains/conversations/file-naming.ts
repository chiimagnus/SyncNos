import { sanitizeFilenamePart } from './markdown';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

export function aiTagForSource(source: unknown): string {
  return safeString(source) || 'unknown';
}

export function fnv1a64Hex(input: unknown) {
  const value = safeString(input);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function stableConversationHash16(conversation: any): string {
  const c = conversation || {};
  const source = safeString(c.source) || 'unknown';
  const conversationKey = safeString(c.conversationKey) || 'unknown';
  return fnv1a64Hex(`${source}:${conversationKey}`);
}

export function stableConversationId10(conversation: any): string {
  return stableConversationHash16(conversation).slice(0, 10);
}

export function buildConversationBasename(conversation: any): string {
  const c = conversation || {};
  const ai = sanitizeFilenamePart(aiTagForSource(c.source), 'unknown', 24);
  const title = sanitizeFilenamePart(c.title || 'Untitled', 'Untitled', 80);
  const id = stableConversationId10(c);
  return `${ai}-${title}-${id}`;
}
