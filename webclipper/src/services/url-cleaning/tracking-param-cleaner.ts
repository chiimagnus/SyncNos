import * as s14e from '@gorhill/ubo-core/js/s14e-serializer.js';
import * as sfp from '@gorhill/ubo-core/js/static-filtering-parser.js';
import { FilteringContext } from '@gorhill/ubo-core/js/filtering-context.js';
import { CompiledListReader, CompiledListWriter } from '@gorhill/ubo-core/js/static-filtering-io.js';
import snfe from '@gorhill/ubo-core/js/static-net-filtering.js';
import { LineIterator } from '@gorhill/ubo-core/js/text-utils.js';
import publicSuffixList from '@gorhill/ubo-core/lib/publicsuffixlist/publicsuffixlist.js';
import pslSelfie from '@gorhill/ubo-core/build/publicsuffixlist.json';

import { storageGet, storageSet } from '@platform/storage/local';

type FilterListInput = {
  name: string;
  raw: string;
};

type TrackingParamCleanerMeta = {
  updatedAt: number;
  patchVersion: number;
  sources: string[];
};

const ADGUARD_URL_TRACKING_PROTECTION_FILTER_LIST_URL =
  'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_17_TrackParam/filter.txt';

const TRACKING_PARAM_SNFE_SELFIE_STORAGE_KEY = 'tracking_param_snfe_selfie_v1';
const TRACKING_PARAM_SNFE_META_STORAGE_KEY = 'tracking_param_snfe_meta_v1';

const TRACKING_PARAM_SELFIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRACKING_PARAM_PATCH_VERSION = 1;

const WECHAT_PATCH_RULES = `
! SyncNos WebClipper patch rules: tracking param cleaning
! Keep this list intentionally small and reviewable.
||mp.weixin.qq.com^$removeparam=from
||mp.weixin.qq.com^$removeparam=scene
||mp.weixin.qq.com^$removeparam=isappinstalled
||mp.weixin.qq.com^$removeparam=poc_token
||mp.weixin.qq.com^$removeparam=enterid
||mp.weixin.qq.com^$removeparam=clicktime
`.trim();

let pslInitialized = false;
let initPromise: Promise<void> | null = null;
let isReady = false;

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function now() {
  return Date.now();
}

function ensurePublicSuffixListReady() {
  if (pslInitialized) return;
  publicSuffixList.fromSelfie(pslSelfie as any);
  pslInitialized = true;
}

function asNonEmptyString(v: unknown): string {
  const s = String(v ?? '').trim();
  return s ? s : '';
}

function safeParseMeta(v: unknown): TrackingParamCleanerMeta | null {
  if (!v || typeof v !== 'object') return null;
  const anyV = v as any;
  const updatedAt = Number(anyV.updatedAt) || 0;
  const patchVersion = Number(anyV.patchVersion) || 0;
  const sources = Array.isArray(anyV.sources) ? anyV.sources.map((x: any) => asNonEmptyString(x)).filter(Boolean) : [];
  if (!updatedAt || !patchVersion) return null;
  return { updatedAt, patchVersion, sources };
}

function isMetaFresh(meta: TrackingParamCleanerMeta): boolean {
  if (meta.patchVersion !== TRACKING_PARAM_PATCH_VERSION) return false;
  if (!meta.updatedAt) return false;
  return now() - meta.updatedAt <= TRACKING_PARAM_SELFIE_TTL_MS;
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort?.(), Math.max(250, Number(timeoutMs) || 12_000));
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller?.signal,
    } as any);
    if (!res || !res.ok) throw toError(`fetch failed (${res?.status || 'unknown'})`);
    const text = await res.text();
    return String(text || '');
  } finally {
    clearTimeout(timer);
  }
}

function compileList({ name, raw }: FilterListInput, compiler: any): string {
  const content = typeof raw === 'string' ? raw : '';
  if (!content) return '';

  const writer = new CompiledListWriter();
  if (name) writer.properties.set('name', name);

  const parser = new sfp.AstFilterParser({ maxTokenLength: (snfe as any).MAX_TOKEN_LENGTH });
  const lineIter = new LineIterator(content);

  while (lineIter.eot() === false) {
    let line = lineIter.next();
    while (line.endsWith(' \\')) {
      if (lineIter.peek(4) !== '    ') break;
      line = line.slice(0, -2).trim() + lineIter.next().trim();
    }

    parser.parse(line);
    if (parser.isFilter() === false) continue;
    if (parser.isNetworkFilter() === false) continue;
    compiler.compile(parser, writer);
  }

  return writer.toString();
}

