import type normalizeApi from '@services/shared/normalize.ts';

export type CollectorEnv = {
  window: Window & typeof globalThis;
  document: Document;
  location: Location;
  normalize: typeof normalizeApi;
};

export function createCollectorEnv(input: CollectorEnv): CollectorEnv {
  return input;
}
