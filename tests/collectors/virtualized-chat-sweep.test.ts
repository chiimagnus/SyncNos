import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import {
  addPreparedReason,
  createPreparedAccumulator,
  createPreparedCaptureConsumer,
  readPreparedCapture,
  createScrollRootRestorer,
  finishPreparedCapture,
  mergePreparedRecords,
  runVirtualizedPass,
  runVirtualizedSweep,
  isAtScrollBottom,
  isAtScrollTop,
  readScrollMetrics,
  resolveScrollRoot,
  writeScrollPosition,
} from '../../src/collectors/virtualized-chat/virtualized-chat-sweep.ts';

function setMetric(element: Element, name: string, value: number) {
  Object.defineProperty(element, name, { configurable: true, value, writable: true });
}

function makeNestedRoot() {
  const dom = new JSDOM('<body><div id="scroll"><main id="seed"></main></div></body>');
  const root = dom.window.document.querySelector('#scroll') as HTMLElement;
  const seed = dom.window.document.querySelector('#seed') as HTMLElement;
  root.style.overflowY = 'auto';
  setMetric(root, 'clientHeight', 100);
  setMetric(root, 'scrollHeight', 500);
  setMetric(root, 'clientWidth', 80);
  setMetric(root, 'scrollWidth', 300);
  root.scrollTop = 120;
  root.scrollLeft = 40;
  return { dom, root, seed };
}

describe('virtualized chat scroll root', () => {
  it('resolves and restores a nested overflow root on both axes', () => {
    const { dom, root, seed } = makeNestedRoot();
    const runtime = { document: dom.window.document, window: dom.window as any };
    expect(resolveScrollRoot(runtime, seed)).toBe(root);
    const restorer = createScrollRootRestorer({ ...runtime, getSeed: () => seed, sampleIdentity: () => 'chat-a' });
    root.scrollTop = 350;
    root.scrollLeft = 200;
    expect(restorer.restore()).toEqual({ restored: true, reason: 'restored' });
    expect(root.scrollTop).toBe(120);
    expect(root.scrollLeft).toBe(40);
    root.scrollTop = 300;
    expect(restorer.restore()).toEqual({ restored: false, reason: 'restore_failed' });
    expect(root.scrollTop).toBe(300);
  });

  it('clamps restore after the scroll extent shrinks', () => {
    const { dom, root, seed } = makeNestedRoot();
    const runtime = { document: dom.window.document, window: dom.window as any };
    root.scrollTop = 380;
    const restorer = createScrollRootRestorer({ ...runtime, getSeed: () => seed, sampleIdentity: () => 'chat-a' });
    setMetric(root, 'scrollHeight', 180);
    root.scrollTop = 0;
    expect(restorer.restore().restored).toBe(true);
    expect(root.scrollTop).toBe(80);
  });

  it('skips restore for detached, replaced, or identity-changed roots', () => {
    const first = makeNestedRoot();
    const runtime = { document: first.dom.window.document, window: first.dom.window as any };
    let identity = 'chat-a';
    const restorer = createScrollRootRestorer({
      ...runtime,
      getSeed: () => first.seed,
      sampleIdentity: () => identity,
    });
    identity = 'chat-b';
    expect(restorer.restore()).toEqual({ restored: false, reason: 'identity_changed' });

    const second = makeNestedRoot();
    const detached = createScrollRootRestorer({
      document: second.dom.window.document,
      window: second.dom.window as any,
      getSeed: () => second.seed,
      sampleIdentity: () => 'chat-a',
    });
    second.root.remove();
    expect(detached.restore()).toEqual({ restored: false, reason: 'root_detached' });
  });

  it('uses the document scroller fallback without moving an inner element', () => {
    const dom = new JSDOM('<body><main id="seed"></main></body>');
    const root = dom.window.document.documentElement;
    setMetric(root, 'clientHeight', 100);
    setMetric(root, 'scrollHeight', 500);
    setMetric(root, 'clientWidth', 100);
    setMetric(root, 'scrollWidth', 100);
    const scrollTo = vi.fn();
    (dom.window as any).scrollTo = scrollTo;
    const runtime = { document: dom.window.document, window: dom.window as any };
    writeScrollPosition(runtime, root, 0, 999);
    expect(scrollTo).toHaveBeenCalledWith(0, 400);
  });

  it('reports top and bottom from normalized metrics', () => {
    const { dom, root } = makeNestedRoot();
    const metrics = readScrollMetrics({ document: dom.window.document, window: dom.window as any }, root);
    expect(isAtScrollTop({ ...metrics, top: 0 })).toBe(true);
    expect(isAtScrollBottom({ ...metrics, top: 400 })).toBe(true);
  });

  it('turns restore exceptions into a content-free result', () => {
    const dom = new JSDOM('<body><main id="seed"></main></body>');
    const seed = dom.window.document.querySelector('#seed') as HTMLElement;
    const root = dom.window.document.documentElement;
    setMetric(root, 'clientHeight', 100);
    setMetric(root, 'scrollHeight', 500);
    setMetric(root, 'clientWidth', 100);
    setMetric(root, 'scrollWidth', 100);
    (dom.window as any).scrollTo = () => {
      throw new Error('sentinel secret');
    };
    const restorer = createScrollRootRestorer({
      document: dom.window.document,
      window: dom.window as any,
      getSeed: () => seed,
      sampleIdentity: () => 'chat-a',
    });
    expect(restorer.restore()).toEqual({ restored: false, reason: 'restore_failed' });
  });
});

