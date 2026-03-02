type RuntimeContextRecord = Record<string, any>;

const RUNTIME_CONTEXT_KEY = '__syncnos_webclipper_runtime_context__';
const RUNTIME_CONTEXT_STORE_KEY = '__syncnos_webclipper_runtime_context_store__';
const COMPATIBILITY_NAMESPACE_KEY = 'WebClipper';

function resetContext(store: RuntimeContextRecord, nextValue: unknown): RuntimeContextRecord {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  if (!nextValue || typeof nextValue !== 'object') return store;
  for (const [key, value] of Object.entries(nextValue as RuntimeContextRecord)) {
    store[key] = value;
  }
  return store;
}

function ensureCompatibilityNamespace(
  root: any,
  contextStore: RuntimeContextRecord,
  runtimeContext: RuntimeContextRecord,
) {
  const descriptor = Object.getOwnPropertyDescriptor(root, COMPATIBILITY_NAMESPACE_KEY);
  if (descriptor && descriptor.get && descriptor.set) return;

  const currentNamespace = root[COMPATIBILITY_NAMESPACE_KEY];
  if (
    currentNamespace &&
    currentNamespace !== runtimeContext &&
    typeof currentNamespace === 'object'
  ) {
    resetContext(contextStore, currentNamespace);
  }

  Object.defineProperty(root, COMPATIBILITY_NAMESPACE_KEY, {
    configurable: true,
    enumerable: false,
    get() {
      return runtimeContext;
    },
    set(value) {
      resetContext(contextStore, value);
    },
  });
}

function ensureRuntimeContext(): RuntimeContextRecord {
  const root = globalThis as any;

  const existing = root[RUNTIME_CONTEXT_KEY];
  if (existing && typeof existing === 'object') return existing as RuntimeContextRecord;

  const existingStore = root[RUNTIME_CONTEXT_STORE_KEY];
  const contextStore: RuntimeContextRecord =
    existingStore && typeof existingStore === 'object' ? existingStore : {};
  root[RUNTIME_CONTEXT_STORE_KEY] = contextStore;

  let runtimeContext: RuntimeContextRecord = contextStore;
  runtimeContext = new Proxy(contextStore, {
    get(target, property, receiver) {
      ensureCompatibilityNamespace(root, contextStore, runtimeContext);
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      ensureCompatibilityNamespace(root, contextStore, runtimeContext);
      return Reflect.set(target, property, value, receiver);
    },
  });

  ensureCompatibilityNamespace(root, contextStore, runtimeContext);

  root[RUNTIME_CONTEXT_KEY] = runtimeContext;
  return runtimeContext;
}

const runtimeContext = ensureRuntimeContext();

export default runtimeContext;
export { ensureRuntimeContext };
