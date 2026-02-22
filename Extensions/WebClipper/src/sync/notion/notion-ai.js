(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const AI = Object.freeze({
    chatgpt: { name: "ChatGPT", color: "green" },
    claude: { name: "Claude", color: "purple" },
    gemini: { name: "Gemini", color: "yellow" },
    deepseek: { name: "DeepSeek", color: "gray" },
    kimi: { name: "Kimi", color: "blue" },
    doubao: { name: "豆包", color: "orange" },
    yuanbao: { name: "元宝", color: "red" },
    poe: { name: "Poe", color: "pink" },
    notionai: { name: "NotionAI", color: "brown" }
  });

  function normalizeSourceKey(source) {
    return String(source || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  }

  function optionNameForSource(source) {
    const key = normalizeSourceKey(source);
    const hit = AI[key];
    if (hit && hit.name) return hit.name;
    const fallback = String(source || "").trim();
    return fallback || "Unknown";
  }

  function buildAiOptions() {
    return Object.keys(AI).map((k) => ({ name: AI[k].name, color: AI[k].color }));
  }

  const api = { AI, buildAiOptions, optionNameForSource, normalizeSourceKey };
  NS.notionAi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
