// Docs-only navigation behavior layered on top of the shared website shell.
(function () {
  var toc = document.querySelector('.docs-toc');
  if (!toc) return;

  var links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  var entries = links
    .map(function (link) {
      var id = decodeURIComponent(link.getAttribute('href').slice(1));
      var heading = document.getElementById(id);
      return heading ? { id: id, link: link, heading: heading } : null;
    })
    .filter(Boolean);
  if (!entries.length) return;

  var activeId = '';
  var scheduled = false;

  function setActive(id) {
    if (!id || id === activeId) return;
    activeId = id;
    entries.forEach(function (entry) {
      var active = entry.id === id;
      entry.link.classList.toggle('active', active);
      if (active) entry.link.setAttribute('aria-current', 'location');
      else entry.link.removeAttribute('aria-current');
    });
  }

  function updateActiveHeading() {
    scheduled = false;
    var marker = Math.min(140, Math.max(48, window.innerHeight * 0.2));
    var active = entries[0];

    for (var index = 0; index < entries.length; index += 1) {
      if (entries[index].heading.getBoundingClientRect().top > marker) break;
      active = entries[index];
    }

    var root = document.documentElement;
    if (window.innerHeight + window.scrollY >= root.scrollHeight - 2) active = entries[entries.length - 1];
    setActive(active.id);
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateActiveHeading);
  }

  links.forEach(function (link) {
    link.addEventListener('click', function () {
      var id = decodeURIComponent(link.getAttribute('href').slice(1));
      setActive(id);
    });
  });
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('hashchange', scheduleUpdate);
  scheduleUpdate();
})();
