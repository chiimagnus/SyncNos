import type { NotionServices } from '@services/sync/notion/notion-services';
import {
  buildToggleHeadingBlock,
  findHeadingBlocksByTitle,
  isToggleHeadingBlock,
  listBlockChildren,
  retrieveBlock,
  archiveBlock,
} from '@services/sync/notion/notion-section-blocks.ts';

type ToggleHeadingLevel = 1 | 2 | 3;
type NotionAppendService = Pick<NotionServices['syncService'], 'appendChildren'>;
type NotionMappingStorage = Pick<NotionServices['storage'], 'patchSyncMapping'>;

type NotionManagedSectionSpec = {
  id: string;
  title: string;
  level: ToggleHeadingLevel;
};

type NotionManagedLayoutSpec = {
  sections: NotionManagedSectionSpec[];
};

type NotionSectionAnchors = Record<string, { headingBlockId?: string }>;

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function getNotionSectionAnchorsFromMapping(mapping: unknown): NotionSectionAnchors {
  const m = mapping && typeof mapping === 'object' ? (mapping as any) : {};
  const raw = m.notionSections && typeof m.notionSections === 'object' ? (m.notionSections as any) : {};
  const out: NotionSectionAnchors = {};
  for (const [key, value] of Object.entries(raw)) {
    const sectionId = safeString(key);
    if (!sectionId) continue;
    const headingBlockId = safeString((value as any)?.headingBlockId);
    out[sectionId] = headingBlockId ? { headingBlockId } : {};
  }
  return out;
}

export function layoutSpecForConversationKind(kindId: string): NotionManagedLayoutSpec {
  const id = kindId.trim().toLowerCase();
  if (id === 'article') {
    return {
      sections: [
        { id: 'article', title: 'Article', level: 2 },
        { id: 'comments', title: 'Comments', level: 2 },
      ],
    };
  }
  if (id === 'video') {
    return {
      sections: [{ id: 'conversations', title: 'Transcript', level: 2 }],
    };
  }
  return {
    sections: [{ id: 'conversations', title: 'Conversations', level: 2 }],
  };
}

async function findToggleHeadingBlockId(accessToken: string, pageId: string, title: string): Promise<string> {
  const candidates = findHeadingBlocksByTitle(await listBlockChildren(accessToken, pageId), title);
  const directId = safeString(candidates.find(isToggleHeadingBlock)?.id);
  if (directId) return directId;

  for (const candidate of candidates) {
    const candidateId = safeString(candidate?.id);
    if (!candidateId) continue;
    const full = await retrieveBlock(accessToken, candidateId);
    if (isToggleHeadingBlock(full)) return candidateId;
  }
  return '';
}

async function persistHeadingIdToMapping(
  storage: NotionMappingStorage,
  conversationId: number,
  sectionId: string,
  headingBlockId: string,
): Promise<void> {
  await storage.patchSyncMapping(conversationId, {
    notionSections: { [sectionId]: { headingBlockId } },
  });
}

export async function ensureSectionHeadingBlockId(input: {
  accessToken: string;
  pageId: string;
  section: NotionManagedSectionSpec;
  mapping: any | null | undefined;
  notionSyncService: NotionAppendService;
  storage: NotionMappingStorage;
  conversationId: number;
}): Promise<{ headingBlockId: string; discoveredBy: 'mapping' | 'scan' | 'created' }> {
  const sectionId = safeString(input.section.id);
  const title = safeString(input.section.title);
  if (!sectionId || !title) throw new Error('invalid section spec');

  const anchors = getNotionSectionAnchorsFromMapping(input.mapping);
  const fromMapping = safeString(anchors[sectionId]?.headingBlockId);
  if (fromMapping) return { headingBlockId: fromMapping, discoveredBy: 'mapping' };

  const foundId = await findToggleHeadingBlockId(input.accessToken, input.pageId, title);
  if (foundId) {
    await persistHeadingIdToMapping(input.storage, input.conversationId, sectionId, foundId);
    return { headingBlockId: foundId, discoveredBy: 'scan' };
  }

  const appended = await input.notionSyncService.appendChildren(input.accessToken, input.pageId, [
    buildToggleHeadingBlock(title, input.section.level),
  ]);
  const createdId = safeString(appended.results[0]?.id);
  if (!createdId) throw new Error('failed to create section heading');
  await persistHeadingIdToMapping(input.storage, input.conversationId, sectionId, createdId);
  return { headingBlockId: createdId, discoveredBy: 'created' };
}

export async function rebuildSectionByArchivingHeading(input: {
  accessToken: string;
  pageId: string;
  section: NotionManagedSectionSpec;
  currentHeadingBlockId: string;
  desiredBlocks: any[];
  notionSyncService: NotionAppendService;
}): Promise<{ headingBlockId: string }> {
  const currentId = safeString(input.currentHeadingBlockId);
  if (currentId) await archiveBlock(input.accessToken, currentId);

  const headingRes = await input.notionSyncService.appendChildren(input.accessToken, input.pageId, [
    buildToggleHeadingBlock(input.section.title, input.section.level),
  ]);
  const headingBlockId = safeString(headingRes.results[0]?.id);
  if (!headingBlockId) throw new Error('failed to recreate section heading');
  if (input.desiredBlocks.length) {
    await input.notionSyncService.appendChildren(input.accessToken, headingBlockId, input.desiredBlocks);
  }
  return { headingBlockId };
}
