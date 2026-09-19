import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { init, parse } from 'es-module-lexer';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';

function normalizeDisplayPath(root, path) {
  return relative(root, path).split(sep).join('/');
}

function isWithinRoot(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function stripUrlSuffix(value) {
  return String(value || '').split(/[?#]/, 1)[0];
}

function assertLocalSpecifier(specifier, label) {
  const value = String(specifier || '').trim();
  if (!value) throw new Error(`${label} is empty`);
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith('//')) {
    throw new Error(`${label} must be local: ${value}`);
  }
  if (!value.startsWith('.') && !value.startsWith('/')) {
    throw new Error(`${label} must not use a bare specifier: ${value}`);
  }
  return value;
}

export function resolveDistAsset(root, specifier, fromPath, label = 'asset') {
  const localSpecifier = assertLocalSpecifier(specifier, label);
  const pathPart = stripUrlSuffix(localSpecifier);
  if (!pathPart) throw new Error(`${label} has no local path: ${localSpecifier}`);

  const resolved = localSpecifier.startsWith('/')
    ? resolve(root, `.${pathPart}`)
    : resolve(dirname(fromPath), pathPart);
  if (!isWithinRoot(root, resolved)) {
    throw new Error(`${label} escapes dist root: ${localSpecifier}`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`${label} missing: ${normalizeDisplayPath(root, resolved)}`);
  }
  return resolved;
}

export function resolvePopupAssets(root, manifest) {
  const popupSpecifier = String(manifest?.action?.default_popup || '').trim();
  if (!popupSpecifier) throw new Error('action.default_popup missing');
  const popupHtml = resolveDistAsset(
    root,
    `/${popupSpecifier.replace(/^\/+/, '')}`,
    resolve(root, 'manifest.json'),
    'popup HTML',
  );
  const dom = new JSDOM(readFileSync(popupHtml, 'utf8'));
  const document = dom.window.document;

  const moduleScripts = [...document.querySelectorAll('script[type="module"][src]')];
  if (moduleScripts.length !== 1) {
    throw new Error(`Popup HTML must contain exactly one module script with src; found ${moduleScripts.length}`);
  }

  const entry = resolveDistAsset(root, moduleScripts[0].getAttribute('src'), popupHtml, 'Popup module entry');
  const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((link) =>
    resolveDistAsset(root, link.getAttribute('href'), popupHtml, 'Popup stylesheet'),
  );
  const modulePreloads = [...document.querySelectorAll('link[rel~="modulepreload"][href]')].map((link) =>
    resolveDistAsset(root, link.getAttribute('href'), popupHtml, 'Popup modulepreload'),
  );

  return {
    popupHtml,
    entry,
    stylesheets: [...new Set(stylesheets)],
    modulePreloads: [...new Set(modulePreloads)],
  };
}

async function parseJavaScriptModule(root, file, options = {}) {
  await init;
  const source = readFileSync(file, 'utf8');
  const [records] = parse(source);
  const staticImports = [];
  const dynamicImports = [];

  const resolveImport = (specifier, label) => {
    const value = String(specifier || '').trim();
    if (options.localOnly && !value.startsWith('.') && !value.startsWith('/')) return null;
    return resolveDistAsset(root, value, file, label);
  };

  for (const record of records) {
    if (record.d === -2) continue;
    if (record.d === -1) {
      if (typeof record.n !== 'string') {
        throw new Error(
          `Static import cannot be resolved in ${normalizeDisplayPath(root, file)} at offset ${record.ss}`,
        );
      }
      const dependency = resolveImport(record.n, 'Static module import');
      if (dependency) staticImports.push(dependency);
      continue;
    }
    if (record.d >= 0) {
      if (typeof record.n !== 'string') {
        if (options.allowUnknownDynamic) continue;
        throw new Error(
          `Dynamic import must use a string literal in ${normalizeDisplayPath(root, file)} at offset ${record.ss}`,
        );
      }
      const dependency = resolveImport(record.n, 'Dynamic module import');
      if (dependency) dynamicImports.push(dependency);
    }
  }

  return { file, source, staticImports, dynamicImports };
}

async function collectModuleClosure(root, entries, options = {}) {
  const queue = [...new Set(entries)];
  const visited = new Set();
  const modules = new Map();

  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);

    const moduleInfo = await parseJavaScriptModule(root, file);
    modules.set(file, moduleInfo);
    if (options.forbidDynamicImports && moduleInfo.dynamicImports.length) {
      throw new Error(
        `Dynamic import is not allowed in ${normalizeDisplayPath(root, file)}: ${moduleInfo.dynamicImports
          .map((item) => normalizeDisplayPath(root, item))
          .join(', ')}`,
      );
    }
    for (const dependency of moduleInfo.staticImports) {
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }

  const files = [...visited];
  return {
    files,
    modules,
    bytes: files.reduce((total, file) => total + statSync(file).size, 0),
  };
}

export async function collectStaticModuleClosure(root, entries, options = {}) {
  return collectModuleClosure(root, entries, options);
}

export function resolveHtmlModuleEntries(root) {
  const entries = new Map();
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isFile() || !dirent.name.endsWith('.html')) continue;
    const htmlPath = resolve(root, dirent.name);
    const dom = new JSDOM(readFileSync(htmlPath, 'utf8'));
    const scripts = [...dom.window.document.querySelectorAll('script[type="module"][src]')].map((script) =>
      resolveDistAsset(root, script.getAttribute('src'), htmlPath, `${dirent.name} module entry`),
    );
    if (scripts.length) entries.set(htmlPath, [...new Set(scripts)]);
  }
  return entries;
}

function listJavaScriptFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, dirent.name);
      if (dirent.isDirectory()) visit(path);
      else if (dirent.isFile() && dirent.name.endsWith('.js')) files.push(path);
    }
  };
  visit(root);
  return files;
}

export async function assertHtmlModuleEntriesAreRoots(root) {
  const htmlEntries = resolveHtmlModuleEntries(root);
  const entryFiles = new Set([...htmlEntries.values()].flat());

  for (const file of listJavaScriptFiles(root)) {
    const moduleInfo = await parseJavaScriptModule(root, file, {
      allowUnknownDynamic: true,
      localOnly: true,
    });
    for (const dependency of [...moduleInfo.staticImports, ...moduleInfo.dynamicImports]) {
      if (!entryFiles.has(dependency) || dependency === file) continue;
      throw new Error(
        `HTML module entry must remain a graph root: ${normalizeDisplayPath(root, dependency)} is imported by ${normalizeDisplayPath(root, file)}`,
      );
    }
  }
}

export function inspectStartupStylesheets(root, files) {
  const uniqueFiles = [...new Set(files)];
  for (const file of uniqueFiles) {
    const css = readFileSync(file, 'utf8');
    const parsed = postcss.parse(css, { from: file });
    parsed.walkAtRules('import', (rule) => {
      throw new Error(
        `Popup startup stylesheet must not contain @import: ${normalizeDisplayPath(root, file)} at ${rule.source?.start?.line || '?'}:${rule.source?.start?.column || '?'}`,
      );
    });
  }
  return {
    files: uniqueFiles,
    bytes: uniqueFiles.reduce((total, file) => total + statSync(file).size, 0),
  };
}

export async function analyzePopupStartup(root, manifest) {
  const assets = resolvePopupAssets(root, manifest);
  await assertHtmlModuleEntriesAreRoots(root);
  const bootstrap = await collectStaticModuleClosure(root, [assets.entry]);
  const entryInfo = bootstrap.modules.get(assets.entry);
  const directDynamicImports = entryInfo?.dynamicImports ?? [];
  if (directDynamicImports.length !== 1) {
    throw new Error(
      `Popup bootstrap must contain exactly one direct dynamic import; found ${directDynamicImports.length}`,
    );
  }

  const bootstrapSet = new Set(bootstrap.files);
  for (const preload of assets.modulePreloads) {
    if (!bootstrapSet.has(preload)) {
      throw new Error(`Popup modulepreload bypasses bootstrap static closure: ${normalizeDisplayPath(root, preload)}`);
    }
  }

  const renderTarget = directDynamicImports[0];
  const render = await collectStaticModuleClosure(root, [renderTarget]);
  const immediateFiles = [...new Set([...bootstrap.files, ...render.files])];
  const startupStyles = inspectStartupStylesheets(root, assets.stylesheets);

  return {
    ...assets,
    renderTarget,
    bootstrapFiles: bootstrap.files,
    bootstrapBytes: bootstrap.bytes,
    immediateFiles,
    immediateBytes: immediateFiles.reduce((total, file) => total + statSync(file).size, 0),
    startupStylesheetFiles: startupStyles.files,
    startupStylesheetBytes: startupStyles.bytes,
  };
}

export function resolveBackgroundEntries(manifest) {
  const background = manifest?.background;
  if (!background || typeof background !== 'object' || Array.isArray(background)) {
    throw new Error('manifest.background missing');
  }

  const serviceWorker = String(background.service_worker || '').trim();
  const scripts = Array.isArray(background.scripts)
    ? background.scripts.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (serviceWorker && scripts.length) {
    throw new Error('background.service_worker and background.scripts must not both be present');
  }
  if (!serviceWorker && !scripts.length) {
    throw new Error('background.service_worker or non-empty background.scripts is required');
  }
  if (scripts.length !== new Set(scripts).size) {
    throw new Error('background.scripts must not contain duplicate entries');
  }

  return serviceWorker ? [serviceWorker] : scripts;
}

export function resolveBackgroundMode(manifest) {
  const raw = String(manifest?.background?.type || '').trim();
  if (!raw || raw === 'classic') return 'classic';
  if (raw === 'module') return 'module';
  throw new Error(`Unsupported background.type: ${raw}`);
}

export async function analyzeBackgroundRuntime(root, manifest) {
  const entries = resolveBackgroundEntries(manifest).map((entry) =>
    resolveDistAsset(root, `/${entry.replace(/^\/+/, '')}`, resolve(root, 'manifest.json'), 'Background entry'),
  );
  const mode = resolveBackgroundMode(manifest);

  if (mode === 'classic') {
    const files = [];
    for (const entry of entries) {
      const moduleInfo = await parseJavaScriptModule(root, entry);
      if (moduleInfo.staticImports.length) {
        throw new Error(`Classic background must not contain ESM static imports: ${normalizeDisplayPath(root, entry)}`);
      }
      if (moduleInfo.dynamicImports.length) {
        throw new Error(`Background runtime dynamic import is not supported: ${normalizeDisplayPath(root, entry)}`);
      }
      files.push(entry);
    }
    const uniqueFiles = [...new Set(files)];
    return {
      mode,
      entries,
      files: uniqueFiles,
      bytes: uniqueFiles.reduce((total, file) => total + statSync(file).size, 0),
    };
  }

  const closure = await collectStaticModuleClosure(root, entries, { forbidDynamicImports: true });
  return {
    mode,
    entries,
    files: closure.files,
    bytes: closure.bytes,
  };
}

export function formatDistPaths(root, files) {
  return files.map((file) => normalizeDisplayPath(root, file));
}
