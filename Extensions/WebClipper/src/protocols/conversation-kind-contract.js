(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function assertNonEmptyString(value, message) {
    if (!value || typeof value !== "string" || !String(value).trim()) throw new Error(message);
  }

  function assertKindDef(def) {
    if (!def || typeof def !== "object") throw new Error("kind def must be an object");

    assertNonEmptyString(def.id, "kind def missing id");
    if (typeof def.matches !== "function") throw new Error(`kind ${def.id} missing matches()`);

    if (!def.notion || typeof def.notion !== "object") throw new Error(`kind ${def.id} missing notion`);
    if (!def.notion.dbSpec || typeof def.notion.dbSpec !== "object") throw new Error(`kind ${def.id} missing notion.dbSpec`);
    assertNonEmptyString(def.notion.dbSpec.title, `kind ${def.id} missing notion.dbSpec.title`);
    assertNonEmptyString(def.notion.dbSpec.storageKey, `kind ${def.id} missing notion.dbSpec.storageKey`);
    if (!def.notion.dbSpec.properties || typeof def.notion.dbSpec.properties !== "object") {
      throw new Error(`kind ${def.id} missing notion.dbSpec.properties`);
    }

    if (!def.notion.pageSpec || typeof def.notion.pageSpec !== "object") throw new Error(`kind ${def.id} missing notion.pageSpec`);
    if (typeof def.notion.pageSpec.buildCreateProperties !== "function") throw new Error(`kind ${def.id} missing notion.pageSpec.buildCreateProperties()`);
    if (typeof def.notion.pageSpec.buildUpdateProperties !== "function") throw new Error(`kind ${def.id} missing notion.pageSpec.buildUpdateProperties()`);
    if (def.notion.pageSpec.shouldRebuild && typeof def.notion.pageSpec.shouldRebuild !== "function") {
      throw new Error(`kind ${def.id} notion.pageSpec.shouldRebuild must be a function`);
    }

    if (!def.obsidian || typeof def.obsidian !== "object") throw new Error(`kind ${def.id} missing obsidian`);
    assertNonEmptyString(def.obsidian.folder, `kind ${def.id} missing obsidian.folder`);

    return def;
  }

  const api = { assertKindDef };
  NS.conversationKindContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

