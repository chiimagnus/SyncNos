import { describe, expect, test } from 'vitest';

import { createCommentAnchorController } from '../../src/ui/comments/comment-anchor-controller';

const locator = {
  v: 1 as const,
  env: 'app' as const,
  quote: { type: 'TextQuoteSelector' as const, exact: 'x' },
  position: { type: 'TextPositionSelector' as const, start: 0, end: 1 },
};

function registry() {
  const calls: string[] = [];
  const replacements: Array<{ id: number; root: Element; tone: string | undefined }> = [];
  return {
    calls,
    replacements,
    value: {
      replace: (id: number, _range: Range, root: Element, tone?: string) => {
        calls.push(`replace:${id}:${tone}`);
        replacements.push({ id, root, tone });
      },
      remove: (id: number) => calls.push(`remove:${id}`),
      setActive: (id: number | null) => calls.push(`active:${id}`),
      refresh: () => {},
      dispose: () => calls.push('dispose'),
      size: () => 0,
    },
  };
}

describe('comment anchor controller', () => {
  test('prioritizes active roots and syncs exact markers', async () => {
    const markers = registry();
    const order: number[] = [];
    const roots = new Map<number, Element>([
      [0, {} as Element],
      [2, {} as Element],
    ]);
    const controller = createCommentAnchorController({
      getRoots: () => [{} as Element],
      registry: markers.value,
      resolve: async ({ locator: current }) => {
        order.push(current.position.start);
        return { ok: true as const, range: {} as Range, root: roots.get(current.position.start)!, rootIndex: 0 };
      },
    });
    await controller.sync(
      [
        { commentId: 1, locator },
        { commentId: 2, locator: { ...locator, position: { ...locator.position, start: 2, end: 3 } } },
      ],
      2,
    );
    expect(order).toEqual([2, 0]);
    expect(markers.calls).toContain('replace:2:active');
    expect(markers.calls).toContain('replace:1:passive');
    expect(markers.replacements).toContainEqual({ id: 2, root: roots.get(2)!, tone: 'active' });
    expect(markers.replacements).toContainEqual({ id: 1, root: roots.get(0)!, tone: 'passive' });
  });

  test('keeps passive marker sync running while an explicit locate gets priority', async () => {
    const markers = registry();
    let releasePassive: (() => void) | null = null;
    let passiveSignal: AbortSignal | null = null;
    const passiveRoot = {} as Element;
    const activeRoot = {} as Element;
    const controller = createCommentAnchorController({
      getRoots: () => [{} as Element],
      registry: markers.value,
      resolve: ({ locator: current, signal }) => {
        if (current.position.start === 0 && !releasePassive) {
          passiveSignal = signal;
          return new Promise((resolve) => {
            releasePassive = () => resolve({ ok: true, range: {} as Range, root: passiveRoot, rootIndex: 0 });
          });
        }
        return { ok: true as const, range: {} as Range, root: activeRoot, rootIndex: 0 };
      },
    });
    const second = { ...locator, position: { ...locator.position, start: 2, end: 3 } };
    const syncing = controller.sync([
      { commentId: 1, locator },
      { commentId: 2, locator: second },
    ]);

    const located = await controller.locate({ commentId: 2, locator: second });
    expect(located.ok).toBe(true);
    expect(passiveSignal?.aborted).toBe(false);
    expect(markers.replacements).toContainEqual({ id: 2, root: activeRoot, tone: 'active' });
    releasePassive?.();
    await syncing;

    expect(markers.calls).toContain('replace:1:passive');
    expect(markers.calls.filter((call) => call === 'replace:2:active').length).toBeGreaterThan(0);
  });

  test('drops an older locate completion without aborting the marker generation', async () => {
    const markers = registry();
    let releaseFirst: (() => void) | null = null;
    const controller = createCommentAnchorController({
      getRoots: () => [{} as Element],
      registry: markers.value,
      resolve: ({ locator: current }) => {
        if (current.position.start === 0) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ ok: true, range: {} as Range, root: {} as Element, rootIndex: 0 });
          });
        }
        return { ok: true as const, range: {} as Range, root: {} as Element, rootIndex: 0 };
      },
    });
    const second = { ...locator, position: { ...locator.position, start: 2, end: 3 } };
    const firstLocate = controller.locate({ commentId: 1, locator });
    const secondLocate = await controller.locate({ commentId: 2, locator: second });
    releaseFirst?.();

    expect(secondLocate.ok).toBe(true);
    await expect(firstLocate).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(markers.calls.some((call) => call.startsWith('replace:1'))).toBe(false);
    expect(markers.calls).toContain('replace:2:active');
  });

  test('shares one aggregate text budget across passive marker resolutions', async () => {
    const markers = registry();
    const seenBudgets: number[] = [];
    const controller = createCommentAnchorController({
      getRoots: () => [{} as Element],
      registry: markers.value,
      maxTotalTextLength: 3,
      resolve: ({ budget }) => {
        seenBudgets.push(budget.remainingTextLength);
        if (budget.remainingTextLength < 2) return { ok: false as const, reason: 'budget_exceeded' as const };
        budget.remainingTextLength -= 2;
        return { ok: true as const, range: {} as Range, root: {} as Element, rootIndex: 0 };
      },
    });

    await controller.sync([
      { commentId: 1, locator },
      { commentId: 2, locator },
    ]);

    expect(seenBudgets).toEqual([3, 1]);
    expect(markers.calls).toContain('replace:1:passive');
    expect(markers.calls).not.toContain('replace:2:passive');
  });

  test('drops stale completion after a new generation starts', async () => {
    const markers = registry();
    let release: (() => void) | null = null;
    const controller = createCommentAnchorController({
      getRoots: () => [{} as Element],
      registry: markers.value,
      resolve: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, range: {} as Range, root: {} as Element, rootIndex: 0 });
        }),
    });
    const pending = controller.sync([{ commentId: 1, locator }]);
    controller.reset();
    release?.();
    await pending;
    expect(markers.calls.some((call) => call.startsWith('replace:1'))).toBe(false);
  });

  test('dispose aborts work and tears down the registry once', () => {
    const markers = registry();
    const controller = createCommentAnchorController({
      getRoots: () => [],
      registry: markers.value,
      resolve: () => ({ ok: false, reason: 'quote_not_found' }),
    });
    controller.dispose();
    controller.dispose();
    expect(markers.calls.filter((call) => call === 'dispose')).toHaveLength(1);
  });
});
