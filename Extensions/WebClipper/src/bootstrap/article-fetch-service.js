/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const ARTICLE_SOURCE = "web";
  const ARTICLE_SOURCE_TYPE = "article";
  const READABILITY_FILE = "vendor/readability.js";

  function toError(message) {
    return new Error(String(message || "unknown error"));
  }

  function runtimeLastErrorMessage(fallback) {
    if (chrome && chrome.runtime && chrome.runtime.lastError && chrome.runtime.lastError.message) {
      return String(chrome.runtime.lastError.message || fallback || "runtime error");
    }
    return String(fallback || "runtime error");
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve, reject) => {
      if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== "function") {
        reject(toError("tabs.query unavailable"));
        return;
      }
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome && chrome.runtime && chrome.runtime.lastError) {
          reject(toError(runtimeLastErrorMessage("tabs.query failed")));
          return;
        }
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    });
  }

  function getTab(tabId) {
    return new Promise((resolve, reject) => {
      if (!chrome || !chrome.tabs || typeof chrome.tabs.get !== "function") {
        reject(toError("tabs.get unavailable"));
        return;
      }
      chrome.tabs.get(tabId, (tab) => {
        if (chrome && chrome.runtime && chrome.runtime.lastError) {
          reject(toError(runtimeLastErrorMessage("tabs.get failed")));
          return;
        }
        resolve(tab || null);
      });
    });
  }

  function executeScript(details) {
    return new Promise((resolve, reject) => {
      if (!chrome || !chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
        reject(toError("chrome.scripting unavailable"));
        return;
      }
      chrome.scripting.executeScript(details, (results) => {
        if (chrome && chrome.runtime && chrome.runtime.lastError) {
          reject(toError(runtimeLastErrorMessage("executeScript failed")));
          return;
        }
        resolve(Array.isArray(results) ? results : []);
      });
    });
  }

  function normalizeHttpUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      const protocol = String(url.protocol || "").toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") return "";
      url.hash = "";
      return url.toString();
    } catch (_e) {
      return "";
    }
  }

  function conversationKeyForUrl(url) {
    return `article:${url}`;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\r\n/g, "\n").trim();
  }

  function countWords(text) {
    const value = normalizeText(text);
    if (!value) return 0;
    try {
      if (globalThis.Intl && typeof Intl.Segmenter === "function") {
        const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
        let count = 0;
        for (const token of segmenter.segment(value)) {
          if (token && token.isWordLike) count += 1;
        }
        if (count > 0) return count;
      }
    } catch (_e) {
      // ignore and fallback
    }
    const tokens = value.split(/\s+/).filter(Boolean);
    return tokens.length;
  }

  function fallbackTitle(url, tabTitle) {
    const preferred = normalizeText(tabTitle);
    if (preferred) return preferred;
    try {
      const parsed = new URL(url);
      return parsed.hostname || url;
    } catch (_e) {
      return url;
    }
  }

  function fallbackDescription(text) {
    const content = normalizeText(text);
    if (!content) return "";
    return content.length > 220 ? `${content.slice(0, 220)}...` : content;
  }

  async function resolveTargetTab(tabId) {
    if (Number.isFinite(Number(tabId)) && Number(tabId) > 0) {
      const tab = await getTab(Number(tabId));
      if (!tab || !Number.isFinite(Number(tab.id))) {
        throw toError("target tab not found");
      }
      return tab;
    }

    const tabs = await queryTabs({ active: true, currentWindow: true });
    const tab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
    if (!tab || !Number.isFinite(Number(tab.id))) {
      throw toError("active tab not found");
    }
    return tab;
  }

  async function ensureReadability(tabId) {
    await executeScript({
      target: { tabId, allFrames: false },
      files: [READABILITY_FILE]
    });
  }

  async function extractArticleOnTab(tabId) {
    const results = await executeScript({
      target: { tabId, allFrames: false },
      func: async ({ stabilizationTimeoutMs, stabilizationMinTextLength }) => {
        const timeoutMs = Math.max(1_000, Number(stabilizationTimeoutMs) || 10_000);
        const minTextLength = Math.max(120, Number(stabilizationMinTextLength) || 240);

        function normalize(value) {
          return String(value || "").replace(/\r\n/g, "\n").trim();
        }

        function escapeHtml(value) {
          return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function pickRoot() {
          return (
            document.querySelector("#js_content") ||
            document.querySelector("article") ||
            document.querySelector("main") ||
            document.body ||
            document.documentElement
          );
        }

        function readMeta(selectors) {
          const list = Array.isArray(selectors) ? selectors : [selectors];
          for (const selector of list) {
            if (!selector) continue;
            const node = document.querySelector(selector);
            if (!node) continue;
            const content = normalize(node.getAttribute("content") || node.textContent || "");
            if (content) return content;
          }
          return "";
        }

        function buildHtml(content, text) {
          const normalizedContent = normalize(content);
          if (normalizedContent) return `<html><body>${normalizedContent}</body></html>`;
          const normalizedText = normalize(text);
          return `<html><body><p>${escapeHtml(normalizedText)}</p></body></html>`;
        }

        function fallbackExtract() {
          const root = pickRoot();
          if (!root) return null;

          const cloned = root.cloneNode(true);
          const removable = cloned.querySelectorAll("script, style, noscript, svg, canvas, iframe");
          removable.forEach((node) => node && node.remove && node.remove());

          const text = normalize(cloned.innerText || cloned.textContent || "");
          const content = normalize(cloned.innerHTML || "");
          if (!text && !content) return null;

          return {
            ok: true,
            title: normalize(document.title || ""),
            author: readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]),
            publishedAt: readMeta(["meta[property='article:published_time']", "meta[name='publish_date']", "meta[name='pubdate']"]),
            excerpt: text ? (text.length > 220 ? `${text.slice(0, 220)}...` : text) : "",
            contentHTML: buildHtml(content, text),
            textContent: text,
            warningFlags: ["fallback_extractor"]
          };
        }

        async function waitForDomStabilized() {
          const deadline = Date.now() + timeoutMs;
          let last = null;
          let stableTicks = 0;

          while (Date.now() < deadline) {
            const root = pickRoot();
            const text = root ? normalize(root.innerText || "") : "";
            const nodeCount = root && typeof root.querySelectorAll === "function" ? root.querySelectorAll("*").length : 0;
            const sample = {
              readyState: normalize(document.readyState || ""),
              textLen: text.length,
              nodeCount
            };

            if (last && sample.readyState === last.readyState && sample.textLen === last.textLen && sample.nodeCount === last.nodeCount) {
              stableTicks += 1;
            } else {
              stableTicks = 0;
              last = sample;
            }

            if (
              stableTicks >= 2 &&
              sample.readyState.toLowerCase() === "complete" &&
              sample.textLen >= minTextLength
            ) {
              return;
            }

            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
        }

        try {
          await waitForDomStabilized();

          const wechatRoot = document.querySelector("#js_content");
          if (wechatRoot) {
            wechatRoot.style.visibility = "visible";
            wechatRoot.style.opacity = "1";
          }
          const noisyNodes = document.querySelectorAll(".weui-a11y_ref, #js_a11y_like_btn_tips");
          noisyNodes.forEach((node) => node && node.remove && node.remove());

          if (typeof Readability === "function") {
            const cloned = document.cloneNode(true);
            const article = new Readability(cloned).parse();
            if (article) {
              const title = normalize(article.title || "");
              const author = normalize(article.byline || "")
                || readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]);
              const content = normalize(article.content || "");
              const text = normalize(article.textContent || "");
              if (content || text) {
                return {
                  ok: true,
                  title,
                  author,
                  publishedAt: readMeta(["meta[property='article:published_time']", "meta[name='publish_date']", "meta[name='pubdate']"]),
                  excerpt: normalize(article.excerpt || ""),
                  contentHTML: buildHtml(content, text),
                  textContent: text,
                  warningFlags: []
                };
              }
            }
          }

          const fallback = fallbackExtract();
          if (fallback) return fallback;
          return { ok: false, error: "No article content detected" };
        } catch (e) {
          const message = (e && e.message) ? String(e.message) : String(e || "Article extraction failed");
          return { ok: false, error: message };
        }
      },
      args: [{
        stabilizationTimeoutMs: 10_000,
        stabilizationMinTextLength: 240
      }]
    });

    const payload = results && results[0] ? results[0].result : null;
    if (!payload || payload.ok !== true) {
      const reason = payload && payload.error ? payload.error : "article extraction returned empty payload";
      throw toError(reason);
    }
    return payload;
  }

  async function fetchActiveTabArticle({ tabId } = {}) {
    const tab = await resolveTargetTab(tabId);
    const targetTabId = Number(tab.id);
    const normalizedUrl = normalizeHttpUrl(tab.url || "");
    if (!normalizedUrl) {
      throw toError("active tab must be an http(s) page");
    }

    await ensureReadability(targetTabId);
    const extracted = await extractArticleOnTab(targetTabId);

    const textContent = normalizeText(extracted.textContent || "");
    const title = normalizeText(extracted.title || "") || fallbackTitle(normalizedUrl, tab.title || "");
    const author = normalizeText(extracted.author || "");
    const publishedAt = normalizeText(extracted.publishedAt || "");
    const description = normalizeText(extracted.excerpt || "") || fallbackDescription(textContent);
    const warningFlags = Array.isArray(extracted.warningFlags)
      ? extracted.warningFlags.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    if (!textContent) {
      throw toError("No article content detected");
    }

    const storage = NS.backgroundStorage;
    if (!storage || typeof storage.upsertConversation !== "function" || typeof storage.syncConversationMessages !== "function") {
      throw toError("storage module missing");
    }

    const capturedAt = Date.now();
    const conversation = await storage.upsertConversation({
      sourceType: ARTICLE_SOURCE_TYPE,
      source: ARTICLE_SOURCE,
      conversationKey: conversationKeyForUrl(normalizedUrl),
      title,
      url: normalizedUrl,
      author,
      publishedAt,
      description,
      warningFlags,
      lastCapturedAt: capturedAt
    });

    const body = normalizeText(textContent);
    await storage.syncConversationMessages(Number(conversation.id), [{
      messageKey: "article_body",
      role: "assistant",
      contentText: body,
      contentMarkdown: body,
      sequence: 1,
      updatedAt: capturedAt
    }]);

    return {
      conversationId: Number(conversation.id),
      url: normalizedUrl,
      title,
      author,
      publishedAt,
      description,
      warningFlags,
      wordCount: countWords(body),
      lastCapturedAt: capturedAt
    };
  }

  const api = {
    fetchActiveTabArticle
  };

  NS.articleFetchService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