async function loadListsIntoSnfe(lists: FilterListInput[]): Promise<void> {
  (snfe as any).reset();

  const compiler = (snfe as any).createCompiler();
  for (const list of lists) {
    const compiled = compileList(list, compiler);
    if (!compiled) continue;
    (snfe as any).fromCompiled(new CompiledListReader(compiled));
  }

  (snfe as any).freeze();
  (snfe as any).optimize();
}

async function saveSelfieToStorage(meta: TrackingParamCleanerMeta): Promise<void> {
  const selfie = (snfe as any).serialize();
  const serialized = s14e.serialize(selfie, { compress: true });
  await storageSet({
    [TRACKING_PARAM_SNFE_SELFIE_STORAGE_KEY]: serialized,
    [TRACKING_PARAM_SNFE_META_STORAGE_KEY]: meta,
  });
}

async function tryRestoreSelfieFromStorage(): Promise<boolean> {
  const got = await storageGet([TRACKING_PARAM_SNFE_SELFIE_STORAGE_KEY, TRACKING_PARAM_SNFE_META_STORAGE_KEY]);
  const serialized = got ? (got as any)[TRACKING_PARAM_SNFE_SELFIE_STORAGE_KEY] : null;
  const meta = safeParseMeta(got ? (got as any)[TRACKING_PARAM_SNFE_META_STORAGE_KEY] : null);

  if (!meta || !isMetaFresh(meta)) return false;
  if (typeof serialized !== 'string' || !serialized.trim()) return false;

  try {
    const selfie = s14e.deserialize(serialized);
    const ok = (snfe as any).unserialize(selfie);
    return ok === true;
  } catch (_e) {
    return false;
  }
}

async function buildFromRemoteLists(): Promise<void> {
  const sources: string[] = [];

  const adguardRaw = await fetchText(ADGUARD_URL_TRACKING_PROTECTION_FILTER_LIST_URL, 12_000);
  sources.push(ADGUARD_URL_TRACKING_PROTECTION_FILTER_LIST_URL);

  const lists: FilterListInput[] = [
    { name: 'adguard-url-tracking-protection', raw: adguardRaw },
    { name: 'syncnos-url-cleaning-patches', raw: `${WECHAT_PATCH_RULES}\n` },
  ];

  await loadListsIntoSnfe(lists);
  await saveSelfieToStorage({
    updatedAt: now(),
    patchVersion: TRACKING_PARAM_PATCH_VERSION,
    sources,
  });
}

async function buildFromFallbackLists(): Promise<void> {
  const lists: FilterListInput[] = [{ name: 'syncnos-url-cleaning-fallback', raw: `${WECHAT_PATCH_RULES}\n` }];
  await loadListsIntoSnfe(lists);
}

async function initTrackingParamCleaner(): Promise<void> {
  ensurePublicSuffixListReady();

  try {
    const restored = await tryRestoreSelfieFromStorage();
    if (restored) {
      isReady = true;
      return;
    }
  } catch (_e) {
    // ignore and fallback to rebuild
  }

  try {
    await buildFromRemoteLists();
    isReady = true;
  } catch (_e) {
    await buildFromFallbackLists();
    isReady = true;
  }
}

async function ensureReady(): Promise<void> {
  if (isReady) return;
  if (!initPromise) {
    initPromise = initTrackingParamCleaner().finally(() => {
      initPromise = null;
    });
  }
  await initPromise;
}

function cleanUrlWithSnfe(url: string): string {
  const input = asNonEmptyString(url);
  if (!input) return '';
  if (!/^https?:\/\//i.test(input)) return input;

  const fctx = new FilteringContext();
  fctx.fromDetails({ originURL: input, url: input, type: 'main_frame' } as any);
  (snfe as any).filterQuery(fctx);

  const out = asNonEmptyString((fctx as any).redirectURL);
  return out || input;
}

export async function cleanTrackingParamsUrl(url: string): Promise<string> {
  const input = asNonEmptyString(url);
  if (!input) return '';

  await ensureReady();
  return cleanUrlWithSnfe(input);
}
