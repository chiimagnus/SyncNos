function assertNonEmptyString(value, message) {
  if (!value || typeof value !== "string" || !String(value).trim()) throw new Error(message);
}

function assertKindDef(definition) {
  const normalized = definition && typeof definition === "object" ? definition : null;
  if (!normalized) {
    throw new Error("kind def must be an object");
  }

  assertNonEmptyString(normalized.id, "kind def missing id");
  if (typeof normalized.matches !== "function") {
    throw new Error(`kind ${normalized.id} missing matches()`);
  }

  if (!normalized.notion || typeof normalized.notion !== "object") {
    throw new Error(`kind ${normalized.id} missing notion`);
  }
  if (!normalized.notion.dbSpec || typeof normalized.notion.dbSpec !== "object") {
    throw new Error(`kind ${normalized.id} missing notion.dbSpec`);
  }
  assertNonEmptyString(normalized.notion.dbSpec.title, `kind ${normalized.id} missing notion.dbSpec.title`);
  assertNonEmptyString(
    normalized.notion.dbSpec.storageKey,
    `kind ${normalized.id} missing notion.dbSpec.storageKey`
  );
  if (!normalized.notion.dbSpec.properties || typeof normalized.notion.dbSpec.properties !== "object") {
    throw new Error(`kind ${normalized.id} missing notion.dbSpec.properties`);
  }

  if (!normalized.notion.pageSpec || typeof normalized.notion.pageSpec !== "object") {
    throw new Error(`kind ${normalized.id} missing notion.pageSpec`);
  }
  if (typeof normalized.notion.pageSpec.buildCreateProperties !== "function") {
    throw new Error(`kind ${normalized.id} missing notion.pageSpec.buildCreateProperties()`);
  }
  if (typeof normalized.notion.pageSpec.buildUpdateProperties !== "function") {
    throw new Error(`kind ${normalized.id} missing notion.pageSpec.buildUpdateProperties()`);
  }
  if (normalized.notion.pageSpec.shouldRebuild && typeof normalized.notion.pageSpec.shouldRebuild !== "function") {
    throw new Error(`kind ${normalized.id} notion.pageSpec.shouldRebuild must be a function`);
  }

  if (!normalized.obsidian || typeof normalized.obsidian !== "object") {
    throw new Error(`kind ${normalized.id} missing obsidian`);
  }
  assertNonEmptyString(normalized.obsidian.folder, `kind ${normalized.id} missing obsidian.folder`);

  return normalized;
}

module.exports = { assertKindDef };
