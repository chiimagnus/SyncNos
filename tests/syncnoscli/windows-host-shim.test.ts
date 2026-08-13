import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '../../packages/syncnoscli');
const sourcePath = resolve(packageRoot, 'native-host-shim/win32/main.c');
const manifestPath = resolve(packageRoot, 'prebuilds/manifest.json');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function peMachine(bytes: Buffer): number {
  expect(bytes.subarray(0, 2).toString('ascii')).toBe('MZ');
  const peOffset = bytes.readUInt32LE(0x3c);
  expect(bytes.subarray(peOffset, peOffset + 4).toString('ascii')).toBe('PE\0\0');
  return bytes.readUInt16LE(peOffset + 4);
}

function peSubsystem(bytes: Buffer): number {
  const peOffset = bytes.readUInt32LE(0x3c);
  return bytes.readUInt16LE(peOffset + 24 + 68);
}

describe('Windows Native Host shim prebuilds', () => {
  it('pins source and both real PE architectures in the package manifest', async () => {
    const source = await readFile(sourcePath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      sourceSha256: string;
      artifacts: Record<string, { file: string; sha256: string }>;
    };
    const x64 = await readFile(resolve(packageRoot, 'prebuilds', manifest.artifacts['win32-x64'].file));
    const arm64 = await readFile(resolve(packageRoot, 'prebuilds', manifest.artifacts['win32-arm64'].file));

    expect(manifest.sourceSha256).toBe(sha256(source));
    expect(manifest.artifacts['win32-x64'].sha256).toBe(sha256(x64));
    expect(manifest.artifacts['win32-arm64'].sha256).toBe(sha256(arm64));
    expect(
      Object.values(manifest.artifacts)
        .map((artifact) => artifact.file)
        .sort(),
    ).toEqual(['win32-arm64/syncnos-native-host.exe', 'win32-x64/syncnos-native-host.exe']);
    expect(JSON.stringify(manifest)).not.toMatch(/\.(?:cmd|bat)\b/i);
    expect(peMachine(x64)).toBe(0x8664);
    expect(peMachine(arm64)).toBe(0xaa64);
    expect(peSubsystem(x64)).toBe(2);
    expect(peSubsystem(arm64)).toBe(2);
  });

  it('uses a module-relative, config-bound child process without shell or job-breakaway escape hatches', async () => {
    const source = await readFile(sourcePath, 'utf8');
    const buildScript = await readFile(resolve(packageRoot, 'scripts/build-windows-host-shim.ps1'), 'utf8');

    expect(source).toContain('GetModuleFileNameW(NULL, path, capacity)');
    expect(source).toContain('owned_runtime_parent(module_path)');
    expect(source).toContain('join_path(runtime_directory, L"native-host-launcher-v1.json")');
    expect(source).toContain('CryptStringToBinaryA');
    expect(source).toContain('sha256_file(module_path, actual_prebuilt_digest)');
    expect(source).toContain('sha256_file(entrypoint_path, actual_package_digest)');
    expect(source).toContain('CreateProcessW(node_path, command.data, NULL, NULL, TRUE, 0, NULL, package_root');
    expect(source).toContain('CommandLineToArgvW(GetCommandLineW(), &argument_count)');
    expect(source).toContain('WaitForSingleObject(process.hProcess, INFINITE)');
    expect(source).toContain('STARTF_USESTDHANDLES');
    expect(source).not.toMatch(
      /cmd\.exe|CREATE_BREAKAWAY_FROM_JOB|SearchPath|GetEnvironmentVariable|printf|puts|fprintf/i,
    );
    expect(buildScript).toContain("'x86_64-windows-gnu'");
    expect(buildScript).toContain("'aarch64-windows-gnu'");
    expect(buildScript).toContain('-Wl,--subsystem,windows');
    expect(buildScript).toContain('[System.IO.File]::WriteAllText');
    expect(buildScript).not.toContain('utf8NoBOM');
  });
});
