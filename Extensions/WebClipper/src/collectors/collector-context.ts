import runtimeContext from '../runtime-context.ts';

const collectorContext: any = runtimeContext;

if (!collectorContext.collectors || typeof collectorContext.collectors !== 'object') {
  collectorContext.collectors = {};
}

export default collectorContext;
