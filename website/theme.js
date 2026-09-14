// Shared website theme: system default with a persisted light/dark override.
(function () {
  var root = document.documentElement;

  function readStoredTheme() {
    try {
      var value = localStorage.getItem('theme');
      return value === 'dark' || value === 'light' ? value : '';
    } catch (e) {
      return '';
    }
  }

  function systemTheme() {
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (!persist) return;
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {}
  }

  applyTheme(readStoredTheme() || systemTheme(), false);

  function bindToggle() {
    var button = document.getElementById('theme');
    if (!button) return;
    button.addEventListener('click', function () {
      applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle, { once: true });
  else bindToggle();

  try {
    var media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', function (event) {
      if (!readStoredTheme()) applyTheme(event.matches ? 'dark' : 'light', false);
    });
  } catch (e) {}
})();
