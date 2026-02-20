/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { els, storageGet, storageSet, flashOk } = core;

  const STORAGE_KEY = "notion_ai_preferred_model_index";
  const DEFAULT_INDEX_1_BASED = 3;
  const MIN_INDEX = 1;
  const MAX_INDEX = 20;

  function parseIndex1Based(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return NaN;
    return Math.floor(n);
  }

  async function load() {
    if (!els.notionAiModelIndex) return;
    const res = await storageGet([STORAGE_KEY]);
    const idx = parseIndex1Based(res && res[STORAGE_KEY] !== undefined ? res[STORAGE_KEY] : DEFAULT_INDEX_1_BASED);
    els.notionAiModelIndex.value = String(Number.isFinite(idx) && idx >= MIN_INDEX ? idx : DEFAULT_INDEX_1_BASED);
    els.notionAiModelIndex.min = String(MIN_INDEX);
    els.notionAiModelIndex.max = String(MAX_INDEX);
  }

  async function save({ index1Based }) {
    const idx = parseIndex1Based(index1Based);
    if (!Number.isFinite(idx) || idx < MIN_INDEX || idx > MAX_INDEX) {
      alert(`Invalid model index. Please enter an integer between ${MIN_INDEX} and ${MAX_INDEX}.`);
      return false;
    }
    await storageSet({ [STORAGE_KEY]: idx });
    return true;
  }

  function bindEvents() {
    if (!els.notionAiModelIndex) return;

    if (els.btnNotionAiModelSave) {
      els.btnNotionAiModelSave.addEventListener("click", async () => {
        const ok = await save({ index1Based: els.notionAiModelIndex.value });
        if (ok) flashOk(els.btnNotionAiModelSave);
      });
    }

    if (els.btnNotionAiModelReset) {
      els.btnNotionAiModelReset.addEventListener("click", async () => {
        if (els.notionAiModelIndex) els.notionAiModelIndex.value = String(DEFAULT_INDEX_1_BASED);
        const ok = await save({ index1Based: DEFAULT_INDEX_1_BASED });
        if (ok) flashOk(els.btnNotionAiModelReset);
      });
    }

    els.notionAiModelIndex.addEventListener("keydown", (e) => {
      if (!e || e.key !== "Enter") return;
      els.btnNotionAiModelSave && els.btnNotionAiModelSave.click();
    });

    els.notionAiModelIndex.addEventListener("blur", async () => {
      // Keep the stored value aligned with what user sees when they click away.
      await save({ index1Based: els.notionAiModelIndex.value });
    });
  }

  async function init() {
    bindEvents();
    await load();
  }

  NS.popupNotionAi = { init };
})();

