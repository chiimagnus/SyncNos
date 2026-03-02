import { assertCollectorDef } from './collector-contract';
import * as collectorUtils from './collector-utils';
import { createCollectorsRegistry } from './registry';

const namespace: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});

namespace.collectorContract = { assertCollectorDef };
namespace.collectorUtils = collectorUtils;

if (!namespace.collectorsRegistry) {
  namespace.collectorsRegistry = createCollectorsRegistry();
}

if (!namespace.collectors) {
  namespace.collectors = {};
}
