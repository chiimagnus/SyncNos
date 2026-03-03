import normalizeApi from '../../shared/normalize.ts';
import collectorContext from '../collector-context.ts';
import { createCollectorEnv } from '../collector-env.ts';
import { createDoubaoCollectorDef } from './doubao-collector.ts';

const NS: any = collectorContext as any;
const env = createCollectorEnv({ window, document, location, normalize: normalizeApi });
const def = createDoubaoCollectorDef(env);
NS.collectorsRegistry?.register?.(def);
