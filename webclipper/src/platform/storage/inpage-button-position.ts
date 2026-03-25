import { storageGet, storageSet } from '@platform/storage/local.ts';

export type InpageButtonPositionEdge = 'left' | 'right' | 'top' | 'bottom';

export type InpageButtonPositionState = {
  edge: InpageButtonPositionEdge;
  ratio: number;
};

export const INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY = 'webclipper_btn_pos_inpage_global_v3';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number) {
  return clamp(v, 0, 1);
}

function normalizeEdge(value: unknown): InpageButtonPositionEdge | null {
  const edge = String(value || '')
    .trim()
    .toLowerCase();
  if (edge === 'left' || edge === 'right' || edge === 'top' || edge === 'bottom') return edge;
  return null;
}

function normalizeState(value: unknown): InpageButtonPositionState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as any;
  const edge = normalizeEdge(raw.edge);
  if (!edge) return null;

  const ratio = Number.isFinite(raw.ratio) ? clamp01(Number(raw.ratio)) : null;
  if (ratio == null) return null;
  return { edge, ratio };
}

export async function readInpageButtonGlobalPosition(): Promise<InpageButtonPositionState | null> {
  try {
    const res = await storageGet([INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]);
    return normalizeState(res?.[INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]);
  } catch (_e) {
    return null;
  }
}

export async function writeInpageButtonGlobalPosition(state: InpageButtonPositionState): Promise<void> {
  const normalized = normalizeState(state);
  if (!normalized) return;
  try {
    await storageSet({ [INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]: normalized });
  } catch (_e) {
    // ignore
  }
}
