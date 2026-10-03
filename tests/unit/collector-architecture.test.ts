import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SUPPORTED_AI_CHAT_SITES } from '@collectors/ai-chat-sites.ts';

const COLLECTORS_ROOT = path.resolve(process.cwd(), 'src/collectors');
const PROVIDERS = new Set(SUPPORTED_AI_CHAT_SITES.map((site) => site.id));

function walkTypeScriptFiles(dir: string): string[] {
  const output: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walkTypeScriptFiles(absolute));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) output.push(absolute);
  }
  return output;
}

function importedSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

function targetProvider(sourceFile: string, specifier: string): string | null {
  if (specifier.startsWith('@collectors/')) {
    const first = specifier.slice('@collectors/'.length).split('/')[0] || '';
    return PROVIDERS.has(first) ? first : null;
  }
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(sourceFile), specifier);
  const relative = path.relative(COLLECTORS_ROOT, resolved).replaceAll(path.sep, '/');
  const first = relative.split('/')[0] || '';
  return PROVIDERS.has(first) ? first : null;
}

describe('AI collector architecture', () => {
  it('keeps provider implementations independent from other providers', () => {
    const violations: string[] = [];

    for (const provider of PROVIDERS) {
      const providerRoot = path.join(COLLECTORS_ROOT, provider);
      if (!fs.existsSync(providerRoot)) continue;
      for (const file of walkTypeScriptFiles(providerRoot)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const specifier of importedSpecifiers(source)) {
          const target = targetProvider(file, specifier);
          if (!target || target === provider) continue;
          violations.push(`${path.relative(process.cwd(), file)}: ${provider} -> ${target} (${specifier})`);
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
