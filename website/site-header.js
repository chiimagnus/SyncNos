// Shared SyncNos website header used by the landing page and documentation.
(function () {
  var mount = document.querySelector('[data-site-header]');
  if (!mount) return;

  var context = mount.getAttribute('data-site-header') === 'docs' ? 'docs' : 'home';
  var lang = mount.getAttribute('data-lang') === 'en' ? 'en' : 'zh';
  var counterpart = mount.getAttribute('data-counterpart') || '';
  var base = context === 'docs' ? '/SyncNos/' : '';

  function text(zh, en) {
    return lang === 'en' ? en : zh;
  }

  function navLink(href, zh, en, extra) {
    return (
      '<a href="' + href + '" data-en="' + en + '" data-zh="' + zh + '"' + (extra || '') + '>' + text(zh, en) + '</a>'
    );
  }

  var docsHref = context === 'docs' ? base + (lang === 'en' ? 'docs/en/' : 'docs/') : 'docs/';
  var languageControl =
    '<button id="lang" class="ghost-btn" type="button" aria-label="' +
    (context === 'docs' ? (lang === 'en' ? '切换到中文' : 'Switch to English') : 'Switch language') +
    '">' +
    (context === 'docs' && lang === 'en' ? '中' : 'EN') +
    '</button>';

  mount.outerHTML =
    '<header class="nav">' +
    '<a class="brand" href="' +
    (context === 'docs' ? base : '#top') +
    '"><img src="' +
    (context === 'docs' ? base : '') +
    'assets/icon-128.png" alt="SyncNos" width="30" height="30"><span>SyncNos</span></a>' +
    '<nav class="nav-links">' +
    navLink(docsHref, '文档', 'Docs', ' data-docs-link') +
    '</nav>' +
    '<div class="nav-actions">' +
    '<a class="ghost-btn github-link" href="https://github.com/chiimagnus/SyncNos" target="_blank" rel="noreferrer" aria-label="GitHub">' +
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 00-3.64 22.41c.58.11.79-.25.79-.56v-2.2c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.58-.29-5.29-1.29-5.29-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.94 10.94 0 0112 6.16c.98 0 1.96.13 2.88.39 2.19-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.4-2.72 5.38-5.31 5.67.42.36.79 1.07.79 2.16v3.22c0 .31.21.67.8.56A11.5 11.5 0 0012 .7z"/></svg>' +
    '<span>Star</span></a>' +
    languageControl +
    '<button id="theme" class="ghost-btn" type="button" aria-label="Toggle dark mode">' +
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>' +
    '<path d="M12 3a9 9 0 000 18z" fill="currentColor"></path>' +
    '</svg>' +
    '</button>' +
    '</div>' +
    '</header>';

  if (context === 'docs') {
    document.getElementById('lang').addEventListener('click', function () {
      window.location.href = counterpart;
    });
  }
})();
