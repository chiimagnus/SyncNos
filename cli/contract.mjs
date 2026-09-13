import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export function readCliRpcContract() {
  const candidates = [
    join(SCRIPT_DIR, 'cli-rpc-contract.json'),
    join(SCRIPT_DIR, '..', 'src', 'services', 'protocols', 'cli-rpc-contract.json'),
  ];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('CLI RPC contract not found');
}

export const contract = readCliRpcContract();
