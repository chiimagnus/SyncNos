import { storageGet, storageRemove, storageSet } from '@services/shared/storage';

export const INPAGE_DISPLAY_MODE_STORAGE_KEY = 'inpage_display_mode';

export type InpageDisplayMode = 'supported' | 'all' | 'off';

export function normalizeInpageDisplayMode(value: unknown): InpageDisplayMode | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'supported' || raw === 'all' || raw === 'off') return raw as InpageDisplayMode;
  return null;
}

export function canonicalizeInpageDisplayModeStorageRecord(record: unknown): Record<string, unknown> {
  const input = record && typeof record === 'object' ? (record as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...input };
  const canonical = normalizeInpageDisplayMode(input[INPAGE_DISPLAY_MODE_STORAGE_KEY]);
  if (canonical) out[INPAGE_DISPLAY_MODE_STORAGE_KEY] = canonical;
  else delete out[INPAGE_DISPLAY_MODE_STORAGE_KEY];
  return out;
}

export async function readEffectiveInpageDisplayMode(): Promise<InpageDisplayMode> {
  const local = await storageGet([INPAGE_DISPLAY_MODE_STORAGE_KEY]);
  return normalizeInpageDisplayMode(local[INPAGE_DISPLAY_MODE_STORAGE_KEY]) || 'all';
}

let mutationTail: Promise<void> = Promise.resolve();

function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(task);
  mutationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function setCanonicalInpageDisplayMode(mode: unknown): Promise<InpageDisplayMode> {
  const normalized = normalizeInpageDisplayMode(mode);
  if (!normalized) return Promise.reject(new Error('invalid inpage display mode'));
  return enqueueMutation(async () => {
    await storageSet({ [INPAGE_DISPLAY_MODE_STORAGE_KEY]: normalized });
    return normalized;
  });
}

export function ensureCanonicalInpageDisplayMode(): Promise<InpageDisplayMode> {
  return enqueueMutation(async () => {
    const local = await storageGet([INPAGE_DISPLAY_MODE_STORAGE_KEY]);
    const canonical = normalizeInpageDisplayMode(local[INPAGE_DISPLAY_MODE_STORAGE_KEY]);
    if (canonical) return canonical;
    if (Object.prototype.hasOwnProperty.call(local, INPAGE_DISPLAY_MODE_STORAGE_KEY)) {
      try {
        await storageRemove([INPAGE_DISPLAY_MODE_STORAGE_KEY]);
      } catch (_error) {
        // Invalid residue is non-authoritative; runtime default remains `all`.
      }
    }
    return 'all';
  });
}
