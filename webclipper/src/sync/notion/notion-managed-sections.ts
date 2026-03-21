import { buildToggleHeadingBlock, findToggleHeadingBlock, listBlockChildren, archiveBlock } from './notion-section-blocks.ts';

type ToggleHeadingLevel = 1 | 2 | 3;

export type NotionManagedSectionSpec = {
  id: string;
  title: string;
  level: ToggleHeadingLevel;
};

export type NotionManagedLayoutSpec = {
  schemaVersion: 1;
  sections: NotionManagedSectionSpec[];
};

export type NotionSectionAnchors = Record<string, { headingBlockId?: string }>;

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

export function getNotionSectionAnchorsFromMapping(mapping: unknown): NotionSectionAnchors {
  const m = mapping && typeof mapping === 'object' ? (mapping as any) : {};
  const raw = m.notionSections && typeof m.notionSections === 'object' ? (m.notionSections as any) : {};
  const out: NotionSectionAnchors = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const sectionId = safeString(key);
    if (!sectionId) continue;
    const headingBlockId = safeString((value as any)?.headingBlockId);
    out[sectionId] = headingBlockId ? { headingBlockId } : {};
  }
  return out;
}

export function mergeNotionSectionAnchorsPatch(
  prevAnchors: NotionSectionAnchors,
  patch: { sectionId: string; headingBlockId: string },
): { notionSections: NotionSectionAnchors } {
  const next: NotionSectionAnchors = { ...(prevAnchors || {}) };
  const sectionId = safeString(patch?.sectionId);
  const headingBlockId = safeString(patch?.headingBlockId);
  if (sectionId) next[sectionId] = { headingBlockId };
  return { notionSections: next };
}

export function layoutSpecForConversationKind(kindId: string): NotionManagedLayoutSpec {
  const id = safeString(kindId).toLowerCase();
  if (id === 'article') {
    return {
      schemaVersion: 1,
      sections: [
        { id: 'article', title: 'Article', level: 2 },
        { id: 'comments', title: 'Comments', level: 2 },
      ],
    };
  }
  return {
    schemaVersion: 1,
    sections: [{ id: 'conversations', title: 'Conversations', level: 2 }],
  };
}

export async function ensureSectionHeadingBlockId(input: {
  accessToken: string;
  pageId: string;
  section: NotionManagedSectionSpec;
  mapping: any | null | undefined;
  notionSyncService: { appendChildren: (accessToken: string, blockId: string, blocks: any[]) => Promise<any> };
  storage?: { patchSyncMapping?: (conversationId: number, patch: Record<string, unknown>) => Promise<any> };
  conversationId?: number;
}): Promise<{ headingBlockId: string; discoveredBy: 'mapping' | 'scan' | 'created' }> {
  const sectionId = safeString(input?.section?.id);
  const title = safeString(input?.section?.title);
  const level = input?.section?.level || 2;
  if (!sectionId || !title) throw new Error('invalid section spec');

  const anchors = getNotionSectionAnchorsFromMapping(input?.mapping);
  const fromMapping = safeString(anchors?.[sectionId]?.headingBlockId);
  if (fromMapping) return { headingBlockId: fromMapping, discoveredBy: 'mapping' };

  const children = await listBlockChildren(input.accessToken, input.pageId);
  const found = findToggleHeadingBlock(children, title);
  const foundId = safeString(found?.id);
  if (foundId) {
    await maybePersistHeadingIdToMapping(input, anchors, sectionId, foundId);
    return { headingBlockId: foundId, discoveredBy: 'scan' };
  }

  const appended = await input.notionSyncService.appendChildren(input.accessToken, input.pageId, [
    buildToggleHeadingBlock(title, level),
  ]);
  const results = Array.isArray((appended as any)?.results) ? (appended as any).results : [];
  const createdId = safeString(results?.[0]?.id);
  if (!createdId) throw new Error('failed to create section heading');
  await maybePersistHeadingIdToMapping(input, anchors, sectionId, createdId);
  return { headingBlockId: createdId, discoveredBy: 'created' };
}

async function maybePersistHeadingIdToMapping(
  input: {
    storage?: { patchSyncMapping?: (conversationId: number, patch: Record<string, unknown>) => Promise<any> };
    conversationId?: number;
  },
  anchors: NotionSectionAnchors,
  sectionId: string,
  headingBlockId: string,
): Promise<void> {
  const conversationId = Number(input?.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) return;
  if (!input?.storage?.patchSyncMapping) return;
  const patch = mergeNotionSectionAnchorsPatch(anchors, { sectionId, headingBlockId });
  await input.storage.patchSyncMapping(conversationId, patch as any);
}

export async function rebuildSectionByArchivingHeading(input: {
  accessToken: string;
  pageId: string;
  section: NotionManagedSectionSpec;
  currentHeadingBlockId: string;
  desiredBlocks: any[];
  notionSyncService: { appendChildren: (accessToken: string, blockId: string, blocks: any[]) => Promise<any> };
}): Promise<{ headingBlockId: string }> {
  const currentId = safeString(input?.currentHeadingBlockId);
  if (currentId) {
    await archiveBlock(input.accessToken, currentId);
  }
  const heading = buildToggleHeadingBlock(input.section.title, input.section.level);
  const headingRes = await input.notionSyncService.appendChildren(input.accessToken, input.pageId, [heading]);
  const created = Array.isArray((headingRes as any)?.results) ? (headingRes as any).results : [];
  const headingBlockId = safeString(created?.[0]?.id);
  if (!headingBlockId) throw new Error('failed to recreate section heading');
  const blocks = Array.isArray(input.desiredBlocks) ? input.desiredBlocks : [];
  if (blocks.length) {
    await input.notionSyncService.appendChildren(input.accessToken, headingBlockId, blocks);
  }
  return { headingBlockId };
}

export async function recoverSectionHeadingBlockId(input: {
  accessToken: string;
  pageId: string;
  section: NotionManagedSectionSpec;
  notionSyncService: { appendChildren: (accessToken: string, blockId: string, blocks: any[]) => Promise<any> };
}): Promise<string> {
  const title = safeString(input?.section?.title);
  if (!title) throw new Error('invalid section spec');
  const children = await listBlockChildren(input.accessToken, input.pageId);
  const found = findToggleHeadingBlock(children, title);
  const foundId = safeString(found?.id);
  if (foundId) return foundId;
  const appended = await input.notionSyncService.appendChildren(input.accessToken, input.pageId, [
    buildToggleHeadingBlock(title, input.section.level),
  ]);
  const results = Array.isArray((appended as any)?.results) ? (appended as any).results : [];
  const createdId = safeString(results?.[0]?.id);
  if (!createdId) throw new Error('failed to create section heading');
  return createdId;
}
