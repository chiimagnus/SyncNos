/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  // This function is serialised and injected into the active tab page.
  // It must be self-contained (no closure references to outer scope).
  function extractionFunc() {
    try {
      if (typeof Readability !== "function") {
        return { ok: false, error: "ReadabilityNotLoaded" };
      }

      // WeChat: js_content is hidden by default – unhide so Readability sees it.
      const wechat = document.querySelector("#js_content");
      if (wechat) {
        wechat.style.visibility = "visible";
        wechat.style.opacity = "1";
      }

      const cloned = document.cloneNode(true);
      const article = new Readability(cloned).parse();
      if (!article) {
        return { ok: false, error: "ParseReturnedNull" };
      }

      return {
        ok: true,
        title: (article.title || "").trim(),
        author: (article.byline || "").trim(),
        text: (article.textContent || "").trim(),
        excerpt: (article.excerpt || "").trim(),
        url: location.href
      };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  async function fetchArticleFromActiveTab() {
    if (!chrome || !chrome.tabs) throw new Error("tabs API not available");
    if (!chrome.scripting) throw new Error("scripting API not available");

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) throw new Error("no active tab");

    const tabId = tab.id;
    const tabUrl = tab.url || "";
    if (!/^https?:\/\//i.test(tabUrl)) {
      throw new Error("active tab is not an http(s) page");
    }

    // Inject Readability.js into the page so extractionFunc can use it.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/readability.js"]
    });

    // Run the extraction function in the page context.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractionFunc
    });

    const result = results && results[0] && results[0].result;
    if (!result) throw new Error("no extraction result from tab");
    if (!result.ok) throw new Error(result.error || "article extraction failed");

    return {
      title: result.title,
      author: result.author,
      text: result.text,
      excerpt: result.excerpt,
      url: result.url || tabUrl
    };
  }

  const api = { fetchArticleFromActiveTab };
  NS.articleFetcher = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
