import normalizeApi from '../../shared/normalize.ts';
import collectorContext from '../collector-context.ts';
import { createCollectorEnv } from '../collector-env.ts';
import { createWebCollectorDef } from './web-collector.ts';

const NS: any = collectorContext as any;
const env = createCollectorEnv({ window, document, location, normalize: normalizeApi });
const def = createWebCollectorDef(env);
NS.collectorsRegistry?.register?.(def);

