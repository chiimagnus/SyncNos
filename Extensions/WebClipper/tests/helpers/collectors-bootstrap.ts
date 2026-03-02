export async function ensureCollectorUtils() {
  const [collectorUtilsModule, collectorContextModule] = await Promise.all([
    import('../../src/collectors/collector-utils.ts'),
    import('../../src/collectors/collector-context.ts'),
  ]);
  const collectorUtils = collectorUtilsModule.default || collectorUtilsModule;
  const collectorContext = collectorContextModule.default as any;
  collectorContext.collectorUtils = collectorUtils;
  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== 'object') {
    globalThis.WebClipper = {};
  }
  (globalThis.WebClipper as any).collectorUtils = collectorUtils;
  return collectorUtils;
}

export async function ensureCollectorContractAndRegistry() {
  const [collectorContractModule, collectorRegistryModule, collectorContextModule] = await Promise.all([
    import('../../src/collectors/collector-contract.ts'),
    import('../../src/collectors/registry.ts'),
    import('../../src/collectors/collector-context.ts'),
  ]);
  const collectorContext = collectorContextModule.default as any;
  const collectorContract = { assertCollectorDef: collectorContractModule.assertCollectorDef };
  collectorContext.collectorContract = collectorContract;
  const collectorsRegistry = collectorRegistryModule.createCollectorsRegistry();
  collectorContext.collectorsRegistry = collectorsRegistry;

  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== 'object') {
    globalThis.WebClipper = {};
  }
  (globalThis.WebClipper as any).collectorContract = collectorContract;
  (globalThis.WebClipper as any).collectorsRegistry = collectorsRegistry;

  return { collectorContract, collectorsRegistry };
}
