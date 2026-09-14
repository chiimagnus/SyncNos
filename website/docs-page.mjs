function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function navHtml(items, currentRoute, basePath) {
  return items
    .map((item) => {
      if (item.type === 'group') {
        return `<div class="docs-nav-group"><div class="docs-nav-label">${escapeHtml(item.title)}</div>${navHtml(item.items, currentRoute, basePath)}</div>`;
      }
      const active = item.route === currentRoute ? ' aria-current="page" class="active"' : '';
      return `<a href="${basePath}${item.route}"${active}>${escapeHtml(item.title)}</a>`;
    })
    .join('');
}

function tocHtml(headings, language) {
  if (!headings.length) return '';
  const title = language.id === 'zh' ? '本页目录' : 'On this page';
  return `<aside class="docs-toc"><div class="docs-toc-title">${title}</div>${headings
    .map((heading) => `<a class="level-${heading.level}" href="#${heading.id}">${escapeHtml(heading.text)}</a>`)
    .join('')}</aside>`;
}

function mobileNavHtml(items, currentRoute, language, basePath) {
  const label = language.id === 'zh' ? '文档导航' : 'Docs navigation';
  return `<details class="docs-mobile-nav"><summary>${label}</summary><nav>${navHtml(items, currentRoute, basePath)}</nav></details>`;
}

export function renderDocsPage({ page, tree, language, rendered, counterpartRoute, basePath, siteOrigin, repo }) {
  const editLabel = language.id === 'zh' ? '在 GitHub 查看 Markdown' : 'View Markdown on GitHub';
  const title = `${page.title} · SyncNos Docs`;
  const canonical = `${siteOrigin}${basePath}${page.route}`;
  const sourceUrl = `${repo}/blob/main/website/content/docs/${language.id}/${page.relativePath}`;
  const counterpart = `${basePath}${counterpartRoute}`;

  return `<!doctype html>
<html lang="${language.id === 'zh' ? 'zh-CN' : 'en'}" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="${basePath}/assets/icon-128.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&family=Noto+Serif+SC:wght@500;600;700&display=swap" rel="stylesheet" />
    <meta name="theme-color" content="#fbf8f3" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0f141c" media="(prefers-color-scheme: dark)" />
    <meta name="color-scheme" content="light dark" />
    <script src="${basePath}/theme.js"></script>
    <link rel="stylesheet" href="${basePath}/styles.css" />
    <link rel="stylesheet" href="${basePath}/docs.css" />
  </head>
  <body>
    <div class="site-glow docs-site-shell">
      <div data-site-header="docs" data-lang="${language.id}" data-counterpart="${counterpart}"></div>
      <script src="${basePath}/site-header.js"></script>
      ${mobileNavHtml(tree.items, page.route, language, basePath)}
      <div class="docs-layout">
        <aside class="docs-sidebar"><nav>${navHtml(tree.items, page.route, basePath)}</nav></aside>
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
    </div>
    <script src="${basePath}/docs.js"></script>
  </body>
</html>`;
}
