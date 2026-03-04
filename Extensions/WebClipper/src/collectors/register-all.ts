import type { CollectorEnv } from './collector-env.ts';
import type { CollectorsRegistry } from './registry.ts';

import { createChatgptCollectorDef } from './chatgpt/chatgpt-collector.ts';
import { createClaudeCollectorDef } from './claude/claude-collector.ts';
import { createGeminiCollectorDef } from './gemini/gemini-collector.ts';
import { createGoogleAiStudioCollectorDef } from './googleaistudio/googleaistudio-collector.ts';
import { createDeepseekCollectorDef } from './deepseek/deepseek-collector.ts';
import { createKimiCollectorDef } from './kimi/kimi-collector.ts';
import { createDoubaoCollectorDef } from './doubao/doubao-collector.ts';
import { createYuanbaoCollectorDef } from './yuanbao/yuanbao-collector.ts';
import { createPoeCollectorDef } from './poe/poe-collector.ts';
import { createNotionAiCollectorDef } from './notionai/notionai-collector.ts';
import { createZaiCollectorDef } from './zai/zai-collector.ts';
import { createWebCollectorDef } from './web/web-collector.ts';

export function registerAllCollectors(registry: CollectorsRegistry, env: CollectorEnv) {
  registry.register(createChatgptCollectorDef(env));
  registry.register(createClaudeCollectorDef(env));
  registry.register(createGeminiCollectorDef(env));
  registry.register(createGoogleAiStudioCollectorDef(env));
  registry.register(createDeepseekCollectorDef(env));
  registry.register(createKimiCollectorDef(env));
  registry.register(createDoubaoCollectorDef(env));
  registry.register(createYuanbaoCollectorDef(env));
  registry.register(createPoeCollectorDef(env));
  registry.register(createNotionAiCollectorDef(env));
  registry.register(createZaiCollectorDef(env));
  registry.register(createWebCollectorDef(env));
}
