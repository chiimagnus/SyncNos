import { assertCollectorDef } from './collector-contract.ts';
import * as collectorUtils from './collector-utils.ts';
import { createCollectorsRegistry } from './registry.ts';

const namespace: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});

namespace.collectorContract = { assertCollectorDef };
namespace.collectorUtils = collectorUtils;

if (!namespace.collectorsRegistry) {
  namespace.collectorsRegistry = createCollectorsRegistry();
}

if (!namespace.collectors) {
  namespace.collectors = {};
}
