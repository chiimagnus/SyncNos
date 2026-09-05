import { fetchFeishuJson } from '@services/sync/feishu/feishu-api';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

export type FeishuDocxConvertContentType = 'markdown' | 'html';

export type FeishuDocxConvertResult = {
  blocks: any[];
  firstLevelBlockIds: string[];
};

function readBlockId(block: any): string {
  if (!block || typeof block !== 'object') return '';
  return safeString((block as any).block_id ?? (block as any).blockId ?? (block as any).id);
}

function readChildrenIds(block: any): string[] {
  if (!block || typeof block !== 'object') return [];
  const raw = (block as any).children ?? (block as any).children_id ?? (block as any).childrenIds;
  const list = Array.isArray(raw) ? raw : [];
  return Array.from(new Set(list.map((id: any) => safeString(id)).filter(Boolean)));
}

/**
 * Convert API may return `blocks` in an order that is not a valid pre-order traversal.
 * For descendant insertion, we prefer emitting blocks in a parent-before-children order.
 */
export function normalizeConvertedBlocksPreorder(input: FeishuDocxConvertResult): FeishuDocxConvertResult {
  const blocks = Array.isArray(input?.blocks) ? input.blocks : [];
  const firstLevelBlockIds = Array.isArray(input?.firstLevelBlockIds) ? input.firstLevelBlockIds : [];
  if (!blocks.length) return { blocks: [], firstLevelBlockIds: [] };

  const idToBlock = new Map<string, any>();
  for (const block of blocks) {
    const id = readBlockId(block);
    if (!id) continue;
    if (!idToBlock.has(id)) idToBlock.set(id, block);
  }

  const roots = Array.from(new Set(firstLevelBlockIds.map((id) => safeString(id)).filter(Boolean)));
  const visited = new Set<string>();
  const ordered: any[] = [];

  const visit = (id: string) => {
    if (!id || visited.has(id)) return;
    const block = idToBlock.get(id);
    if (!block) return;
    visited.add(id);
    ordered.push(block);
    for (const childId of readChildrenIds(block)) visit(childId);
  };

  for (const rootId of roots) visit(rootId);

  // Append any unreachable blocks to preserve content best-effort.
  for (const block of blocks) {
    const id = readBlockId(block);
    if (id && visited.has(id)) continue;
    ordered.push(block);
    if (id) visited.add(id);
  }

  return { blocks: ordered, firstLevelBlockIds: roots };
}

export async function convertContentToBlocks({
  accessToken,
  content,
  contentType,
}: {
  accessToken: string;
  content: string;
  contentType: FeishuDocxConvertContentType;
}): Promise<FeishuDocxConvertResult> {
  const payload = {
    content: String(content || ''),
    content_type: contentType,
  };

  const data: any = await fetchFeishuJson(
    '/docx/v1/documents/blocks/convert',
    { method: 'POST', body: JSON.stringify(payload) },
    { accessToken },
  );

  const blocks = Array.isArray(data?.blocks)
    ? data.blocks
    : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.data?.blocks)
        ? data.data.blocks
        : [];

  const firstLevelBlockIdsRaw: any[] =
    (Array.isArray(data?.first_level_block_ids) ? (data.first_level_block_ids as any[]) : null) ||
    (Array.isArray(data?.firstLevelBlockIds) ? (data.firstLevelBlockIds as any[]) : null) ||
    (Array.isArray(data?.data?.first_level_block_ids) ? (data.data.first_level_block_ids as any[]) : null) ||
    [];

  const firstLevelBlockIds = Array.from(
    new Set(firstLevelBlockIdsRaw.map((id: any) => safeString(id)).filter(Boolean)),
  );

  if (!blocks.length) throw new Error('Feishu Convert API: empty blocks response');
  return { blocks, firstLevelBlockIds };
}
