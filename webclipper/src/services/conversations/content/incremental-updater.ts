import { createAutoSaveIncrementalEngine } from '@services/conversations/content/autosave-incremental-engine.ts';

const engine = createAutoSaveIncrementalEngine();

export function computeIncremental(snapshot: any) {
  return engine.compute(snapshot);
}

export function __resetForTests() {
  engine.reset();
}

const incrementalUpdaterApi = {
  computeIncremental,
  __resetForTests,
};

export default incrementalUpdaterApi;
