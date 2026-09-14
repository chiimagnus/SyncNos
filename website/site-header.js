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
  var sectionPrefix = context === 'docs' ? base : '';
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
    navLink(sectionPrefix + '#capture', '采集', 'Capture') +
    navLink(sectionPrefix + '#sync', '同步', 'Sync') +
    navLink(docsHref, '文档', 'Docs', ' data-docs-link') +
    navLink(sectionPrefix + '#privacy', '隐私', 'Privacy') +
    navLink(sectionPrefix + '#open', '开源', 'Open source') +
    '</nav>' +
    '<div class="nav-actions">' +
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
