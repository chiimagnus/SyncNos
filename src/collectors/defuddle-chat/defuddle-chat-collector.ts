import Defuddle from 'defuddle';
import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import { conversationKeyFromLocation } from '@collectors/collector-utils.ts';
import { htmlToMarkdownTurndown } from '@collectors/web/article-extract/markdown-turndown.ts';

type DefuddleChatSite = {
  id: 'chatgpt' | 'claude' | 'gemini' | 'grok';
  name: string;
  hosts: string[];
  path: RegExp;
};

const DEFUDDLE_CHAT_SITES: DefuddleChatSite[] = [
  { id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'www.chatgpt.com'], path: /^\/(?:c|share)\// },
  { id: 'claude', name: 'Claude', hosts: ['claude.ai'], path: /^\/(?:chat|share)\// },
  { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'], path: /^\/app\// },
  { id: 'grok', name: 'Grok', hosts: ['grok.com'], path: /^\/(?:chat|share)(?:\/|$)/ },
];

type DefuddleResult = {
  title?: unknown;
  content?: unknown;
};

type PreparedCapture = {
  href: string;
  conversationKey: string;
};

function normalizeHost(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isSiteMatch(site: DefuddleChatSite, location: { hostname?: string; pathname?: string }) {
  return site.hosts.includes(normalizeHost(location.hostname)) && site.path.test(String(location.pathname || ''));
}

function findAuthorMarker(nodes: Node[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.tagName.toLowerCase() !== 'p') return null;
    const children = Array.from(element.children || []);
    if (children.length !== 1 || children[0].tagName.toLowerCase() !== 'strong') return null;
    return { author: String(element.textContent || '').trim(), index };
  }
  return null;
}

function roleFromDefuddleAuthor(author: string, site: DefuddleChatSite) {
  return author.toLowerCase().includes(site.name.toLowerCase()) ? 'assistant' : 'user';
}

function splitDefuddleConversation(content: unknown, site: DefuddleChatSite, env: CollectorEnv, baseHref: string) {
  const wrapper = env.document.createElement('div');
  wrapper.innerHTML = String(content || '');
  const root = wrapper.querySelector('article') || wrapper;
  const groups: Node[][] = [];
  let group: Node[] = [];

  for (const node of Array.from(root.childNodes || [])) {
    const isDivider = node.nodeType === 1 && String((node as Element).tagName || '').toLowerCase() === 'hr';
    if (isDivider) {
      if (group.length) groups.push(group);
      group = [];
      continue;
    }
    group.push(node);
  }
  if (group.length) groups.push(group);

  const duplicateCounts = new Map<string, number>();
  const messages: any[] = [];
  for (const nodes of groups) {
    const marker = findAuthorMarker(nodes);
    if (!marker?.author) continue;

    const contentHolder = env.document.createElement('div');
    for (const node of nodes.slice(marker.index + 1)) contentHolder.appendChild(node.cloneNode(true));
    const contentHTML = String(contentHolder.innerHTML || '').trim();
    const contentText = env.normalize.normalizeText(contentHolder.textContent || '');
    if (!contentHTML || !contentText) continue;

    const role = roleFromDefuddleAuthor(marker.author, site);
    const duplicateKey = `${role}|${contentText}`;
    const duplicateIndex = duplicateCounts.get(duplicateKey) || 0;
    duplicateCounts.set(duplicateKey, duplicateIndex + 1);
    const messageKey = `defuddle_${env.normalize.fnv1a32(`${site.id}|${duplicateKey}|${duplicateIndex}`)}`;
    messages.push({
      messageKey,
      role,
      contentText,
      contentMarkdown: htmlToMarkdownTurndown(contentHTML, baseHref, env.document) || contentText,
      sequence: messages.length,
      updatedAt: Date.now(),
    });
  }
  return messages;
}

function createPreparedCapture(env: CollectorEnv): PreparedCapture | null {
  const href = String(env.location.href || '');
  const conversationKey = conversationKeyFromLocation(env.location);
  if (!href || !conversationKey) return null;
  return { href, conversationKey };
}

function createDefuddleChatCollectorDef(env: CollectorEnv, site: DefuddleChatSite): CollectorDefinition {
  const matches = (location: { hostname?: string; pathname?: string }) => isSiteMatch(site, location);
  const prepareManualCapture = () => createPreparedCapture(env);

  function capture(options: any = {}) {
    if (!matches(env.location)) return null;
    const preparedCapture = options?.preparedCapture as PreparedCapture | null | undefined;
    if (site.id === 'chatgpt' && (!preparedCapture || preparedCapture.href !== env.location.href)) return null;

    try {
      const cloned = env.document.cloneNode(true) as Document;
      const parsed = new Defuddle(cloned, {
        url: env.location.href,
        markdown: false,
        separateMarkdown: false,
        useAsync: false,
        includeReplies: 'extractors',
      }).parse() as DefuddleResult;
      const messages = splitDefuddleConversation(parsed.content, site, env, env.location.href);
      if (!messages.length) return null;

      const conversationKey = conversationKeyFromLocation(env.location);
      if (!conversationKey) return null;
      const title =
        env.normalize.normalizeText(parsed.title || '') || messages[0].contentText.slice(0, 56) || site.name;
      return {
        conversation: {
          sourceType: 'chat',
          source: site.id,
          conversationKey,
          title,
          url: env.location.href,
          warningFlags: ['defuddle_visible_dom_only'],
          lastCapturedAt: Date.now(),
        },
        messages,
        captureMeta: {
          completeness: 'partial',
          identityVerified: site.id !== 'chatgpt' || preparedCapture?.conversationKey === conversationKey,
          reasons: ['defuddle_visible_dom_only'],
        },
      };
    } catch (_error) {
      return null;
    }
  }

  return { id: site.id, matches, collector: { capture, prepareManualCapture } };
}

export function createDefuddleChatCollectorDefs(env: CollectorEnv) {
  return DEFUDDLE_CHAT_SITES.map((site) => createDefuddleChatCollectorDef(env, site));
}
