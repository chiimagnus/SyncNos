import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import rawContract from '../../src/services/local-data/native-host-contract.json';
import { parseNativeHostContract } from '../../src/services/local-data/native-host-contract';

const repoRoot = resolve(__dirname, '../..');
const matrixPath = resolve(__dirname, 'local-data-release-matrix.md');
const contract = parseNativeHostContract(rawContract);
const CHECK_NAMES = [
  'globalInstallDoctor',
  'firstMigration',
  'secondBrowserExplicitJoin',
  'captureDeleteMapping',
  'imageCommentBackup',
  'cliJsonSearch',
  'focusRefresh',
  'extensionUninstallReinstall',
  'npmUninstallReinstall',
] as const;
const REGRESSION_NAMES = [
  'host_missing',
  'damaged_registration',
  'lock_busy',
  'interrupt_resume',
  'short_cjk_query',
] as const;
const SAFARI_CHECKS = [
  'idbBaseline',
  'nativePermissionAbsent',
  'localDatabaseActionAbsent',
  'installHelpAbsent',
] as const;
const THREE_OS_CLI_CHECKS = ['ubuntu', 'macos', 'windows'] as const;
const AUTOMATIC_COMMANDS = Object.freeze({
  gate: 'npm run gate',
  safariCheck: 'npm run check:safari',
  finalBrowserArtifactContract:
    'npm run build:release-contract-fixtures && npm run test -- tests/build/native-messaging-release-contract.test.ts',
});
const CLI_MATRIX_WORKFLOW = 'syncnoscli-ci.yml' as const;

type Outcome = 'fail' | 'pass' | 'pending';
type Evidence = Record<string, any>;

function parseEvidence(markdown = readFileSync(matrixPath, 'utf8')): Evidence {
  const match = markdown.match(
    /<!-- syncnos-local-data-release-evidence:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- syncnos-local-data-release-evidence:end -->/,
  );
  if (!match) throw new Error('release evidence JSON block is missing');
  return JSON.parse(match[1]!);
}

function expectedIdentity(browser: 'chrome' | 'edge' | 'firefox'): string {
  return browser === 'firefox' ? contract.browsers.firefox.geckoId : contract.browsers[browser].runtimeId;
}

function validObservedAt(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === `${value.slice(0, -1)}.000Z`;
}

function allPass(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => record?.[key] === 'pass');
}

function validCommitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function validActionsRunUrl(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^https:\/\/github\.com\/SyncNos\/SyncNos-Webclipper\/actions\/runs\/[1-9]\d*$/.test(value)
  );
}

function currentRepositoryCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function automaticCommandPasses(entry: Evidence, input: Readonly<{ command: string; releaseCommit: string }>): boolean {
  return (
    entry?.command === input.command &&
    entry?.outcome === 'pass' &&
    entry?.commitSha === input.releaseCommit &&
    validObservedAt(entry?.observedAt)
  );
}

function automaticEvidenceReady(evidence: Evidence, expectedCommit: string): boolean {
  if (!validCommitSha(expectedCommit) || evidence.releaseCommit !== expectedCommit) return false;
  const automatic = evidence.automatic;
  if (!automatic || typeof automatic !== 'object') return false;
  if (
    !automaticCommandPasses(automatic.gate, {
      command: AUTOMATIC_COMMANDS.gate,
      releaseCommit: expectedCommit,
    }) ||
    !automaticCommandPasses(automatic.safariCheck, {
      command: AUTOMATIC_COMMANDS.safariCheck,
      releaseCommit: expectedCommit,
    }) ||
    !automaticCommandPasses(automatic.finalBrowserArtifactContract, {
      command: AUTOMATIC_COMMANDS.finalBrowserArtifactContract,
      releaseCommit: expectedCommit,
    })
  ) {
    return false;
  }
  const cli = automatic.threeOsCliPackedInstall;
  return (
    cli?.workflow === CLI_MATRIX_WORKFLOW &&
    cli?.outcome === 'pass' &&
    cli?.commitSha === expectedCommit &&
    validObservedAt(cli?.observedAt) &&
    validActionsRunUrl(cli?.runUrl) &&
    allPass(cli?.checks, THREE_OS_CLI_CHECKS)
  );
}

