// SyncNos landing — zero-dependency theme toggle, i18n, and scroll reveal.
// ponytail: no framework, no deps; Chinese is the DOM default, English lives in data-en.
(function () {
  var root = document.documentElement;

  // ---- Theme (system default, manual override persisted) ----
  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try {
      localStorage.setItem("theme", t);
    } catch (e) {}
  }
  var themeBtn = document.getElementById("theme");
  if (themeBtn)
    themeBtn.addEventListener("click", function () {
      setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  // follow system changes only when the user hasn't chosen explicitly
  try {
    var mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", function (e) {
      if (!localStorage.getItem("theme"))
        root.setAttribute("data-theme", e.matches ? "dark" : "light");
    });
  } catch (e) {}

  // ---- Install: point the primary CTAs at the visitor's own browser store ----
  var STORES = {
    chrome:
      "https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok",
    edge: "https://microsoftedge.microsoft.com/addons/detail/syncnosaiweb-clipper/ijkpghlfmkbjcgafapjcjahaikmnjncl",
    firefox: "https://addons.mozilla.org/firefox/addon/syncnos-webclipper/",
  };
  var ua = navigator.userAgent || "";
  var bkey = /Firefox\//.test(ua)
    ? "firefox"
    : /Edg\//.test(ua)
      ? "edge"
      : "chrome";
  var bname = { chrome: "Chrome", edge: "Edge", firefox: "Firefox" }[bkey];
  var installs = document.querySelectorAll("[data-install]");
  for (var n = 0; n < installs.length; n++) {
    installs[n].setAttribute("href", STORES[bkey]);
    if (installs[n].getAttribute("data-install") === "hero") {
      installs[n].innerHTML = "安装到 " + bname;
      installs[n].setAttribute("data-en", "Add to " + bname);
    }
  }

  // ---- Install split: caret reveals the OTHER browsers (current one is the main button) ----
  var split = document.querySelector(".install-split");
  var splitToggle = document.querySelector(".install-toggle");
  if (split && splitToggle) {
    var menuItems = split.querySelectorAll("[data-menu-store]");
    for (var q = 0; q < menuItems.length; q++) {
      if (menuItems[q].getAttribute("data-menu-store") === bkey)
        menuItems[q].style.display = "none";
    }
    function closeSplit() {
      split.classList.remove("open");
      splitToggle.setAttribute("aria-expanded", "false");
    }
    splitToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = split.classList.toggle("open");
      splitToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!split.contains(e.target)) closeSplit();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSplit();
    });
  }
  // matching store solid in the footer; the other two stay one tap away
  var storeLinks = document.querySelectorAll("[data-store]");
  for (var p = 0; p < storeLinks.length; p++) {
    storeLinks[p].className =
      storeLinks[p].getAttribute("data-store") === bkey
        ? "btn"
        : "btn btn-ghost";
  }

  // ---- Language (zh default in DOM, en in data-en; title + description swap too) ----
  var META = {
    title: {
      zh: "SyncNos · 把读到的一切，存进你自己的知识库",
      en: "SyncNos · Everything you read, saved to your own library",
    },
    desc: {
      zh: "SyncNos WebClipper —— 将 AI 对话、网页文章与视频字幕一键存入 Notion、Obsidian 或飞书。开源、本地优先，数据始终归你所有。",
      en: "SyncNos WebClipper — save AI chats, web articles and video transcripts to Notion, Obsidian or Feishu in one click. Open-source, local-first, your data stays yours.",
    },
  };
  var langNodes = document.querySelectorAll("[data-en]");
  var reduceMotion = false;
  try {
    reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}
  // Per-character "chimney smoke" dissipation: fixed length + synchronized so
  // the new language always arrives ~0.8s later, no matter how long the text.
  var SMOKE_WINDOW = 260,
    SMOKE_DUR = 520,
    SMOKE_SWITCH = SMOKE_WINDOW + SMOKE_DUR + 40;

  function captureZh() {
    for (var i = 0; i < langNodes.length; i++) {
      if (langNodes[i].getAttribute("data-zh") === null)
        langNodes[i].setAttribute("data-zh", langNodes[i].innerHTML);
    }
  }

  // Instantly apply a language (used on load and once the smoke has cleared).
  function applyLang(l) {
    root.setAttribute("lang", l);
    document.title = l === "en" ? META.title.en : META.title.zh;
    var md = document.querySelector('meta[name="description"]');
    if (md)
      md.setAttribute("content", l === "en" ? META.desc.en : META.desc.zh);
    for (var i = 0; i < langNodes.length; i++) {
      var el = langNodes[i];
      if (el.getAttribute("data-zh") === null)
        el.setAttribute("data-zh", el.innerHTML);
      el.innerHTML =
        l === "en" ? el.getAttribute("data-en") : el.getAttribute("data-zh");
    }
    var lb = document.getElementById("lang");
    if (lb) lb.textContent = l === "en" ? "\u4e2d" : "EN";
    try {
      localStorage.setItem("lang", l);
    } catch (e) {}
  }

  // Shred a leaf element's visible text into per-char spans that each drift
  // up-and-right, blur and fade — a wisp of chimney smoke.
  function smokeDissipate(el) {
    var chars = Array.from(el.textContent);
    var n = chars.length;
    el.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      var s = document.createElement("span");
      s.className = "ch";
      s.textContent = chars[i];
      var dy = -(1.05 + Math.random() * 1.35);
      s.style.setProperty(
        "--dx",
        (0.45 + Math.random() * 0.85).toFixed(3) + "em",
      );
      s.style.setProperty("--dy", dy.toFixed(3) + "em");
      s.style.setProperty("--rot", (Math.random() * 15 - 3).toFixed(1) + "deg");
      s.style.setProperty("--bl", (4.5 + Math.random() * 4).toFixed(1) + "px");
      s.style.setProperty("--dur", SMOKE_DUR + "ms");
      s.style.animationDelay =
        (n > 1 ? (i / (n - 1)) * SMOKE_WINDOW : 0).toFixed(0) + "ms";
      frag.appendChild(s);
    }
    el.appendChild(frag);
    void el.offsetWidth; // reflow so rapid re-toggles restart cleanly
    for (var j = 0; j < el.children.length; j++)
      el.children[j].classList.add("away");
  }

  // Dissipate every leaf [data-en] in one synchronized window, then swap text.
  function setLang(l) {
    if (reduceMotion) {
      applyLang(l);
      return;
    }
    captureZh(); // preserve originals before we shred leaf text into spans
    for (var i = 0; i < langNodes.length; i++) {
      if (langNodes[i].children.length === 0) smokeDissipate(langNodes[i]);
    }
    setTimeout(function () {
      applyLang(l);
    }, SMOKE_SWITCH);
  }
  var langBtn = document.getElementById("lang");
  if (langBtn)
    langBtn.addEventListener("click", function () {
      setLang(root.getAttribute("lang") === "en" ? "zh" : "en");
    });
  var saved = null;
  try {
    saved = localStorage.getItem("lang");
  } catch (e) {}
  var initLang =
    saved ||
    ((navigator.language || "").toLowerCase().indexOf("zh") === 0
      ? "zh"
      : "en");
  if (initLang === "en") applyLang("en");
  else captureZh();

  // ---- Scroll reveal (native IntersectionObserver, graceful fallback) ----
  var targets = document.querySelectorAll(".reveal, .gather");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    for (var j = 0; j < targets.length; j++) io.observe(targets[j]);
  } else {
    for (var k = 0; k < targets.length; k++) targets[k].classList.add("in");
  }
})();
