import { describe, expect, it } from 'vitest';

import { buildAiOptions, optionNameForSource } from '@services/sync/notion/notion-ai';

describe('Notion AI source metadata', () => {
  it('keeps Claude as a canonical AI source option', () => {
    expect(optionNameForSource('claude')).toBe('Claude');
    expect(buildAiOptions()).toContainEqual({ name: 'Claude', color: 'purple' });
  });
});
