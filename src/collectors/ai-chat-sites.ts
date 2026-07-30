import { VIRTUALIZED_MANUAL_CAPTURE_COLLECTOR_IDS } from '@services/shared/capture-integrity';

export type SupportedAiChatSite = {
  id: string;
  name: string;
  hosts: string[];
  features?: {
    dollarMention?: boolean;
  };
};

export const SUPPORTED_AI_CHAT_SITES: SupportedAiChatSite[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'],
    features: { dollarMention: true },
  },
  { id: 'claude', name: 'Claude', hosts: ['claude.ai'], features: { dollarMention: true } },
  { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'], features: { dollarMention: true } },
  {
    id: 'googleaistudio',
    name: 'Google AI Studio',
    hosts: ['aistudio.google.com', 'makersuite.google.com'],
    features: { dollarMention: true },
  },
  { id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'], features: { dollarMention: true } },
  { id: 'kimi', name: 'Kimi', hosts: ['kimi.moonshot.cn', 'kimi.com'], features: { dollarMention: true } },
  { id: 'doubao', name: 'Doubao', hosts: ['doubao.com'], features: { dollarMention: true } },
  { id: 'yuanbao', name: 'Yuanbao', hosts: ['yuanbao.tencent.com'], features: { dollarMention: true } },
  { id: 'poe', name: 'Poe', hosts: ['poe.com'], features: { dollarMention: true } },
  { id: 'notionai', name: 'Notion AI', hosts: ['notion.so', 'app.notion.com'], features: { dollarMention: true } },
  { id: 'zai', name: 'z.ai', hosts: ['chat.z.ai'], features: { dollarMention: true } },
] as const;

// Virtualized providers require manual prepare and explicit completeness before persistence.
export const AI_CHAT_AUTO_SAVE_COLLECTOR_IDS = new Set(
  SUPPORTED_AI_CHAT_SITES.map((site) => site.id).filter((id) => !VIRTUALIZED_MANUAL_CAPTURE_COLLECTOR_IDS.has(id)),
);
