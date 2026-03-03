import type { CollectorEnv } from './collector-env.ts';
import type { CollectorsRegistry } from './registry.ts';

import { createChatgptCollectorDef } from './chatgpt/chatgpt-collector.ts';
import { createClaudeCollectorDef } from './claude/claude-collector.ts';
import { createGeminiCollectorDef } from './gemini/gemini-collector.ts';
import { createGoogleAiStudioCollectorDef } from './googleaistudio/googleaistudio-collector.ts';
import { createDeepseekCollectorDef } from './deepseek/deepseek-collector.ts';
import { createKimiCollectorDef } from './kimi/kimi-collector.ts';

export function registerAllCollectors(registry: CollectorsRegistry, env: CollectorEnv) {
  registry.register(createChatgptCollectorDef(env));
  registry.register(createClaudeCollectorDef(env));
  registry.register(createGeminiCollectorDef(env));
  registry.register(createGoogleAiStudioCollectorDef(env));
  registry.register(createDeepseekCollectorDef(env));
  registry.register(createKimiCollectorDef(env));
}