describe('virtualized chat prepared accumulator', () => {
  it('returns a plain prepared token and updates changed records in place', () => {
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'conversation-a',
      identityVerified: true,
    });
    expect(
      mergePreparedRecords(accumulator, [
        { key: 'm1', turnKey: 't1', withinTurn: 0, fingerprint: 'a', payload: { text: 'first' } },
      ]),
    ).toEqual({ added: 1, updated: 0 });
    expect(
      mergePreparedRecords(accumulator, [
        { key: 'm1', turnKey: 't1', withinTurn: 0, fingerprint: 'b', payload: { text: 'final' } },
      ]),
    ).toEqual({ added: 0, updated: 1 });
    const prepared = finishPreparedCapture(accumulator);
    expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared);
    expect(prepared.records[0]).toMatchObject({ firstSeenIndex: 0, payload: { text: 'final' } });
  });

  it('rejects malformed prepared tokens and consumes a valid token once', () => {
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'conversation-a',
      identityVerified: true,
      identityGuard: { route: '/c/a', durableId: 'a', anchors: ['t1'], topAnchor: 't1' },
    });
    mergePreparedRecords(accumulator, [
      { key: 'm1', turnKey: 't1', withinTurn: 0, fingerprint: 'a', payload: { text: 'A' } },
    ]);
    const prepared = finishPreparedCapture(accumulator);
    expect(readPreparedCapture({ ...prepared, records: [{ key: '' }] }, 'chatgpt')).toBeNull();
    expect(readPreparedCapture({ ...prepared, metrics: { samples: Number.NaN, messages: 1 } }, 'chatgpt')).toBeNull();

    const consume = createPreparedCaptureConsumer<{ text: string }>('chatgpt');
    expect(consume(prepared)).toBe(prepared);
    expect(consume(prepared)).toBeNull();
  });

  it('keeps concurrent prepared accumulators isolated', () => {
    const first = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'conversation-a',
      identityVerified: true,
    });
    const second = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'conversation-b',
      identityVerified: true,
    });
    mergePreparedRecords(first, [{ key: 'a', turnKey: 'ta', withinTurn: 0, fingerprint: 'a', payload: { text: 'A' } }]);
    mergePreparedRecords(second, [
      { key: 'b', turnKey: 'tb', withinTurn: 0, fingerprint: 'b', payload: { text: 'B' } },
    ]);
    expect(finishPreparedCapture(first).records.map((record) => record.key)).toEqual(['a']);
    expect(finishPreparedCapture(second).records.map((record) => record.key)).toEqual(['b']);
  });

  it('keeps arbitrary provider text out of prepared diagnostics', () => {
    const sentinel = 'PRIVATE_TITLE_URL_MESSAGE_ID_IMAGE_REF';
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'test',
      conversationKey: sentinel,
      identityVerified: true,
      identityGuard: { route: sentinel, durableId: sentinel, anchors: [sentinel], topAnchor: sentinel },
    });
    addPreparedReason(accumulator, sentinel);
    accumulator.sweepMetrics = { passes: 1, reachedTop: false };
    const prepared = finishPreparedCapture(accumulator);
    const diagnostics = JSON.stringify({ reasons: prepared.reasons, metrics: prepared.metrics });
    expect(prepared.reasons).toEqual(['invalid_reason']);
    expect(diagnostics).not.toContain(sentinel);
  });
});

