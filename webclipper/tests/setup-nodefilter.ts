// Vitest runs in `environment: node`. Some DOM-focused libraries (e.g. selector anchoring)
// read `NodeFilter.SHOW_TEXT` at import time. Provide a minimal polyfill so these modules
// can be imported in node tests before JSDOM is installed.
if (!(globalThis as any).NodeFilter) {
  (globalThis as any).NodeFilter = {
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
    SHOW_ALL: 0xffffffff,
    SHOW_ELEMENT: 0x1,
    SHOW_TEXT: 0x4,
  };
}
