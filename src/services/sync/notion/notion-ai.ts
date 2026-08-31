type AiSourceMeta = { name: string; color: string };

const AI = Object.freeze({
  chatgpt: { name: 'ChatGPT', color: 'green' },
  gemini: { name: 'Gemini', color: 'yellow' },
  deepseek: { name: 'DeepSeek', color: 'gray' },
  kimi: { name: 'Kimi', color: 'blue' },
  doubao: { name: '豆包', color: 'orange' },
  yuanbao: { name: '元宝', color: 'red' },
  poe: { name: 'Poe', color: 'pink' },
  notionai: { name: 'NotionAI', color: 'brown' },
});

function normalizeSourceKey(source: unknown): string {
  return String(source || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function optionNameForSource(source: unknown): string {
  const key = normalizeSourceKey(source);
  const hit = (AI as Record<string, AiSourceMeta>)[key];
  if (hit && hit.name) return hit.name;
  const fallback = String(source || '').trim();
  return fallback || 'Unknown';
}

function buildAiOptions(): AiSourceMeta[] {
  return (Object.keys(AI) as Array<keyof typeof AI>).map((k) => ({ name: AI[k].name, color: AI[k].color }));
}

export { AI, buildAiOptions, optionNameForSource, normalizeSourceKey };
