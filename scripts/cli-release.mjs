#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)(?:\.?([1-9]\d*))?)?$/;
const CHANNEL_RANK = Object.freeze({ alpha: 0, beta: 1, rc: 2, stable: 3 });

function fail(message) {
  throw new Error(message);
}

export function parseReleaseVersion(version) {
  const text = String(version || '').trim();
  const match = VERSION_PATTERN.exec(text);
  if (!match) fail(`unsupported release version: ${text || '(empty)'}`);
  const channel = match[4] || 'stable';
  return {
    raw: text,
    core: match.slice(1, 4).map(Number),
    channel,
    serial: match[5] ? Number(match[5]) : 0,
  };
}

export function parseReleaseTag(tag) {
  const text = String(tag || '').trim();
  if (!text.startsWith('v')) fail(`unsupported release tag: ${text || '(empty)'}`);
  const parsed = parseReleaseVersion(text.slice(1));
  return {
    tag: text,
    version: parsed.raw,
    channel: parsed.channel,
    npmDistTag: parsed.channel === 'stable' ? 'latest' : parsed.channel,
    githubPrerelease: parsed.channel !== 'stable',
  };
}

export function compareReleaseVersions(leftRaw, rightRaw) {
  const left = typeof leftRaw === 'string' ? parseReleaseVersion(leftRaw) : leftRaw;
  const right = typeof rightRaw === 'string' ? parseReleaseVersion(rightRaw) : rightRaw;
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
  }
  if (left.channel !== right.channel) {
    return CHANNEL_RANK[left.channel] < CHANNEL_RANK[right.channel] ? -1 : 1;
  }
  if (left.serial === right.serial) return 0;
  return left.serial < right.serial ? -1 : 1;
}

export function assertReleaseOrder(candidateRaw, distTags = {}) {
  const candidate = parseReleaseVersion(candidateRaw);
  for (const label of ['latest', 'alpha', 'beta', 'rc']) {
    const existing = String(distTags?.[label] || '').trim();
    if (!existing) continue;
    if (compareReleaseVersions(candidate, parseReleaseVersion(existing)) <= 0) {
      fail(`${candidate.raw} must be newer than npm ${label} ${existing}`);
    }
  }
  return true;
}

function selfTest() {
  const stable = parseReleaseTag('v1.2.3');
  if (stable.npmDistTag !== 'latest' || stable.githubPrerelease) fail('stable metadata self-test failed');
  const beta = parseReleaseTag('v1.3.0-beta.2');
  if (beta.npmDistTag !== 'beta' || !beta.githubPrerelease) fail('beta metadata self-test failed');
  assertReleaseOrder('1.3.0-alpha.1', { latest: '1.2.3' });
  assertReleaseOrder('1.3.0-beta.1', { latest: '1.2.3', alpha: '1.3.0-alpha.3' });
  assertReleaseOrder('1.3.0-rc1', { latest: '1.2.3', beta: '1.3.0-beta.4' });
  assertReleaseOrder('1.3.0', { latest: '1.2.3', rc: '1.3.0-rc2' });
  let rejected = false;
  try {
    assertReleaseOrder('1.3.0-beta.1', { rc: '1.3.0-rc1' });
  } catch {
    rejected = true;
  }
  if (!rejected) fail('release order rejection self-test failed');
  process.stdout.write('SyncNos CLI release metadata self-test OK\n');
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === '--self-test') return selfTest();
  if (command === 'metadata' && args.length === 1) {
    process.stdout.write(`${JSON.stringify(parseReleaseTag(args[0]))}\n`);
    return;
  }
  if (command === 'check-order' && args.length === 2) {
    const distTags = JSON.parse(readFileSync(args[1], 'utf8'));
    assertReleaseOrder(args[0], distTags);
    process.stdout.write(`release order OK: ${args[0]}\n`);
    return;
  }
  fail('usage: cli-release.mjs metadata <tag> | check-order <version> <dist-tags.json> | --self-test');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`error: ${error?.message || String(error)}\n`);
    process.exitCode = 2;
  }
}
