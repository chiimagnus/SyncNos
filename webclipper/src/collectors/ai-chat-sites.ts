export type SupportedAiChatSite = {
  id: string;
  name: string;
  hosts: string[];
};

export const SUPPORTED_AI_CHAT_SITES: SupportedAiChatSite[] = [
  { id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { id: 'claude', name: 'Claude', hosts: ['claude.ai'] },
  { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'] },
  { id: 'googleaistudio', name: 'Google AI Studio', hosts: ['aistudio.google.com', 'makersuite.google.com'] },
  { id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'] },
  { id: 'kimi', name: 'Kimi', hosts: ['kimi.moonshot.cn', 'kimi.com'] },
  { id: 'doubao', name: 'Doubao', hosts: ['doubao.com'] },
  { id: 'yuanbao', name: 'Yuanbao', hosts: ['yuanbao.tencent.com'] },
  { id: 'poe', name: 'Poe', hosts: ['poe.com'] },
  { id: 'notionai', name: 'Notion AI', hosts: ['notion.so'] },
  { id: 'zai', name: 'z.ai', hosts: ['chat.z.ai'] },
] as const;

// Keep auto-save conservative: do not auto-save Google AI Studio (manual capture is supported).
export const AI_CHAT_AUTO_SAVE_COLLECTOR_IDS = new Set(
  SUPPORTED_AI_CHAT_SITES.map((site) => site.id).filter((id) => id !== 'googleaistudio'),
);
