/* eslint-disable import/no-unresolved */

// Legacy content bootstrap (migration-only).
//
// Use static imports so Vite/Rollup bundles legacy content code into `content-scripts/content.js`.

import '../protocols/message-contracts.js';
import '../shared/normalize.js';
import '../shared/runtime-client.js';
import '../storage/incremental-updater.js';

import '../collectors/collector-contract.js';
import '../collectors/registry.js';
import '../collectors/runtime-observer.js';
import '../collectors/collector-utils.js';

import '../collectors/chatgpt/chatgpt-markdown.js';
import '../collectors/chatgpt/chatgpt-collector.js';
import '../collectors/claude/claude-collector.js';
import '../collectors/gemini/gemini-markdown.js';
import '../collectors/gemini/gemini-collector.js';
import '../collectors/deepseek/deepseek-markdown.js';
import '../collectors/deepseek/deepseek-collector.js';
import '../collectors/zai/zai-markdown.js';
import '../collectors/zai/zai-collector.js';
import '../collectors/kimi/kimi-markdown.js';
import '../collectors/kimi/kimi-collector.js';
import '../collectors/doubao/doubao-markdown.js';
import '../collectors/doubao/doubao-collector.js';
import '../collectors/yuanbao/yuanbao-markdown.js';
import '../collectors/yuanbao/yuanbao-collector.js';
import '../collectors/poe/poe-markdown.js';
import '../collectors/poe/poe-collector.js';
import '../collectors/notionai/notionai-markdown.js';
import '../collectors/notionai/notionai-collector.js';
import '../collectors/web/web-collector.js';

import '../integrations/notionai-model-picker.js';
import '../ui/inpage/inpage-tip.js';
import '../ui/inpage/inpage-button.js';
import '../bootstrap/content-controller.js';
import '../bootstrap/content.js';

export function startLegacyContent() {
  (globalThis as any).WebClipper = (globalThis as any).WebClipper || {};
}

