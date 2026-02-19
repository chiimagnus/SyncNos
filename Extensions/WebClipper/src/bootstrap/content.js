/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const runtime = NS.runtimeClient && typeof NS.runtimeClient.createRuntimeClient === "function"
    ? NS.runtimeClient.createRuntimeClient()
    : null;

  try {
    if (NS.inpageButton && typeof NS.inpageButton.initRuntime === "function") {
      NS.inpageButton.initRuntime(runtime);
    }
  } catch (_e) {
    // ignore
  }

  const factory = NS.contentController && typeof NS.contentController.createController === "function"
    ? NS.contentController.createController
    : null;
  if (!factory) return;

  const controller = factory({ runtime });
  controller && controller.start && controller.start();
})();

