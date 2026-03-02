/* global chrome */

(function () {
  const NS = require("../collector-context.js");

  const ARTICLE_SOURCE = "web";
  const ARTICLE_SOURCE_TYPE = "article";
  const READABILITY_FILE = "src/collectors/web/readability.js";

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

        function normalizeInlineText(value) {
          return String(value || "").replace(/\s+/g, " ");
        }

        function sanitizeUrl(raw) {
          const text = String(raw || "").trim();
          if (!text) return "";
          if (/^\/\//.test(text)) return `${location.protocol}${text}`;
          try {
            const resolved = new URL(text, location.href).toString();
            return /^https?:\/\//i.test(resolved) ? resolved : "";
          } catch (_e) {
            return "";
          }
        }

        function isBlockTag(tag) {
          return [
            "p", "div", "section", "article", "main", "header", "footer", "aside",
            "h1", "h2", "h3", "h4", "h5", "h6",
            "ul", "ol", "li", "blockquote", "pre", "table", "figure", "hr"
          ].includes(String(tag || "").toLowerCase());
        }

        function escapeMarkdownLabel(value) {
          return String(value || "").replace(/\]/g, "\\]");
        }

        function renderInlineChildren(node) {
          if (!node) return "";
          const parts = [];
          const children = Array.from(node.childNodes || []);
          for (const child of children) {
            parts.push(renderInlineNode(child));
          }
          return parts
            .join("")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/[ \t]{2,}/g, " ");
        }

        function renderInlineNode(node) {
          if (!node) return "";
          if (node.nodeType === Node.TEXT_NODE) {
            return normalizeInlineText(node.nodeValue || "");
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return "";

          const tag = String(node.tagName || "").toLowerCase();
          if (!tag) return "";

          if (tag === "br") return "\n";
          if (tag === "img") {
            const src = sanitizeUrl(node.getAttribute("src") || node.getAttribute("data-src") || "");
            if (!src) return "";
            const alt = escapeMarkdownLabel(normalize(node.getAttribute("alt") || ""));
            return `![${alt}](${src})`;
          }
          if (tag === "a") {
            const href = sanitizeUrl(node.getAttribute("href") || "");
            const label = renderInlineChildren(node).trim() || href;
            if (!href) return label;
            return `[${escapeMarkdownLabel(label)}](${href})`;
          }
          if (tag === "code") {
            const text = normalizeInlineText(node.textContent || "").trim();
            if (!text) return "";
            return `\`${text.replace(/`/g, "\\`")}\``;
          }
          if (tag === "strong" || tag === "b") {
            const text = renderInlineChildren(node).trim();
            return text ? `**${text}**` : "";
          }
          if (tag === "em" || tag === "i") {
            const text = renderInlineChildren(node).trim();
            return text ? `*${text}*` : "";
          }
          return renderInlineChildren(node);
        }

        function renderList(node, ordered) {
          const items = Array.from(node.children || []).filter((child) => {
            return child && String(child.tagName || "").toLowerCase() === "li";
          });
          if (!items.length) return "";

          const startRaw = Number.parseInt(String(node.getAttribute("start") || "1"), 10);
          const start = ordered && Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 1;

          const lines = [];
          for (let i = 0; i < items.length; i += 1) {
            const li = items[i];
            const content = (renderChildrenAsBlocks(li) || renderInlineChildren(li) || "")
              .trim()
              .replace(/\n+/g, " ");
            if (!content) continue;
            const marker = ordered ? `${start + i}.` : "-";
            lines.push(`${marker} ${content}`);
          }
          return lines.join("\n");
        }

        function renderChildrenAsBlocks(node) {
          if (!node) return "";
          const parts = [];
          const children = Array.from(node.childNodes || []);
          for (const child of children) {
            const block = renderBlockNode(child);
            if (block) parts.push(block);
          }
          return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
        }

        function renderBlockNode(node) {
          if (!node) return "";
          if (node.nodeType === Node.TEXT_NODE) {
            const text = normalizeInlineText(node.nodeValue || "").trim();
            return text || "";
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return "";

          const tag = String(node.tagName || "").toLowerCase();
          if (!tag || ["script", "style", "noscript", "iframe", "svg", "canvas"].includes(tag)) return "";

          if (/^h[1-6]$/.test(tag)) {
            const level = Math.max(1, Math.min(6, Number(tag.slice(1))));
            const text = renderInlineChildren(node).trim();
            return text ? `${"#".repeat(level)} ${text}` : "";
          }
          if (tag === "p") {
            return renderInlineChildren(node).trim();
          }
          if (tag === "ul") return renderList(node, false);
          if (tag === "ol") return renderList(node, true);
          if (tag === "blockquote") {
            const inner = (renderChildrenAsBlocks(node) || renderInlineChildren(node)).trim();
            if (!inner) return "";
            return inner
              .split("\n")
              .map((line) => line ? `> ${line}` : ">")
              .join("\n");
          }
          if (tag === "pre") {
            const text = String(node.textContent || "").replace(/\n+$/, "");
            if (!text.trim()) return "";
            const fence = text.includes("```") ? "````" : "```";
            return `${fence}\n${text}\n${fence}`;
          }
          if (tag === "hr") return "---";
          if (tag === "img") return renderInlineNode(node);
          if (tag === "figure") {
            const images = Array.from(node.querySelectorAll("img"))
              .map((img) => renderInlineNode(img))
              .filter(Boolean);
            const captionNode = node.querySelector("figcaption");
            const caption = captionNode ? renderInlineChildren(captionNode).trim() : "";
            const out = [];
            if (images.length) out.push(images.join("\n\n"));
            if (caption) out.push(`*${caption}*`);
            if (out.length) return out.join("\n\n");
          }

          const childBlocks = renderChildrenAsBlocks(node);
          if (childBlocks) return childBlocks;

          if (!isBlockTag(tag)) {
            return renderInlineChildren(node).trim();
          }
          return "";
        }

        function htmlToMarkdown(content, text) {
          const normalizedContent = normalize(content);
          if (!normalizedContent) return normalize(text);
          try {
            const parser = new DOMParser();
            const parsed = parser.parseFromString(
              `<div id="syncnos_article_md_root">${normalizedContent}</div>`,
              "text/html"
            );
            const root = parsed.getElementById("syncnos_article_md_root");
            if (!root) return normalize(text);
            const markdown = renderChildrenAsBlocks(root).replace(/\n{3,}/g, "\n\n").trim();
            return markdown || normalize(text);
          } catch (_e) {
            return normalize(text);
          }
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
            contentMarkdown: htmlToMarkdown(content, text),
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
                  contentMarkdown: htmlToMarkdown(content, text),
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
    const markdownContent = normalizeText(extracted.contentMarkdown || "");
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

    const body = textContent;
    const markdown = markdownContent || body;
    await storage.syncConversationMessages(Number(conversation.id), [{
      messageKey: "article_body",
      role: "assistant",
      contentText: body,
      contentMarkdown: markdown,
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
