import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_SEARCH_PAGE_LIMIT, MIGRATION_FACT_KINDS } from '@services/local-data/contracts';
import { nativeHostContract } from '@services/local-data/native-host-contract';

import { runCli } from '../../packages/syncnoscli/src/cli';
import {
  SYNCNOSCLI_DATABASE_FILE_NAME,
  SYNCNOSCLI_RUNTIME_DIRECTORY_NAME,
} from '../../packages/syncnoscli/src/runtime/paths';

const repoRoot = resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

const overview = read('docs/overview.md');
const storage = read('docs/storage.md');
const troubleshooting = read('docs/troubleshooting.md');
const cliReadme = read('packages/syncnoscli/README.md');
const installHelpSource = read('src/ui/settings/sections/LocalDatabaseInstallHelp.tsx');
const rootPackage = JSON.parse(read('package.json')) as { version: string };
const cliPackage = JSON.parse(read('packages/syncnoscli/package.json')) as { name: string; version: string };

const installCommand = `npm install -g ${cliPackage.name}`;
const aiPrompt = `请你安装SyncNos CLI：${installCommand}`;
const unixDatabasePath = `~/${SYNCNOSCLI_RUNTIME_DIRECTORY_NAME}/${SYNCNOSCLI_DATABASE_FILE_NAME}`;
const windowsDatabasePath = `%USERPROFILE%\\${SYNCNOSCLI_RUNTIME_DIRECTORY_NAME}\\${SYNCNOSCLI_DATABASE_FILE_NAME}`;

async function cliHelp(): Promise<string> {
  let output = '';
  const exitCode = await runCli(['--help'], {
    stdout: {
      write(chunk) {
        output += chunk;
        return true;
      },
    },
  });
  expect(exitCode).toBe(0);
  return output;
}

describe('Local Database public documentation contract', () => {
  it('keeps overview as navigation to the canonical storage, troubleshooting, and CLI docs', () => {
    expect(overview).toContain('[storage.md](storage.md)');
    expect(overview).toContain('[troubleshooting.md](troubleshooting.md#local-database)');
    expect(overview).toContain('[packages/syncnoscli/README.md](../packages/syncnoscli/README.md)');
    expect(overview).not.toMatch(/npm install -g @chiimagnus\/syncnoscli|syncnoscli doctor --fix/);
  });

  it('binds storage authority to the fixed runtime path, five fact kinds, explicit join, and journal modes', () => {
    expect(storage).toContain(unixDatabasePath);
    expect(storage).toContain(windowsDatabasePath);
    expect(storage).not.toContain('~/.syncnos/syncnos.sqlite');
    for (const kind of MIGRATION_FACT_KINDS) expect(storage).toContain(`\`${kind}\``);
    expect(storage).toMatch(/默认不启用/);
    expect(storage).toMatch(/明确确认 join|重新显式 join/);
    expect(storage).toContain('`not_started` / `idb-v1`');
    expect(storage).toContain('`active` / `native:*`');
    expect(storage).toMatch(/不存在长期双写|不得.*回退到旧 IDB/);
    expect(storage).not.toMatch(/IndexedDB\s*(?:是|作为).*唯一事实源/i);
  });

  it('documents bounded keyword FTS without remote/vector/provider-query promises', () => {
    expect(storage).toContain(`每页最多 ${MAX_SEARCH_PAGE_LIMIT} 个 result`);
    expect(storage).toContain('500 个 candidate');
    expect(storage).toContain('4 KiB UTF-8');
    expect(storage).toContain('256 KiB UTF-8');
    expect(storage).toContain('64 MiB');
    expect(storage).toMatch(/不是 vector database/);
    expect(storage).toMatch(/不承诺 remote search|不会为了查询调用 OAuth provider/);
    expect(storage).toMatch(/不支持把开放的 SQLite 放到共享网络盘/);
  });

  it('keeps troubleshooting commands aligned with the UI and refuses unsupported repair bypasses', () => {
    expect(troubleshooting).toContain(`\`${installCommand}\``);
    expect(troubleshooting).toContain(`\`${aiPrompt}\``);
    expect(troubleshooting).toContain('`syncnoscli doctor`');
    expect(troubleshooting).toContain('`syncnoscli doctor --fix`');
    expect(troubleshooting).toMatch(/Snap\/Flatpak.*portal integration/);
    expect(troubleshooting).toMatch(/flatpak-spawn.*不能/);
    expect(troubleshooting).toMatch(/Safari.*localDataSupported: false/);
    expect(troubleshooting).toMatch(/FIREFOX_EXTENSION_ID.*只属于本地 Zen test XPI/);
    expect(troubleshooting).toMatch(/不能获得 Local Database action/);
    expect(troubleshooting).not.toMatch(/reg(?:\.exe)?\s+add|regedit|sqlite3\s+|flatpak-spawn\s+--host/i);
    expect(troubleshooting).not.toMatch(/手工.*allowlist.*修复|手动.*registry.*修复/i);

    expect(installHelpSource).toContain(`SYNCNOS_CLI_INSTALL_COMMAND = '${installCommand}'`);
    expect(installHelpSource).toContain(
      'SYNCNOS_CLI_AI_PROMPT = `请你安装SyncNos CLI：${SYNCNOS_CLI_INSTALL_COMMAND}`',
    );
  });

  it('keeps the CLI README on-demand/read-only and its search page budget equal to the shared contract', async () => {
    expect(cliReadme).toContain('Requires Node.js 22 or newer');
    expect(cliReadme).toContain(unixDatabasePath);
    expect(cliReadme).toContain(windowsDatabasePath);
    expect(cliReadme).toContain('does not run as a daemon');
    expect(cliReadme).toContain('Data commands are read-only');
    expect(cliReadme).toContain(`--page-size <1-${MAX_SEARCH_PAGE_LIMIT}>`);
    expect(cliReadme).toContain('conversations list');
    expect(cliReadme).toContain('--page-size <1-200>');
    expect(cliReadme).toMatch(
      /does not accept SQL, write, delete, provider-sync, remote\/vector-search, or database-path/,
    );
    expect(cliReadme).toContain('../../docs/storage.md');
    expect(cliReadme).toContain('../../docs/troubleshooting.md#local-database');

    const help = await cliHelp();
    expect(help).toContain(`search <query>`);
    expect(help).toContain(`--page-size <1-${MAX_SEARCH_PAGE_LIMIT}>`);
    expect(help).toContain('conversations list');
    expect(help).toContain('--page-size <1-200>');
  });

  it('keeps browser-local state, Safari support, and independent CLI semver explicit', () => {
    expect(storage).toContain('`chrome.storage.local`');
    expect(nativeHostContract.browsers.safari.localDataSupported).toBe(false);
    expect(troubleshooting).toContain('Safari');
    expect(cliReadme).toMatch(/CLI package has its own semantic version/);
    expect(cliPackage.version).not.toBe(rootPackage.version);
  });
});