describe('virtualized chat overlapping window order', () => {
  function record(key: string, fingerprint = key, text = key) {
    return { key, turnKey: key.split(':')[0], withinTurn: 0, fingerprint, payload: { text } };
  }

  it('merges prefix, suffix, and between keys around stable overlap', () => {
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'c',
      identityVerified: true,
    });
    mergePreparedRecords(accumulator, [record('b'), record('d')]);
    mergePreparedRecords(accumulator, [record('a'), record('b'), record('c'), record('d'), record('e')]);
    expect(finishPreparedCapture(accumulator).records.map((item) => item.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('refreshes a changed known key without moving its ordered position', () => {
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'c',
      identityVerified: true,
    });
    mergePreparedRecords(accumulator, [record('a'), record('b', 'old', 'draft'), record('c')]);
    expect(mergePreparedRecords(accumulator, [record('b', 'new', 'final'), record('c')])).toEqual({
      added: 0,
      updated: 1,
    });
    const prepared = finishPreparedCapture(accumulator);
    expect(prepared.records.map((item) => item.key)).toEqual(['a', 'b', 'c']);
    expect(prepared.records[1].payload.text).toBe('final');
  });

  it('marks disconnected and contradictory windows as permanently incomplete', () => {
    const disconnected = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'c',
      identityVerified: true,
    });
    mergePreparedRecords(disconnected, [record('a'), record('b')]);
    mergePreparedRecords(disconnected, [record('x'), record('y')]);
    expect(finishPreparedCapture(disconnected).reasons).toContain('order_unanchored');

    const conflicting = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'c',
      identityVerified: true,
    });
    mergePreparedRecords(conflicting, [record('a'), record('b'), record('c')]);
    mergePreparedRecords(conflicting, [record('c'), record('b')]);
    expect(finishPreparedCapture(conflicting).reasons).toContain('order_conflict');
  });

  it('preserves multiple message records inside one turn', () => {
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'c',
      identityVerified: true,
    });
    mergePreparedRecords(accumulator, [
      { ...record('turn-a:m1'), turnKey: 'turn-a', withinTurn: 0 },
      { ...record('turn-b:m1'), turnKey: 'turn-b', withinTurn: 0 },
      { ...record('turn-b:m2'), turnKey: 'turn-b', withinTurn: 1 },
    ]);
    expect(finishPreparedCapture(accumulator).records.map((item) => item.key)).toEqual([
      'turn-a:m1',
      'turn-b:m1',
      'turn-b:m2',
    ]);
  });

  it('does not update repeated unchanged windows', () => {
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'chatgpt',
      conversationKey: 'c',
      identityVerified: true,
    });
    mergePreparedRecords(accumulator, [record('a'), record('b')]);
    expect(mergePreparedRecords(accumulator, [record('a'), record('b')])).toEqual({ added: 0, updated: 0 });
  });
});

