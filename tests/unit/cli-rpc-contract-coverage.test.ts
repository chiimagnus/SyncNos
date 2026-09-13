import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import contract from '@services/protocols/cli-rpc-contract.json';

describe('CLI RPC canonical contract coverage', () => {
  it('declares each public method exactly once and every method has a production Native bridge adapter', async () => {
    expect(new Set(contract.publicMethods).size).toBe(contract.publicMethods.length);
    const bridgeSource = await readFile(new URL('../../src/services/cli/native-bridge.ts', import.meta.url), 'utf8');
    const missing = contract.publicMethods.filter(
      (method) => !bridgeSource.includes(`'${method}'`) && !bridgeSource.includes(`\"${method}\"`),
    );
    expect(missing).toEqual([]);
  });

  it('forces every CLI RPC through the canonical publicMethods allowlist', async () => {
    const cliSource = await readFile(new URL('../../cli/syncnos.mjs', import.meta.url), 'utf8');
    expect(cliSource).toContain('contract.publicMethods.includes(method)');
    expect(cliSource).not.toMatch(/requestEndpoint\([^)]*['\"](?:open\.|settings\.|backup\.|export\.)/s);
  });

  it('keeps browserRequired as a slim capability declaration rather than a second command/RPC catalog', () => {
    const capabilities = contract.browserRequired as Array<Record<string, unknown>>;
    expect(capabilities.map((entry) => entry.capability)).toEqual([
      'comments.selection-locator',
      'oauth.user-approval',
    ]);
    for (const entry of capabilities) {
      expect(typeof entry.reason).toBe('string');
      expect(entry).not.toHaveProperty('command');
      expect(entry).not.toHaveProperty('rpcMethod');
      expect(entry).not.toHaveProperty('sideEffect');
      expect(contract.publicMethods).not.toContain(entry.capability);
    }
  });
});
