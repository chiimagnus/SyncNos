(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  const list = NS.popupList;
  if (!core || !list) return;

  const { els, send, flashOk } = core;

  let confirmTimer = null;
  let armed = false;

  function setDeleteButtonArmed(on) {
    if (!els.btnDelete) return;
    armed = !!on;
    els.btnDelete.dataset.confirming = armed ? "1" : "";
    els.btnDelete.textContent = armed ? "Confirm" : "Delete";
    els.btnDelete.title = armed ? "Click again to confirm" : "Delete selected";
  }

  function armDeleteButton() {
    setDeleteButtonArmed(true);
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      setDeleteButtonArmed(false);
      confirmTimer = null;
    }, 2600);
  }

  function hidePreviewPopover() {
    if (!els.chatPreviewPopover) return;
    els.chatPreviewPopover.hidden = true;
    els.chatPreviewPopover.innerHTML = "";
    els.chatPreviewPopover.removeAttribute("data-state");
  }

  async function doDeleteSelected() {
    const ids = list.getSelectedIds();
    if (!ids.length) return;
    if (!armed) {
      armDeleteButton();
      return;
    }
    setDeleteButtonArmed(false);

    hidePreviewPopover();
    const res = await send("deleteConversations", { conversationIds: ids });
    if (!res || !res.ok) {
      alert((res && res.error && res.error.message) || "Delete failed.");
      return;
    }
    flashOk(els.btnDelete);
    await list.refresh();
  }

  function init() {
    if (!els.btnDelete) return;
    setDeleteButtonArmed(false);
    els.btnDelete.addEventListener("click", () => {
      doDeleteSelected().catch((e) => {
        alert((e && e.message) || "Delete failed.");
      });
    });

    document.addEventListener("click", (e) => {
      if (!armed) return;
      const target = e && e.target;
      if (target && els.btnDelete && els.btnDelete.contains(target)) return;
      setDeleteButtonArmed(false);
    });
  }

  NS.popupDelete = {
    init
  };
})();