describe('virtualized chat single pass', () => {
  function harness(windows: Array<{ top: number; keys: string[] }>, options: { growAt?: number } = {}) {
    const dom = new JSDOM('<body><div id="root"><div id="seed"></div></div></body>');
    const root = dom.window.document.querySelector('#root') as HTMLElement;
    const seed = dom.window.document.querySelector('#seed') as HTMLElement;
    root.style.overflowY = 'auto';
    let top = 0;
    let scrollHeight = 300;
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = Number(value) || 0;
        if (options.growAt !== undefined && top >= options.growAt) scrollHeight = 400;
      },
    });
    const currentKeys = () => {
      let selected = windows[0]?.keys || [];
      for (const window of windows) if (top >= window.top) selected = window.keys;
      return selected.slice();
    };
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'test',
      conversationKey: 'conversation',
      identityVerified: true,
    });
    let generation = 0;
    const adapter = {
      getScrollSeed: () => seed,
      sampleIdentity: () => 'identity',
      readDescriptorKeys: currentKeys,
      harvest: async (target: typeof accumulator) => {
        generation += 1;
        const records = currentKeys().map((key, index) => ({
          key,
          turnKey: key,
          withinTurn: index,
          fingerprint: key,
          payload: { text: `${key}:${generation}` },
        }));
        return mergePreparedRecords(target, records);
      },
    };
    return { dom, root, seed, accumulator, adapter, getTop: () => top };
  }

  it('survives replacement and node recycling because each window is plain data', async () => {
    const test = harness([
      { top: 0, keys: ['a', 'b'] },
      { top: 60, keys: ['b', 'c'] },
      { top: 120, keys: ['c', 'd'] },
      { top: 180, keys: ['d', 'e'] },
    ]);
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, overlapRatio: 0.6 },
    );
    expect(result.reachedBottom).toBe(true);
    expect(finishPreparedCapture(test.accumulator).records.map((record) => record.key)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('follows dynamic height growth during a single pass', async () => {
    const test = harness(
      [
        { top: 0, keys: ['a', 'b'] },
        { top: 60, keys: ['b', 'c'] },
        { top: 120, keys: ['c', 'd'] },
        { top: 180, keys: ['d', 'e'] },
        { top: 240, keys: ['e', 'f'] },
        { top: 300, keys: ['f', 'g'] },
      ],
      { growAt: 60 },
    );
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, overlapRatio: 0.6 },
    );
    expect(result.maxScrollExtent).toBe(400);
    expect(finishPreparedCapture(test.accumulator).records.at(-1)?.key).toBe('g');
  });

  it('reduces the step to recover overlap before declaring an unanchored window', async () => {
    const test = harness([
      { top: 0, keys: ['a', 'b'] },
      { top: 30, keys: ['b', 'c'] },
      { top: 60, keys: ['c', 'd'] },
      { top: 120, keys: ['d', 'e'] },
    ]);
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, overlapRatio: 0.8, maxOverlapRecoveries: 4 },
    );
    expect(result.reasons).not.toContain('order_unanchored');
    expect(finishPreparedCapture(test.accumulator).records.map((record) => record.key)).toContain('e');
  });

  it('returns already harvested data as partial on an irrecoverable missing overlap', async () => {
    const test = harness([
      { top: 0, keys: ['a'] },
      { top: 20, keys: ['x'] },
    ]);
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, overlapRatio: 0.6, maxOverlapRecoveries: 0 },
    );
    expect(result.reasons).toContain('order_unanchored');
    expect(finishPreparedCapture(test.accumulator).records.map((record) => record.key)).toContain('a');
  });

  it('bounds a window that never stabilizes', async () => {
    const test = harness([{ top: 0, keys: ['a'] }]);
    let flip = false;
    let tick = 0;
    test.adapter.readDescriptorKeys = () => {
      flip = !flip;
      return [flip ? 'a' : 'b'];
    };
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      {
        stableSamples: 2,
        pollMs: 0,
        stepTimeoutMs: 3,
        now: () => tick++,
        sleep: async () => undefined,
      },
    );
    expect(result.reasons).toContain('step_timeout');
  });

  it('reports step budget exhaustion without discarding prior stable data', async () => {
    const test = harness([
      { top: 0, keys: ['a'] },
      { top: 60, keys: ['a', 'b'] },
    ]);
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxSteps: 1 },
    );
    expect(result.reasons).toContain('step_budget_exhausted');
    expect(finishPreparedCapture(test.accumulator).records.map((record) => record.key)).toEqual(['a']);
  });

  it('rolls back only the failing extraction window', async () => {
    const test = harness([
      { top: 0, keys: ['a'] },
      { top: 60, keys: ['a', 'b'] },
    ]);
    const harvest = test.adapter.harvest;
    let calls = 0;
    test.adapter.harvest = async (target) => {
      calls += 1;
      if (calls === 2) throw new Error('PRIVATE_CONTENT');
      return harvest(target);
    };
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, overlapRatio: 0.6 },
    );
    expect(result.reasons).toContain('extraction_error');
    expect(finishPreparedCapture(test.accumulator).records.map((record) => record.key)).toEqual(['a']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_CONTENT');
  });

  it('invalidates harvested data when identity changes during extraction', async () => {
    const test = harness([{ top: 0, keys: ['secret-message-id'] }]);
    const harvest = test.adapter.harvest;
    let identity = 'identity-a';
    test.adapter.sampleIdentity = () => identity;
    test.adapter.harvest = async (target) => {
      const harvested = await harvest(target);
      identity = 'identity-b';
      return harvested;
    };
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0 },
    );
    expect(result.reasons).toContain('identity_changed');
    expect(test.accumulator.identityVerified).toBe(false);
    expect(test.accumulator.conversationKey).toBe('');
    expect(test.accumulator.records).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('secret-message-id');
  });

  it('rolls back the current window when the scroll root detaches', async () => {
    const test = harness([{ top: 0, keys: ['a'] }]);
    const harvest = test.adapter.harvest;
    test.adapter.harvest = async (target) => {
      const harvested = await harvest(target);
      test.root.remove();
      return harvested;
    };
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0 },
    );
    expect(result.reasons).toContain('root_detached');
    expect(test.accumulator.records).toEqual([]);
  });

  it('reports a pass failure without leaking thrown descriptor content', async () => {
    const test = harness([{ top: 0, keys: ['a'] }]);
    test.adapter.readDescriptorKeys = () => {
      throw new Error('PRIVATE_URL');
    };
    const result = await runVirtualizedPass(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0 },
    );
    expect(result.reasons).toContain('pass_failed');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_URL');
  });
});

