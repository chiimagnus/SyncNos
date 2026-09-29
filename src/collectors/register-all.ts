import type { CollectorEnv } from '@collectors/collector-env.ts';
import type { CollectorsRegistry } from '@collectors/registry.ts';

import { createChatgptCollectorDef } from '@collectors/chatgpt/chatgpt-collector.ts';
import { createClaudeCollectorDef } from '@collectors/claude/claude-collector.ts';
import { createGeminiCollectorDef } from '@collectors/gemini/gemini-collector.ts';
import { createGoogleAiStudioCollectorDef } from '@collectors/googleaistudio/googleaistudio-collector.ts';
import { createDeepseekCollectorDef } from '@collectors/deepseek/deepseek-collector.ts';
import { createKimiCollectorDef } from '@collectors/kimi/kimi-collector.ts';
import { createDoubaoCollectorDef } from '@collectors/doubao/doubao-collector.ts';
import { createYuanbaoCollectorDef } from '@collectors/yuanbao/yuanbao-collector.ts';
import { createPoeCollectorDef } from '@collectors/poe/poe-collector.ts';
import { createNotionAiCollectorDef } from '@collectors/notionai/notionai-collector.ts';
import { createZaiCollectorDef } from '@collectors/zai/zai-collector.ts';
import { createWebCollectorDef } from '@collectors/web/web-collector.ts';

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
