import { assertCollectorDef } from './collector-contract.ts';
import * as collectorUtils from './collector-utils.ts';
import { createCollectorsRegistry } from './registry.ts';
import collectorContext from './collector-context.ts';

const namespace: any = collectorContext;

namespace.collectorContract = { assertCollectorDef };
namespace.collectorUtils = collectorUtils;

if (!namespace.collectorsRegistry) {
  namespace.collectorsRegistry = createCollectorsRegistry();
}

if (!namespace.collectors) {
  namespace.collectors = {};
}
