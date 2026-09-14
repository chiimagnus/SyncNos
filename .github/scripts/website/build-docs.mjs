import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WEBSITE = path.join(ROOT, 'website');
const OUTPUT = path.join(WEBSITE, '.site');
const CONTENT = path.join(WEBSITE, 'content', 'docs');
const BASE_PATH = '/SyncNos';
const SITE_ORIGIN = 'https://chiimagnus.github.io';
const REPO = 'https://github.com/chiimagnus/SyncNos';

const PROJECT_ASSETS = [
  ['public/icons/icon-128.png', 'assets/icon-128.png'],
  ['public/icons/notion.svg', 'assets/notion.svg'],
  ['public/icons/obsidian.svg', 'assets/obsidian.svg'],
  ['public/icons/feishu.svg', 'assets/feishu.svg'],
  ['public/icons/github.svg', 'assets/github.svg'],
  ['docs/assets/popup-screenshots.png', 'assets/product/popup-screenshots.png'],
  ['docs/assets/comments-discussion.png', 'assets/product/comments-discussion.png'],
  ['docs/assets/obsidian/obsidian-copy-api-key.png', 'assets/docs/obsidian/obsidian-copy-api-key.png'],
  ['docs/assets/obsidian/obsidian-enable-insecure-http.png', 'assets/docs/obsidian/obsidian-enable-insecure-http.png'],
  ['docs/assets/obsidian/obsidian-install-plugin.png', 'assets/docs/obsidian/obsidian-install-plugin.png'],
];

const LANGUAGES = [
  { id: 'zh', source: path.join(CONTENT, 'zh'), route: '/docs' },
  { id: 'en', source: path.join(CONTENT, 'en'), route: '/docs/en' },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseFrontmatter(source) {
  const normalized = String(source).replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return { data: {}, body: normalized };
  const data = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const index = line.indexOf(':');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: normalized.slice(end + 5) };
}

