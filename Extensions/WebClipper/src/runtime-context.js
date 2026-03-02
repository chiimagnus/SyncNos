const contextStore = {};
const COMPATIBILITY_NAMESPACE_KEY = "WebClipper";

let runtimeContext = null;

function resetContext(nextValue) {
  for (const key of Object.keys(contextStore)) {
    delete contextStore[key];
  }
  if (!nextValue || typeof nextValue !== "object") return contextStore;
  for (const [key, value] of Object.entries(nextValue)) {
    contextStore[key] = value;
  }
  return contextStore;
}

function ensureCompatibilityNamespace() {
  try {
    const root = globalThis;
    if (!root || typeof root !== "object") return;

    const descriptor = Object.getOwnPropertyDescriptor(root, COMPATIBILITY_NAMESPACE_KEY);
    if (!descriptor || !descriptor.get || !descriptor.set) {
      const existing = root[COMPATIBILITY_NAMESPACE_KEY];
      if (existing && existing !== runtimeContext && typeof existing === "object") {
        resetContext(existing);
      }
      Object.defineProperty(root, COMPATIBILITY_NAMESPACE_KEY, {
        configurable: true,
        enumerable: false,
        get() {
          return runtimeContext;
        },
        set(value) {
          resetContext(value);
        }
      });
    }
  } catch (_e) {
    // ignore
  }
}

runtimeContext = new Proxy(contextStore, {
  get(target, property, receiver) {
    ensureCompatibilityNamespace();
    return Reflect.get(target, property, receiver);
  },
  set(target, property, value, receiver) {
    ensureCompatibilityNamespace();
    return Reflect.set(target, property, value, receiver);
  },
});

ensureCompatibilityNamespace();

module.exports = runtimeContext;
