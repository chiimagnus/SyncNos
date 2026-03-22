import { describe, expect, it } from "vitest";
import * as backupUtils from "@services/sync/backup/backup-utils.ts";

describe("backup zip v2 schema", () => {
  it("validateStorageLocalDocument rejects invalid shapes", () => {
    expect(backupUtils.validateStorageLocalDocument(null).ok).toBe(false);
    expect(backupUtils.validateStorageLocalDocument({ schemaVersion: 2, storageLocal: {} }).ok).toBe(false);
    expect(backupUtils.validateStorageLocalDocument({ schemaVersion: 1, storageLocal: "nope" }).ok).toBe(false);
    expect(backupUtils.validateStorageLocalDocument({ schemaVersion: 1, storageLocal: { popup_active_tab: "settings" } }).ok).toBe(true);
  });

  it("validateBackupManifest rejects unknown version and duplicate files", () => {
    const base = {
      exportedAt: new Date().toISOString(),
      db: { name: "webclipper", version: 3 },
      counts: { conversations: 1, messages: 1, sync_mappings: 0 },
      config: { storageLocalPath: "config/storage-local.json" },
      index: { conversationsCsvPath: "sources/conversations.csv" }
    };

    expect(backupUtils.validateBackupManifest({ ...base, backupSchemaVersion: 999, sources: [] }).ok).toBe(false);

    const dup = backupUtils.validateBackupManifest({
      ...base,
      backupSchemaVersion: 2,
      sources: [{ source: "chatgpt", conversationCount: 2, files: ["sources/chatgpt/a.json", "sources/chatgpt/a.json"] }]
    });
    expect(dup.ok).toBe(false);
  });

  it("validateBackupManifest rejects unsafe file paths", () => {
    const res = backupUtils.validateBackupManifest({
      backupSchemaVersion: 2,
      exportedAt: new Date().toISOString(),
      db: { name: "webclipper", version: 3 },
      counts: { conversations: 1, messages: 0, sync_mappings: 0 },
      config: { storageLocalPath: "config/storage-local.json" },
      index: { conversationsCsvPath: "sources/conversations.csv" },
      sources: [{ source: "chatgpt", conversationCount: 1, files: ["../sources/chatgpt/a.json"] }]
    });
    expect(res.ok).toBe(false);
  });

  it("validateConversationBundle accepts a minimal bundle with null mapping", () => {
    const ok = backupUtils.validateConversationBundle({
      schemaVersion: 1,
      conversation: { source: "chatgpt", conversationKey: "c1", title: "T" },
      messages: [{ messageKey: "m1", role: "user", contentText: "hi", updatedAt: 1, sequence: 1 }],
      syncMapping: null
    });
    expect(ok.ok).toBe(true);
  });
});