describe('virtualized chat confirmation sweep', () => {
  function singlePageAdapter(
    harvestPayloads: Array<Array<{ key: string; fingerprint: string; text: string }>>,
    unresolved: () => string[] = () => [],
  ) {
    const dom = new JSDOM('<body><div id="root"><div id="seed"></div></div></body>');
    (dom.window as any).scrollTo = vi.fn();
    const root = dom.window.document.querySelector('#root') as HTMLElement;
    const seed = dom.window.document.querySelector('#seed') as HTMLElement;
    root.style.overflowY = 'auto';
    setMetric(root, 'clientHeight', 100);
    setMetric(root, 'scrollHeight', 100);
    setMetric(root, 'clientWidth', 100);
    setMetric(root, 'scrollWidth', 100);
    root.scrollTop = 0;
    let harvestIndex = 0;
    const accumulator = createPreparedAccumulator<{ text: string }>({
      source: 'test',
      conversationKey: 'conversation',
      identityVerified: true,
    });
    const currentPayload = () => harvestPayloads[Math.min(harvestIndex, harvestPayloads.length - 1)] || [];
    const adapter = {
      getScrollSeed: () => seed,
      sampleIdentity: () => 'identity',
      readDescriptorKeys: () => currentPayload().map((item) => item.key),
      readUnresolvedKeys: unresolved,
      harvest: async (target: typeof accumulator) => {
        const payload = currentPayload();
        harvestIndex += 1;
        return mergePreparedRecords(
          target,
          payload.map((item, index) => ({
            key: item.key,
            turnKey: item.key,
            withinTurn: index,
            fingerprint: item.fingerprint,
            payload: { text: item.text },
          })),
        );
      },
    };
    return { dom, accumulator, adapter };
  }

  it('marks complete only after a no-change confirmation pass and final live sample', async () => {
    const test = singlePageAdapter([
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
    ]);
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxPasses: 4 },
    );
    expect(result).toMatchObject({ completeness: 'complete', reachedTop: true, reachedBottom: true });
    expect(result.passes).toBe(2);
  });

  it('continues when a second pass discovers a late turn', async () => {
    const test = singlePageAdapter([
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
      [
        { key: 'a', fingerprint: 'a', text: 'A' },
        { key: 'b', fingerprint: 'b', text: 'B' },
      ],
      [
        { key: 'a', fingerprint: 'a', text: 'A' },
        { key: 'b', fingerprint: 'b', text: 'B' },
      ],
      [
        { key: 'a', fingerprint: 'a', text: 'A' },
        { key: 'b', fingerprint: 'b', text: 'B' },
      ],
    ]);
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxPasses: 5 },
    );
    expect(result.completeness).toBe('complete');
    expect(finishPreparedCapture(test.accumulator).records.map((record) => record.key)).toEqual(['a', 'b']);
  });

  it('requires another confirmation after a late known-key update or final-live change', async () => {
    const test = singlePageAdapter([
      [{ key: 'a', fingerprint: 'draft', text: 'draft' }],
      [{ key: 'a', fingerprint: 'final', text: 'final' }],
      [{ key: 'a', fingerprint: 'final', text: 'final' }],
      [
        { key: 'a', fingerprint: 'final', text: 'final' },
        { key: 'b', fingerprint: 'late', text: 'late' },
      ],
      [
        { key: 'a', fingerprint: 'final', text: 'final' },
        { key: 'b', fingerprint: 'late', text: 'late' },
      ],
      [
        { key: 'a', fingerprint: 'final', text: 'final' },
        { key: 'b', fingerprint: 'late', text: 'late' },
      ],
    ]);
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxPasses: 6 },
    );
    expect(result.completeness).toBe('complete');
    expect(finishPreparedCapture(test.accumulator).records.map((record) => record.payload.text)).toEqual([
      'final',
      'late',
    ]);
  });

  it('clears an unresolved turn when a message from that turn is harvested later', async () => {
    let phase = 0;
    const test = singlePageAdapter(
      [
        [],
        [{ key: 'message-a', fingerprint: 'a', text: 'A' }],
        [{ key: 'message-a', fingerprint: 'a', text: 'A' }],
        [{ key: 'message-a', fingerprint: 'a', text: 'A' }],
      ],
      () => (phase++ === 0 ? ['turn-a'] : []),
    );
    const originalHarvest = test.adapter.harvest;
    test.adapter.harvest = async (target) => {
      const result = await originalHarvest(target);
      for (const record of target.records) record.turnKey = 'turn-a';
      return result;
    };
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxPasses: 4 },
    );
    expect(result.completeness).toBe('complete');
    expect(result.reasons).not.toContain('unresolved_turn');
  });

  it('keeps unresolved expected turns and pass exhaustion partial', async () => {
    const test = singlePageAdapter([[{ key: 'a', fingerprint: 'a', text: 'A' }]], () => ['unresolved-shell']);
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxPasses: 2 },
    );
    expect(result.completeness).toBe('partial');
    expect(result.reasons).toEqual(expect.arrayContaining(['unresolved_turn', 'pass_budget_exhausted']));
  });

  it('keeps sanitized provider errors incomplete', async () => {
    const test = singlePageAdapter([
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
    ]);
    const harvest = test.adapter.harvest;
    test.adapter.harvest = async (target) => {
      const result = await harvest(target);
      addPreparedReason(target, 'PRIVATE_PROVIDER_ERROR');
      return result;
    };

    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxPasses: 2 },
    );

    expect(result.completeness).toBe('partial');
    expect(result.passes).toBe(1);
    expect(result.reasons).toContain('invalid_reason');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_ERROR');
  });

  it('enforces the total deadline inside a pass', async () => {
    const test = singlePageAdapter([[{ key: 'a', fingerprint: 'a', text: 'A' }]]);
    let clock = 0;
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      {
        stableSamples: 2,
        pollMs: 1,
        maxPasses: 4,
        totalDeadlineMs: 3,
        now: () => clock,
        sleep: async () => {
          clock += 4;
        },
      },
    );
    expect(result.completeness).toBe('partial');
    expect(result.passes).toBe(1);
    expect(result.reasons).toContain('total_deadline_exhausted');
  });

  it('normalizes invalid budgets to bounded defaults', async () => {
    const test = singlePageAdapter([
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
      [{ key: 'a', fingerprint: 'a', text: 'A' }],
    ]);
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      {
        maxPasses: Number.NaN,
        maxSteps: -10,
        stableSamples: 0,
        pollMs: -1,
        stepTimeoutMs: Number.POSITIVE_INFINITY,
        overlapRatio: 0,
        maxOverlapRecoveries: -1,
        totalDeadlineMs: 0,
      },
    );
    expect(result.completeness).toBe('complete');
    expect(result.passes).toBe(2);
  });

  it('invalidates data when identity changes between passes', async () => {
    const test = singlePageAdapter([
      [{ key: 'old-message', fingerprint: 'old', text: 'old' }],
      [{ key: 'new-message', fingerprint: 'new', text: 'new' }],
    ]);
    let identity = 'conversation-a';
    let unresolvedReads = 0;
    test.adapter.sampleIdentity = () => identity;
    test.adapter.readUnresolvedKeys = () => {
      unresolvedReads += 1;
      if (unresolvedReads === 1) identity = 'conversation-b';
      return ['pending'];
    };

    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      { stableSamples: 1, pollMs: 0, maxPasses: 2 },
    );

    expect(result.completeness).toBe('partial');
    expect(result.reasons).toContain('identity_changed');
    expect(test.accumulator.identityVerified).toBe(false);
    expect(test.accumulator.conversationKey).toBe('');
    expect(test.accumulator.records).toEqual([]);
  });

  it('stops on total deadline exhaustion with content-free diagnostics', async () => {
    const test = singlePageAdapter([[{ key: 'PRIVATE_MESSAGE_ID', fingerprint: 'a', text: 'PRIVATE_BODY' }]]);
    let tick = 0;
    const result = await runVirtualizedSweep(
      { document: test.dom.window.document, window: test.dom.window as any },
      test.adapter,
      test.accumulator,
      {
        stableSamples: 1,
        pollMs: 0,
        totalDeadlineMs: 1,
        now: () => tick++,
        sleep: async () => undefined,
      },
    );
    expect(result.completeness).toBe('partial');
    expect(result.reasons).toContain('total_deadline_exhausted');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MESSAGE_ID');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_BODY');
  });
});
