const runtimeContext = {};
const COMPATIBILITY_NAMESPACE_KEY = "WebClipper";

function resetContext(nextValue) {
  for (const key of Object.keys(runtimeContext)) {
    delete runtimeContext[key];
  }
  if (!nextValue || typeof nextValue !== "object") return runtimeContext;
  for (const [key, value] of Object.entries(nextValue)) {
    runtimeContext[key] = value;
  }
  return runtimeContext;
}

try {
  const root = globalThis;
  if (root && typeof root === "object") {
    if (root[COMPATIBILITY_NAMESPACE_KEY] && typeof root[COMPATIBILITY_NAMESPACE_KEY] === "object") {
      resetContext(root[COMPATIBILITY_NAMESPACE_KEY]);
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

module.exports = runtimeContext;
