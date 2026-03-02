import { assertCollectorDef } from './collector-contract.ts';
import * as collectorUtils from './collector-utils.ts';
import { createCollectorsRegistry } from './registry.ts';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const namespace: any = require('./collector-context.js');

namespace.collectorContract = { assertCollectorDef };
namespace.collectorUtils = collectorUtils;

if (!namespace.collectorsRegistry) {
  namespace.collectorsRegistry = createCollectorsRegistry();
}

if (!namespace.collectors) {
  namespace.collectors = {};
}
