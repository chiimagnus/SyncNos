const MESSAGES_HEADING = 'SyncNos::Messages';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function yamlEscapeString(value: unknown) {
  const text = safeString(value);
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function toYaml(obj: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  const entries = obj && typeof obj === 'object' ? Object.entries(obj as any) : [];
  for (const [k, v] of entries) {
    if (v == null) continue;
    const key = safeString(k);
    if (!key) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${pad}${key}:`);
      lines.push(...toYaml(v, indent + 2));
    } else if (Array.isArray(v)) {
      lines.push(`${pad}${key}:`);
      for (const item of v) {
        if (item == null) continue;
        if (typeof item === 'object') {
          lines.push(`${pad}-`);
          lines.push(...toYaml(item, indent + 2));
        } else {
          lines.push(`${pad}- ${yamlEscapeString(String(item))}`);
        }
      }
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${pad}${key}: ${String(v)}`);
    } else {
      lines.push(`${pad}${key}: ${yamlEscapeString(String(v))}`);
    }
  }
  return lines;
}

function buildFrontmatterBlock(frontmatter: unknown) {
  const fm = frontmatter && typeof frontmatter === 'object' ? (frontmatter as any) : {};
  const lines = ['---', ...toYaml(fm, 0), '---'];
  return `${lines.join('\n')}\n\n`;
}

function normalizeRole(role: unknown) {
  const normalized = safeString(role).toLowerCase();
  if (!normalized) return 'assistant';
  return normalized;
}

function buildMessageChunk(message: any) {
  const m = message || {};
  const seq = Number.isFinite(Number(m.sequence)) ? Number(m.sequence) : 0;
  const key = safeString(m.messageKey) || '';
  const role = normalizeRole(m.role);
  const body = safeString(m.contentMarkdown) || safeString(m.contentText) || '';
  const header = `#### ${seq} ${role} ${key}`.trim();
  return `${header}\n\n${body}\n\n`;
}

function buildMessagesMarkdown(messages: any[]) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m) => buildMessageChunk(m)).join('');
}

function buildFullNoteMarkdown({
  conversation,
  messages,
  syncnosObject,
}: {
  conversation?: any;
  messages?: any[];
  syncnosObject?: any;
}) {
  const c = conversation || {};
  const title = safeString(c.title) || 'Untitled';
  const url = safeString(c.url);
  const source = safeString(c.source);
  const conversationKey = safeString(c.conversationKey);
  const sourceType = safeString(c.sourceType);

  const frontmatter = {
    title,
    source,
    sourceType,
    conversationKey,
    syncnos: syncnosObject || null,
  };

  const headerLines = [`# ${title}`];
  if (url) headerLines.push(`Source URL: ${url}`);

  const messagesMd = buildMessagesMarkdown(messages || []);
  return (
    buildFrontmatterBlock(frontmatter) +
    `${headerLines.join('\n')}\n\n` +
    `## ${MESSAGES_HEADING}\n\n` +
    messagesMd
  );
}

function buildIncrementalAppendMarkdown({ newMessages }: { newMessages?: any[] }) {
  return buildMessagesMarkdown(newMessages || []);
}

async function appendUnderMessagesHeading({
  client,
  filePath,
  markdown,
}: {
  client: any;
  filePath: string;
  markdown: string;
}) {
  return client.patchVaultFile(filePath, {
    operation: 'append',
    targetType: 'heading',
    target: MESSAGES_HEADING,
    createTargetIfMissing: true,
    body: String(markdown || ''),
    contentType: 'text/markdown',
  });
}

async function replaceSyncnosFrontmatter({
  client,
  filePath,
  syncnosObject,
}: {
  client: any;
  filePath: string;
  syncnosObject: any;
}) {
  return client.patchVaultFile(filePath, {
    operation: 'replace',
    targetType: 'frontmatter',
    target: 'syncnos',
    createTargetIfMissing: true,
    body: JSON.stringify(syncnosObject || {}),
    contentType: 'application/json',
  });
}

const api = {
  MESSAGES_HEADING,
  buildFullNoteMarkdown,
  buildIncrementalAppendMarkdown,
  appendUnderMessagesHeading,
  replaceSyncnosFrontmatter,
};

export {
  MESSAGES_HEADING,
  buildFullNoteMarkdown,
  buildIncrementalAppendMarkdown,
  appendUnderMessagesHeading,
  replaceSyncnosFrontmatter,
};
export default api;
