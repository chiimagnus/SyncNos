/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { els, openUrl } = core;

  function init() {
    const manifest = chrome && chrome.runtime && typeof chrome.runtime.getManifest === "function" ? chrome.runtime.getManifest() : null;
    const version = manifest && manifest.version ? manifest.version : "";
    const name = manifest && manifest.name ? manifest.name : "SyncNos WebClipper";
    if (els.aboutVersion) {
      els.aboutVersion.textContent = version ? `Version ${version}` : "Version";
      els.aboutVersion.title = name;
    }

    if (els.btnAboutSource) els.btnAboutSource.addEventListener("click", () => openUrl("https://github.com/chiimagnus/SyncNos"));
    if (els.btnAboutChangelog) els.btnAboutChangelog.addEventListener("click", () => openUrl("https://chiimagnus.notion.site/syncnos-changelog"));
    if (els.btnAboutMacApp) els.btnAboutMacApp.addEventListener("click", () => openUrl("https://apps.apple.com/app/syncnos/id6755133888"));
    if (els.btnAboutGitHub) els.btnAboutGitHub.addEventListener("click", () => openUrl("https://github.com/chiimagnus"));
    if (els.btnAboutMail) els.btnAboutMail.addEventListener("click", () => openUrl("mailto:chii_magnus@outlook.com?subject=%5BSyncNos%20WebClipper%5D%20Feedback"));
  }

  NS.popupAbout = { init };
})();