function desktopEntryPasses(entry: Evidence): boolean {
  if (entry.outcome !== 'pass') return false;
  if (typeof entry.osVersion !== 'string' || !entry.osVersion.trim()) return false;
  if (typeof entry.browserVersion !== 'string' || !entry.browserVersion.trim()) return false;
  if (!validObservedAt(entry.observedAt)) return false;
  if (entry.extensionIdentity !== expectedIdentity(entry.browser)) return false;
  if (!allPass(entry.checks, CHECK_NAMES)) return false;
  if (entry.browser === 'edge' && entry.partnerCenterProductMappingConfirmed !== true) return false;
  if (entry.os === 'windows') {
    if (entry.windowsHost?.launcherKind !== 'pe-shim') return false;
    if (entry.windowsHost?.sendNativeMessageNoResidualProcess !== 'pass') return false;
    if (entry.windowsHost?.connectNativeDisconnectNoResidualProcess !== 'pass') return false;
  }
  return true;
}

function safariPasses(safari: Evidence): boolean {
  return (
    safari.outcome === 'pass' &&
    typeof safari.osVersion === 'string' &&
    Boolean(safari.osVersion.trim()) &&
    typeof safari.browserVersion === 'string' &&
    Boolean(safari.browserVersion.trim()) &&
    validObservedAt(safari.observedAt) &&
    allPass(safari.checks, SAFARI_CHECKS)
  );
}

function regressionPasses(entry: Evidence): boolean {
  return entry.outcome === 'pass' && validObservedAt(entry.observedAt);
}

function manualEvidenceReady(evidence: Evidence): boolean {
  return (
    evidence.desktop.every(desktopEntryPasses) &&
    safariPasses(evidence.safari) &&
    evidence.regressions.every(regressionPasses)
  );
}

function releaseEvidenceReady(evidence: Evidence, expectedCommit: string): boolean {
  return automaticEvidenceReady(evidence, expectedCommit) && manualEvidenceReady(evidence);
}

