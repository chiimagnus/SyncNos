/* eslint-disable import/no-unresolved */

// Legacy content bootstrap (migration-only).
//
// Use static imports so Vite/Rollup bundles legacy content code into `content-scripts/content.js`.

import '../protocols/message-contracts.js';
import '../shared/normalize.js';
import '../storage/incremental-updater.js';

import '../collectors/bootstrap.ts';
import '../collectors/runtime-observer.js';
import '../collectors/sites-bootstrap';

import '../collectors/zai/zai-markdown.js';
import '../collectors/zai/zai-collector.js';
import '../collectors/yuanbao/yuanbao-markdown.js';
import '../collectors/yuanbao/yuanbao-collector.js';
import '../collectors/notionai/notionai-markdown.js';
import '../collectors/notionai/notionai-collector.js';
import '../collectors/web/web-collector.js';

import '../integrations/notionai-model-picker.js';
import '../ui/inpage/inpage-tip.js';
import '../ui/inpage/inpage-button.js';
import '../ui/inpage/inpage-tip-shadow';
import '../ui/inpage/inpage-button-shadow';

export function startLegacyContent() {
  (globalThis as any).WebClipper = (globalThis as any).WebClipper || {};
}