function slugify(value) {
  return (
    String(value)
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function routeFor(baseRoute, relativePath) {
  const withoutExt = relativePath.replace(/\.md$/i, '').replaceAll(path.sep, '/');
  const tail = withoutExt === 'index' ? '' : withoutExt.replace(/\/index$/, '');
  return `${baseRoute}/${tail}`.replace(/\/+$/, '') + '/';
}

function outputPathFor(route) {
  const relative = route.replace(/^\/docs\/?/, 'docs/');
  return path.join(OUTPUT, relative, 'index.html');
}

function counterpartRouteFor(page, language) {
  const stem = page.relativePath.replace(/\.md$/i, '');
  const tail = stem === 'index' ? '' : stem.replace(/\/index$/, '');
  const base = language.id === 'zh' ? '/docs/en' : '/docs';
  return `${base}/${tail}`.replace(/\/+$/, '') + '/';
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function loadTree(language) {
  async function loadDirectory(dir, relativeDir = '') {
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
    const items = [];
    for (const entry of meta.pages || []) {
      const childDir = path.join(dir, entry);
      if (await isDirectory(childDir)) {
        const child = await loadDirectory(childDir, path.join(relativeDir, entry));
        items.push({ type: 'group', title: child.title || entry, items: child.items });
        continue;
      }
      const relativePath = path.join(relativeDir, `${entry}.md`);
      const source = await readFile(path.join(language.source, relativePath), 'utf8');
      const { data, body } = parseFrontmatter(source);
      const route = routeFor(language.route, relativePath);
      items.push({
        type: 'page',
        title: data.title || entry,
        description: data.description || '',
        relativePath: relativePath.replaceAll(path.sep, '/'),
        route,
        body,
      });
    }
    return { title: meta.title || '', items };
  }
  return loadDirectory(language.source);
}

function flattenPages(items) {
  return items.flatMap((item) => (item.type === 'page' ? [item] : flattenPages(item.items)));
}

function navHtml(items, currentRoute) {
  return items
    .map((item) => {
      if (item.type === 'group') {
        return `<div class="docs-nav-group"><div class="docs-nav-label">${escapeHtml(item.title)}</div>${navHtml(item.items, currentRoute)}</div>`;
      }
      const active = item.route === currentRoute ? ' aria-current="page" class="active"' : '';
      return `<a href="${BASE_PATH}${item.route}"${active}>${escapeHtml(item.title)}</a>`;
    })
    .join('');
}

function createMarkdownRenderer() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const defaultLinkOpen =
    md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const hrefIndex = tokens[idx].attrIndex('href');
    if (hrefIndex >= 0) {
      const href = tokens[idx].attrs[hrefIndex][1];
      if (href.startsWith('/docs/')) tokens[idx].attrs[hrefIndex][1] = `${BASE_PATH}${href}`;
      else if (href === '/docs') tokens[idx].attrs[hrefIndex][1] = `${BASE_PATH}/docs/`;
      else if (/^https?:\/\//i.test(href)) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noreferrer');
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  const defaultImage =
    md.renderer.rules.image || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const srcIndex = tokens[idx].attrIndex('src');
    if (srcIndex >= 0) {
      const src = tokens[idx].attrs[srcIndex][1];
      if (src.startsWith('/assets/')) tokens[idx].attrs[srcIndex][1] = `${BASE_PATH}${src}`;
    }
    tokens[idx].attrSet('loading', 'lazy');
    return defaultImage(tokens, idx, options, env, self);
  };

  return md;
}

function renderMarkdown(body) {
  const headings = [];
  const md = createMarkdownRenderer();
  const tokens = md.parse(body, {});
  const used = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;
    const level = Number(token.tag.slice(1));
    const inline = tokens[i + 1];
    const text = inline?.type === 'inline' ? inline.content : '';
    const base = slugify(text);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    const id = count ? `${base}-${count + 1}` : base;
    token.attrSet('id', id);
    if (level === 2 || level === 3) headings.push({ level, text, id });
  }
  return { html: md.renderer.render(tokens, md.options, {}), headings };
}

function tocHtml(headings, language) {
  if (!headings.length) return '';
  const title = language.id === 'zh' ? '本页目录' : 'On this page';
  return `<aside class="docs-toc"><div class="docs-toc-title">${title}</div>${headings
    .map((heading) => `<a class="level-${heading.level}" href="#${heading.id}">${escapeHtml(heading.text)}</a>`)
    .join('')}</aside>`;
}

function mobileNavHtml(items, currentRoute, language) {
  const label = language.id === 'zh' ? '文档导航' : 'Docs navigation';
  return `<details class="docs-mobile-nav"><summary>${label}</summary><nav>${navHtml(items, currentRoute)}</nav></details>`;
}

function pageHtml({ page, tree, language }) {
  const rendered = renderMarkdown(page.body);
  const counterpartRoute = counterpartRouteFor(page, language);
  const languageLabel = language.id === 'zh' ? 'English' : '中文';
  const editLabel = language.id === 'zh' ? '在 GitHub 查看 Markdown' : 'View Markdown on GitHub';
  const homeLabel = language.id === 'zh' ? '官网' : 'Home';
  const title = `${page.title} · SyncNos Docs`;
  const canonical = `${SITE_ORIGIN}${BASE_PATH}${page.route}`;
  const sourceUrl = `${REPO}/blob/main/website/content/docs/${language.id}/${page.relativePath}`;
  return `<!doctype html>
<html lang="${language.id === 'zh' ? 'zh-CN' : 'en'}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="${BASE_PATH}/assets/icon-128.png" />
    <link rel="stylesheet" href="${BASE_PATH}/docs.css" />
  </head>
  <body>
    <header class="docs-header">
      <a class="docs-brand" href="${BASE_PATH}/"><img src="${BASE_PATH}/assets/icon-128.png" alt="" /> <span>SyncNos Docs</span></a>
      <nav class="docs-header-links">
        <a href="${BASE_PATH}/">${homeLabel}</a>
        <a href="${REPO}">GitHub</a>
        <a href="${BASE_PATH}${counterpartRoute}">${languageLabel}</a>
      </nav>
    </header>
    ${mobileNavHtml(tree.items, page.route, language)}
    <div class="docs-layout">
      <aside class="docs-sidebar"><nav>${navHtml(tree.items, page.route)}</nav></aside>
      <main class="docs-main">
        <div class="docs-heading">
          <h1>${escapeHtml(page.title)}</h1>
          ${page.description ? `<p>${escapeHtml(page.description)}</p>` : ''}
          <a class="docs-source" href="${sourceUrl}">${editLabel}</a>
        </div>
        <article class="docs-prose">${rendered.html}</article>
      </main>
      ${tocHtml(rendered.headings, language)}
    </div>
  </body>
</html>`;
}

async function copyStaticWebsite() {
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });
  for (const entry of await readdir(WEBSITE, { withFileTypes: true })) {
    if (entry.name === '.site' || entry.name === 'content' || entry.name === '.gitignore') continue;
    await cp(path.join(WEBSITE, entry.name), path.join(OUTPUT, entry.name), { recursive: true });
  }
}

async function copyProjectAssets() {
  for (const [sourceRelative, outputRelative] of PROJECT_ASSETS) {
    const source = path.join(ROOT, sourceRelative);
    const output = path.join(OUTPUT, outputRelative);
    await mkdir(path.dirname(output), { recursive: true });
    await cp(source, output);
  }
}

async function appendDocsToSitemap(pages) {
  const sitemapPath = path.join(OUTPUT, 'sitemap.xml');
  let sitemap = await readFile(sitemapPath, 'utf8');
  const entries = pages
    .map((page) => `  <url>\n    <loc>${SITE_ORIGIN}${BASE_PATH}${page.route}</loc>\n  </url>`)
    .join('\n');
  sitemap = sitemap.replace(/\s*<\/urlset>\s*$/, `\n${entries}\n</urlset>\n`);
  await writeFile(sitemapPath, sitemap);
}

async function main() {
  await copyStaticWebsite();
  await copyProjectAssets();
  const allPages = [];
  for (const language of LANGUAGES) {
    const tree = await loadTree(language);
    const pages = flattenPages(tree.items);
    allPages.push(...pages);
    for (const page of pages) {
      const out = outputPathFor(page.route);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, pageHtml({ page, tree, language }));
    }
  }
  await appendDocsToSitemap(allPages);
  console.log(`Built ${allPages.length} docs pages into ${path.relative(ROOT, OUTPUT)}`);
}

await main();
