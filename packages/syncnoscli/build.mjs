import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
const distDir = resolve(packageRoot, 'dist');

mkdirSync(distDir, { recursive: true, mode: 0o755 });

await build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(packageRoot, 'src/cli.ts')],
  outfile: resolve(distDir, 'cli.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  minifyWhitespace: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __SYNCNOSCLI_VERSION__: JSON.stringify(packageJson.version),
  },
  alias: {
    '@services': resolve(packageRoot, '../../src/services'),
  },
  external: ['better-sqlite3', 'better-sqlite3/*'],
  tsconfig: resolve(packageRoot, 'tsconfig.json'),
});

await build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(packageRoot, 'src/native-host/main.ts')],
  outfile: resolve(distDir, 'native-host.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  minifyWhitespace: true,
  legalComments: 'none',
  define: {
    __SYNCNOSCLI_VERSION__: JSON.stringify(packageJson.version),
  },
  alias: {
    '@services': resolve(packageRoot, '../../src/services'),
  },
  external: ['better-sqlite3', 'better-sqlite3/*'],
  tsconfig: resolve(packageRoot, 'tsconfig.json'),
});
