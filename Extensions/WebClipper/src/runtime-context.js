const RUNTIME_CONTEXT_KEY = "__syncnos_webclipper_runtime_context__";
const RUNTIME_CONTEXT_STORE_KEY = "__syncnos_webclipper_runtime_context_store__";
const COMPATIBILITY_NAMESPACE_KEY = "WebClipper";

function resetContext(store, nextValue) {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  if (!nextValue || typeof nextValue !== "object") return store;
  for (const [key, value] of Object.entries(nextValue)) {
    store[key] = value;
  }
  return store;
}

function ensureCompatibilityNamespace(root, contextStore, runtimeContext) {
  const descriptor = Object.getOwnPropertyDescriptor(root, COMPATIBILITY_NAMESPACE_KEY);
  if (descriptor && descriptor.get && descriptor.set) return;

  const existing = root[COMPATIBILITY_NAMESPACE_KEY];
  if (existing && existing !== runtimeContext && typeof existing === "object") {
    resetContext(contextStore, existing);
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

function ensureRuntimeContext() {
  const root = globalThis;
  if (root[RUNTIME_CONTEXT_KEY] && typeof root[RUNTIME_CONTEXT_KEY] === "object") {
    return root[RUNTIME_CONTEXT_KEY];
  }

  const contextStore = root[RUNTIME_CONTEXT_STORE_KEY] && typeof root[RUNTIME_CONTEXT_STORE_KEY] === "object"
    ? root[RUNTIME_CONTEXT_STORE_KEY]
    : {};
  root[RUNTIME_CONTEXT_STORE_KEY] = contextStore;

  const runtimeContext = new Proxy(contextStore, {
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

module.exports = ensureRuntimeContext();
