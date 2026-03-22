export type ConversationKindDefinition = {
  id: string;
  matches: (conversation: any) => boolean;
  notion: {
    dbSpec: {
      title: string;
      storageKey: string;
      properties: Record<string, unknown>;
      ensureSchemaPatch?: Record<string, unknown>;
    };
    pageSpec: {
      buildCreateProperties: (conversation: any) => Record<string, unknown>;
      buildUpdateProperties: (conversation: any) => Record<string, unknown>;
    };
  };
  obsidian: {
    folder: string;
  };
};

function assertNonEmptyString(value: unknown, message: string): void {
  if (!value || typeof value !== 'string' || !String(value).trim()) throw new Error(message);
}

export function assertKindDef(definition: unknown): ConversationKindDefinition {
  const normalized = definition as Partial<ConversationKindDefinition> | null;
  if (!normalized || typeof normalized !== 'object') {
    throw new Error('kind def must be an object');
  }

  assertNonEmptyString(normalized.id, 'kind def missing id');
  if (typeof normalized.matches !== 'function') {
    throw new Error(`kind ${normalized.id} missing matches()`);
  }

  if (!normalized.notion || typeof normalized.notion !== 'object') {
    throw new Error(`kind ${normalized.id} missing notion`);
  }
  if (!normalized.notion.dbSpec || typeof normalized.notion.dbSpec !== 'object') {
    throw new Error(`kind ${normalized.id} missing notion.dbSpec`);
  }
  assertNonEmptyString(normalized.notion.dbSpec.title, `kind ${normalized.id} missing notion.dbSpec.title`);
  assertNonEmptyString(normalized.notion.dbSpec.storageKey, `kind ${normalized.id} missing notion.dbSpec.storageKey`);
  if (!normalized.notion.dbSpec.properties || typeof normalized.notion.dbSpec.properties !== 'object') {
    throw new Error(`kind ${normalized.id} missing notion.dbSpec.properties`);
  }

  if (!normalized.notion.pageSpec || typeof normalized.notion.pageSpec !== 'object') {
    throw new Error(`kind ${normalized.id} missing notion.pageSpec`);
  }
  if (typeof normalized.notion.pageSpec.buildCreateProperties !== 'function') {
    throw new Error(`kind ${normalized.id} missing notion.pageSpec.buildCreateProperties()`);
  }
  if (typeof normalized.notion.pageSpec.buildUpdateProperties !== 'function') {
    throw new Error(`kind ${normalized.id} missing notion.pageSpec.buildUpdateProperties()`);
  }

  if (!normalized.obsidian || typeof normalized.obsidian !== 'object') {
    throw new Error(`kind ${normalized.id} missing obsidian`);
  }
  assertNonEmptyString(normalized.obsidian.folder, `kind ${normalized.id} missing obsidian.folder`);

  return normalized as ConversationKindDefinition;
}
