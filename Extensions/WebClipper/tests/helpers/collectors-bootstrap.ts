export async function ensureCollectorUtils() {
  const [collectorUtilsModule] = await Promise.all([
    import('../../src/collectors/collector-utils.ts'),
  ]);
  const collectorUtils = collectorUtilsModule.default || collectorUtilsModule;
  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== 'object') {
    globalThis.WebClipper = {};
  }
  (globalThis.WebClipper as any).collectorUtils = collectorUtils;
  return collectorUtils;
}

export async function ensureCollectorContractAndRegistry() {
  const [collectorContractModule, collectorRegistryModule] = await Promise.all([
    import('../../src/collectors/collector-contract.ts'),
    import('../../src/collectors/registry.ts'),
  ]);
  const collectorContract = { assertCollectorDef: collectorContractModule.assertCollectorDef };
  const collectorsRegistry = collectorRegistryModule.createCollectorsRegistry();

  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== 'object') {
    globalThis.WebClipper = {};
  }
  (globalThis.WebClipper as any).collectorContract = collectorContract;
  (globalThis.WebClipper as any).collectorsRegistry = collectorsRegistry;

  return { collectorContract, collectorsRegistry };
}