describe('Local Data release evidence schema', () => {
  it('accepts only real second-precision UTC calendar timestamps', () => {
    expect(validObservedAt('2026-08-17T23:59:59Z')).toBe(true);
    expect(validObservedAt('2024-02-29T00:00:00Z')).toBe(true);
    expect(validObservedAt('2026-02-31T00:00:00Z')).toBe(false);
    expect(validObservedAt('2026-13-01T00:00:00Z')).toBe(false);
    expect(validObservedAt('2026-08-17T24:00:00Z')).toBe(false);
    expect(validObservedAt('2026-08-17T00:00:00.000Z')).toBe(false);
  });

  it('defines exactly nine formal desktop rows and never accepts dev/synthetic identity as a pass', () => {
    const evidence = parseEvidence();
    expect(evidence.schemaVersion).toBe(1);
    const expected = new Set(
      ['macos', 'linux', 'windows'].flatMap((os) => ['chrome', 'edge', 'firefox'].map((browser) => `${os}:${browser}`)),
    );
    const actual = new Set(evidence.desktop.map((entry: Evidence) => `${entry.os}:${entry.browser}`));
    expect(evidence.desktop).toHaveLength(9);
    expect(actual).toEqual(expected);

    for (const entry of evidence.desktop) {
      expect(['macos', 'linux', 'windows']).toContain(entry.os);
      expect(['chrome', 'edge', 'firefox']).toContain(entry.browser);
      expect(['pending', 'pass', 'fail']).toContain(entry.outcome satisfies Outcome);
      expect(Object.keys(entry.checks).sort()).toEqual([...CHECK_NAMES].sort());
      if (entry.outcome === 'pass') expect(desktopEntryPasses(entry)).toBe(true);
      if (typeof entry.extensionIdentity === 'string') {
        expect(entry.extensionIdentity).toBe(expectedIdentity(entry.browser));
      }
      if (entry.browser === 'edge' && entry.outcome === 'pass') {
        expect(entry.partnerCenterProductMappingConfirmed).toBe(true);
      }
    }
  });

  it('requires PE shim and both disconnect-cleanup observations for every passing Windows browser', () => {
    const evidence = parseEvidence();
    const windowsRows = evidence.desktop.filter((entry: Evidence) => entry.os === 'windows');
    expect(windowsRows).toHaveLength(3);
    for (const entry of windowsRows) {
      expect(entry.windowsHost).toBeTruthy();
      expect(JSON.stringify(entry.windowsHost)).not.toMatch(/\.cmd\b/i);
      if (entry.outcome === 'pass') {
        expect(entry.windowsHost).toEqual({
          launcherKind: 'pe-shim',
          sendNativeMessageNoResidualProcess: 'pass',
          connectNativeDisconnectNoResidualProcess: 'pass',
        });
      }
    }
  });

  it('keeps Safari and recovery regressions explicit release blockers until real evidence passes', () => {
    const evidence = parseEvidence();
    expect(Object.keys(evidence.safari.checks).sort()).toEqual([...SAFARI_CHECKS].sort());
    if (evidence.safari.outcome === 'pass') expect(safariPasses(evidence.safari)).toBe(true);

    expect(evidence.regressions.map((entry: Evidence) => entry.name).sort()).toEqual([...REGRESSION_NAMES].sort());
    for (const entry of evidence.regressions) {
      expect(['pending', 'pass', 'fail']).toContain(entry.outcome);
      if (entry.outcome === 'pass') expect(regressionPasses(entry)).toBe(true);
    }
  });

  it('allows strict sandbox to be documented only as pending or explicitly unsupported, never as a formal pass', () => {
    const evidence = parseEvidence();
    expect(['pending', 'unsupported_strict_sandbox']).toContain(evidence.strictSandboxLinux.outcome);
    expect(evidence.strictSandboxLinux.outcome).not.toBe('pass');
  });

  it('derives releaseReady from automatic plus manual evidence and keeps the checked-in pending matrix not ready', () => {
    const evidence = parseEvidence();
    const currentCommit = currentRepositoryCommit();
    expect(evidence.releaseCommit).toBeNull();
    expect(automaticEvidenceReady(evidence, currentCommit)).toBe(false);
    expect(manualEvidenceReady(evidence)).toBe(false);
    expect(evidence.releaseReady).toBe(releaseEvidenceReady(evidence, currentCommit));
    expect(evidence.releaseReady).toBe(false);
  });

  it('rejects the dangerous mutations that could otherwise fake release readiness', () => {
    const evidence = parseEvidence();
    const complete = structuredClone(evidence);
    for (const entry of complete.desktop) {
      entry.outcome = 'pass';
      entry.osVersion = 'test-os';
      entry.browserVersion = 'test-browser';
      entry.observedAt = '2026-08-17T00:00:00Z';
      entry.extensionIdentity = expectedIdentity(entry.browser);
      for (const key of CHECK_NAMES) entry.checks[key] = 'pass';
      if (entry.browser === 'edge') entry.partnerCenterProductMappingConfirmed = true;
      if (entry.os === 'windows') {
        entry.windowsHost = {
          launcherKind: 'pe-shim',
          sendNativeMessageNoResidualProcess: 'pass',
          connectNativeDisconnectNoResidualProcess: 'pass',
        };
      }
    }
    complete.safari = {
      osVersion: 'test-os',
      browserVersion: 'test-safari',
      observedAt: '2026-08-17T00:00:00Z',
      outcome: 'pass',
      checks: Object.fromEntries(SAFARI_CHECKS.map((key) => [key, 'pass'])),
    };
    complete.regressions = REGRESSION_NAMES.map((name) => ({
      name,
      outcome: 'pass',
      observedAt: '2026-08-17T00:00:00Z',
      notes: 'verified',
    }));
    expect(manualEvidenceReady(complete)).toBe(true);
    expect(releaseEvidenceReady(complete, 'a'.repeat(40))).toBe(false);

    const releaseCommit = 'a'.repeat(40);
    complete.releaseCommit = releaseCommit;
    complete.automatic.gate = {
      command: AUTOMATIC_COMMANDS.gate,
      outcome: 'pass',
      observedAt: '2026-08-17T00:00:00Z',
      commitSha: releaseCommit,
    };
    complete.automatic.safariCheck = {
      command: AUTOMATIC_COMMANDS.safariCheck,
      outcome: 'pass',
      observedAt: '2026-08-17T00:00:00Z',
      commitSha: releaseCommit,
    };
    complete.automatic.finalBrowserArtifactContract = {
      command: AUTOMATIC_COMMANDS.finalBrowserArtifactContract,
      outcome: 'pass',
      observedAt: '2026-08-17T00:00:00Z',
      commitSha: releaseCommit,
    };
    complete.automatic.threeOsCliPackedInstall = {
      workflow: CLI_MATRIX_WORKFLOW,
      outcome: 'pass',
      observedAt: '2026-08-17T00:00:00Z',
      commitSha: releaseCommit,
      runUrl: 'https://github.com/SyncNos/SyncNos-Webclipper/actions/runs/123456789',
      checks: Object.fromEntries(THREE_OS_CLI_CHECKS.map((key) => [key, 'pass'])),
    };
    expect(automaticEvidenceReady(complete, releaseCommit)).toBe(true);
    expect(releaseEvidenceReady(complete, releaseCommit)).toBe(true);

    for (const automaticKey of ['gate', 'safariCheck', 'finalBrowserArtifactContract'] as const) {
      const blocked = structuredClone(complete);
      blocked.automatic[automaticKey].outcome = 'pending';
      expect(releaseEvidenceReady(blocked, releaseCommit), automaticKey).toBe(false);
    }

    const onePlatformOnly = structuredClone(complete);
    onePlatformOnly.automatic.threeOsCliPackedInstall.checks.windows = 'pending';
    expect(releaseEvidenceReady(onePlatformOnly, releaseCommit)).toBe(false);

    const fakeWorkflowEvidence = structuredClone(complete);
    fakeWorkflowEvidence.automatic.threeOsCliPackedInstall.runUrl = 'repo-variable:SYNCNOSCLI_CI_PASSED';
    expect(releaseEvidenceReady(fakeWorkflowEvidence, releaseCommit)).toBe(false);

    const staleAutomaticCommit = structuredClone(complete);
    staleAutomaticCommit.automatic.gate.commitSha = 'b'.repeat(40);
    expect(releaseEvidenceReady(staleAutomaticCommit, releaseCommit)).toBe(false);

    const devId = structuredClone(complete);
    devId.desktop[0].extensionIdentity = 'development-extension-id';
    expect(releaseEvidenceReady(devId, releaseCommit)).toBe(false);

    const edgeGuidConfusion = structuredClone(complete);
    const edge = edgeGuidConfusion.desktop.find((entry: Evidence) => entry.browser === 'edge')!;
    edge.extensionIdentity = '00000000-0000-0000-0000-000000000000';
    expect(releaseEvidenceReady(edgeGuidConfusion, releaseCommit)).toBe(false);

    const windowsCmd = structuredClone(complete);
    const windows = windowsCmd.desktop.find((entry: Evidence) => entry.os === 'windows')!;
    windows.windowsHost.launcherKind = '.cmd';
    expect(releaseEvidenceReady(windowsCmd, releaseCommit)).toBe(false);
  });

  it('keeps structured automatic readiness evidence and CI validation wired without treating it as publish authorization', () => {
    const evidence = parseEvidence();
    expect(Object.keys(evidence.automatic).sort()).toEqual(
      ['gate', 'safariCheck', 'threeOsCliPackedInstall', 'finalBrowserArtifactContract'].sort(),
    );
    expect(evidence.automatic.gate.command).toBe(AUTOMATIC_COMMANDS.gate);
    expect(evidence.automatic.safariCheck.command).toBe(AUTOMATIC_COMMANDS.safariCheck);
    expect(evidence.automatic.finalBrowserArtifactContract.command).toBe(
      AUTOMATIC_COMMANDS.finalBrowserArtifactContract,
    );
    expect(evidence.automatic.threeOsCliPackedInstall.workflow).toBe(CLI_MATRIX_WORKFLOW);
    expect(Object.keys(evidence.automatic.threeOsCliPackedInstall.checks).sort()).toEqual(
      [...THREE_OS_CLI_CHECKS].sort(),
    );

    const ci = readFileSync(resolve(repoRoot, '.github/workflows/syncnoscli-ci.yml'), 'utf8');
    expect(ci).toContain('- tests/e2e/**');
    expect(ci).toContain('tests/e2e/local-data-release-evidence.test.ts');
    expect(ci).toContain('os: [ubuntu-latest, macos-latest, windows-latest]');
    const markdown = readFileSync(matrixPath, 'utf8');
    expect(markdown).toMatch(/local run, repository variable, or single-platform result is not equivalent evidence/i);
    expect(markdown).toMatch(/not npm publish authorization/i);
  });
});
