import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';

import { contract } from './contract.mjs';

export const CHROME_PRODUCTION_EXTENSION_ID = 'hmgjflllphdffeocddjjcfllifhejpok';
export const FIREFOX_PRODUCTION_EXTENSION_ID = 'syncnos-webclipper@syncnos.app';
export const NATIVE_HOST_MANIFEST_FILENAME = `${contract.nativeHostName}.json`;

const TARGETS = Object.freeze({
  chrome: Object.freeze({
    id: 'chrome',
    name: 'Google Chrome',
    manifestRelativeDir: 'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    allowlistField: 'allowed_origins',
    productionExtensionId: CHROME_PRODUCTION_EXTENSION_ID,
  }),
  firefox: Object.freeze({
    id: 'firefox',
    name: 'Mozilla Firefox',
    manifestRelativeDir: 'Library/Application Support/Mozilla/NativeMessagingHosts',
    allowlistField: 'allowed_extensions',
    productionExtensionId: FIREFOX_PRODUCTION_EXTENSION_ID,
  }),
});

function targetError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeBrowser(browser) {
  return String(browser || '')
    .trim()
    .toLowerCase();
}

function hasWhitespaceOrControl(value) {
  for (const char of String(value || '')) {
    const code = char.codePointAt(0) ?? 0;
    if (/\s/.test(char) || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeExtensionId(target, extensionId) {
  const value = String(extensionId == null ? target.productionExtensionId : extensionId).trim();
  if (!value) throw targetError('invalid_extension_id', 'Extension id is required');
  if (target.id === 'chrome' && !/^[a-p]{32}$/.test(value)) {
    throw targetError('invalid_extension_id', 'Chrome extension id must be 32 lowercase a-p characters');
  }
  if (target.id === 'firefox' && (value.length > 255 || hasWhitespaceOrControl(value))) {
    throw targetError('invalid_extension_id', 'Firefox extension id is invalid');
  }
  return value;
}

export function listBrowserTargets() {
  return Object.keys(TARGETS);
}

export function resolveBrowserTarget(browser, { homeDir, extensionId } = {}) {
  const id = normalizeBrowser(browser);
  const target = TARGETS[id];
  if (!target) throw targetError('unsupported_browser', `Unsupported browser target: ${id || '(empty)'}`);
  const homeInput = String(homeDir || process.env.HOME || '').trim();
  if (!homeInput) throw targetError('home_unavailable', 'Home directory is unavailable');
  const home = resolve(homeInput);
  const resolvedExtensionId = normalizeExtensionId(target, extensionId);
  const manifestDir = resolve(home, target.manifestRelativeDir);
  const manifestPath = resolve(manifestDir, NATIVE_HOST_MANIFEST_FILENAME);
  const allowlist = target.id === 'chrome' ? [`chrome-extension://${resolvedExtensionId}/`] : [resolvedExtensionId];
  return {
    ...target,
    extensionId: resolvedExtensionId,
    productionIdentity: resolvedExtensionId === target.productionExtensionId,
    manifestDir,
    manifestPath,
    allowlist,
  };
}

export function buildNativeHostManifest(target, launcherPath) {
  if (!target || !target.id) throw targetError('unsupported_browser', 'Browser target is required');
  const launcher = String(launcherPath || '').trim();
  if (!isAbsolute(launcher)) {
    throw targetError('launcher_path_invalid', 'Native host launcher path must be absolute');
  }
  const path = resolve(launcher);
  const base = {
    name: contract.nativeHostName,
    description: 'SyncNos local CLI bridge',
    path,
    type: 'stdio',
  };
  if (target.id === 'chrome') return { ...base, allowed_origins: [...target.allowlist] };
  if (target.id === 'firefox') return { ...base, allowed_extensions: [...target.allowlist] };
  throw targetError('unsupported_browser', `Unsupported browser target: ${target.id}`);
}

export function validateNativeHostManifest(target, manifest, launcherPath) {
  const issues = [];
  const value = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : null;
  if (!value) return { valid: false, issues: ['manifest_not_object'], productionIdentity: false };
  const expectedKeys =
    target.id === 'chrome'
      ? ['allowed_origins', 'description', 'name', 'path', 'type']
      : ['allowed_extensions', 'description', 'name', 'path', 'type'];
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) issues.push('manifest_schema');
  if (value.name !== contract.nativeHostName) issues.push('host_name');
  if (value.type !== 'stdio') issues.push('host_type');
  if (typeof value.description !== 'string' || !value.description.trim()) issues.push('description');
  const manifestPath = String(value.path || '').trim();
  const expectedLauncherPath = String(launcherPath || '').trim();
  if (
    !isAbsolute(manifestPath) ||
    !isAbsolute(expectedLauncherPath) ||
    resolve(manifestPath) !== resolve(expectedLauncherPath)
  ) {
    issues.push('launcher_path');
  }

  const allowlist = value[target.allowlistField];
  let allowlistValid = Array.isArray(allowlist) && allowlist.length === 1 && typeof allowlist[0] === 'string';
  if (allowlistValid && target.id === 'chrome') {
    allowlistValid = /^chrome-extension:\/\/[a-p]{32}\/$/.test(allowlist[0]);
  }
  if (allowlistValid && target.id === 'firefox') {
    allowlistValid = !!allowlist[0].trim() && !hasWhitespaceOrControl(allowlist[0]);
  }
  if (!allowlistValid) issues.push('allowlist');
  const productionIdentity =
    allowlistValid &&
    allowlist[0] ===
      (target.id === 'chrome' ? `chrome-extension://${target.productionExtensionId}/` : target.productionExtensionId);
  return { valid: issues.length === 0, issues, productionIdentity };
}
