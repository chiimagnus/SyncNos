import { createAutoSaveIncrementalEngine } from '@services/conversations/content/autosave-incremental-engine.ts';

const engine = createAutoSaveIncrementalEngine();

export function prepareIncremental(snapshot: any) {
  return engine.prepare(snapshot);
}

const incrementalUpdaterApi = {
  prepareIncremental,
};

export default incrementalUpdaterApi;
