import { storageGet, storageRemove, storageSet } from '@services/shared/storage';

export const INPAGE_DISPLAY_MODE_STORAGE_KEY = 'inpage_display_mode';
const LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY = 'inpage_supported_only';

export type InpageDisplayMode = 'supported' | 'all' | 'off';

export function normalizeInpageDisplayMode(value: unknown): InpageDisplayMode | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'supported' || raw === 'all' || raw === 'off') return raw as InpageDisplayMode;
  return null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function modeFromLegacySupportedOnly(value: unknown): InpageDisplayMode {
  return value === true ? 'supported' : 'all';
}

export function canonicalizeInpageDisplayModeStorageRecord(record: unknown): Record<string, unknown> {
  const input = record && typeof record === 'object' ? (record as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...input };
  const canonical = normalizeInpageDisplayMode(input[INPAGE_DISPLAY_MODE_STORAGE_KEY]);
  const hasLegacy = hasOwn(input, LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY);

  delete out[LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY];
  if (canonical) {
    out[INPAGE_DISPLAY_MODE_STORAGE_KEY] = canonical;
    return out;
  }
  if (hasLegacy) {
    out[INPAGE_DISPLAY_MODE_STORAGE_KEY] = modeFromLegacySupportedOnly(input[LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY]);
    return out;
  }
  delete out[INPAGE_DISPLAY_MODE_STORAGE_KEY];
  return out;
}

export async function readEffectiveInpageDisplayMode(): Promise<InpageDisplayMode> {
  const local = await storageGet([INPAGE_DISPLAY_MODE_STORAGE_KEY, LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY]);
  const canonicalized = canonicalizeInpageDisplayModeStorageRecord(local);
  return normalizeInpageDisplayMode(canonicalized[INPAGE_DISPLAY_MODE_STORAGE_KEY]) || 'all';
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
    try {
      await storageRemove([LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY]);
    } catch (_error) {
      // Canonical write already succeeded; stale legacy residue is cleaned by the next owner operation.
    }
    return normalized;
  });
}

export function ensureCanonicalInpageDisplayMode(): Promise<InpageDisplayMode> {
  return enqueueMutation(async () => {
    const local = await storageGet([INPAGE_DISPLAY_MODE_STORAGE_KEY, LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY]);
    const canonical = normalizeInpageDisplayMode(local[INPAGE_DISPLAY_MODE_STORAGE_KEY]);
    const hasCanonical = hasOwn(local, INPAGE_DISPLAY_MODE_STORAGE_KEY);
    const hasLegacy = hasOwn(local, LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY);

    if (canonical) {
      if (hasLegacy) {
        try {
          await storageRemove([LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY]);
        } catch (_error) {
          // Best-effort residue cleanup; canonical is already authoritative.
        }
      }
      return canonical;
    }

    if (hasLegacy) {
      const migrated = modeFromLegacySupportedOnly(local[LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY]);
      await storageSet({ [INPAGE_DISPLAY_MODE_STORAGE_KEY]: migrated });
      try {
        await storageRemove([LEGACY_INPAGE_SUPPORTED_ONLY_STORAGE_KEY]);
      } catch (_error) {
        // Best-effort residue cleanup after a successful canonical write.
      }
      return migrated;
    }

    if (hasCanonical) {
      try {
        await storageRemove([INPAGE_DISPLAY_MODE_STORAGE_KEY]);
      } catch (_error) {
        // Invalid residue is non-authoritative; runtime default remains `all`.
      }
    }
    return 'all';
  });
}
