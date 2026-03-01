export async function startLegacyContent() {
  globalThis.WebClipper = globalThis.WebClipper || {};

  // Keep the load order aligned with `manifest.json` content_scripts[0].js.
  const modules = [
    "../protocols/message-contracts.js",
    "../shared/normalize.js",
    "../shared/runtime-client.js",
    "../storage/incremental-updater.js",
    "../collectors/collector-contract.js",
    "../collectors/registry.js",
    "../collectors/runtime-observer.js",
    "../collectors/collector-utils.js",
    "../collectors/chatgpt/chatgpt-markdown.js",
    "../collectors/chatgpt/chatgpt-collector.js",
    "../collectors/claude/claude-collector.js",
    "../collectors/gemini/gemini-markdown.js",
    "../collectors/gemini/gemini-collector.js",
    "../collectors/deepseek/deepseek-markdown.js",
    "../collectors/deepseek/deepseek-collector.js",
    "../collectors/zai/zai-markdown.js",
    "../collectors/zai/zai-collector.js",
    "../collectors/kimi/kimi-markdown.js",
    "../collectors/kimi/kimi-collector.js",
    "../collectors/doubao/doubao-markdown.js",
    "../collectors/doubao/doubao-collector.js",
    "../collectors/yuanbao/yuanbao-markdown.js",
    "../collectors/yuanbao/yuanbao-collector.js",
    "../collectors/poe/poe-markdown.js",
    "../collectors/poe/poe-collector.js",
    "../collectors/notionai/notionai-markdown.js",
    "../collectors/notionai/notionai-collector.js",
    "../collectors/web/web-collector.js",
    "../integrations/notionai-model-picker.js",
    "../ui/inpage/inpage-tip.js",
    "../ui/inpage/inpage-button.js",
    "../bootstrap/content-controller.js",
    "../bootstrap/content.js",
  ];

  for (const specifier of modules) {
    // eslint-disable-next-line no-await-in-loop
    await import(specifier);
  }
}

