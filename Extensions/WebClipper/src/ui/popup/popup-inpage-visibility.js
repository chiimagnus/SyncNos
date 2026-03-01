/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { els, storageGet, storageSet, send } = core;
  const STORAGE_KEY = "inpage_supported_only";
  const contracts = NS.messageContracts || {};
  const uiMessageTypes = contracts.UI_MESSAGE_TYPES || {};

  function normalizeSetting(value) {
    return value === true;
  }

  function applyToggleValue(value) {
    if (!els.inpageSupportedOnlyToggle) return;
    els.inpageSupportedOnlyToggle.checked = !!value;
  }

  async function readSetting() {
    try {
      const data = await storageGet([STORAGE_KEY]);
      return normalizeSetting(data && data[STORAGE_KEY]);
    } catch (_e) {
      return false;
    }
  }

  async function writeSetting(value) {
    await storageSet({ [STORAGE_KEY]: !!value });
  }

  async function requestApply() {
    const type = uiMessageTypes.APPLY_INPAGE_VISIBILITY;
    if (!type || typeof send !== "function") return;
    try {
      await send(type);
    } catch (_e) {
      // ignore
    }
  }

  function init() {
    const toggle = els.inpageSupportedOnlyToggle;
    if (!toggle) return;

    let currentValue = false;
    let syncing = false;

    readSetting().then((value) => {
      currentValue = value;
      applyToggleValue(value);
    });

    toggle.addEventListener("change", () => {
      if (syncing) return;
      const previousValue = currentValue;
      const nextValue = !!toggle.checked;
      currentValue = nextValue;
      writeSetting(nextValue)
        .then(() => requestApply())
        .catch(() => {
          currentValue = previousValue;
          syncing = true;
          applyToggleValue(currentValue);
          syncing = false;
        });
    });

    const onStorageChanged = (changes, areaName) => {
      if (areaName !== "local") return;
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
      const nextValue = normalizeSetting(changes[STORAGE_KEY] && changes[STORAGE_KEY].newValue);
      currentValue = nextValue;
      syncing = true;
      applyToggleValue(nextValue);
      syncing = false;
    };

    try {
      if (chrome && chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === "function") {
        chrome.storage.onChanged.addListener(onStorageChanged);
        window.addEventListener("unload", () => {
          try {
            chrome.storage.onChanged.removeListener(onStorageChanged);
          } catch (_e) {
            // ignore
          }
        });
      }
    } catch (_e) {
      // ignore
    }
  }

  NS.popupInpageVisibility = {
    init,
    STORAGE_KEY
  };
})();
