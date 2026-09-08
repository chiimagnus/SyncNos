# Selected JSON Export v2

This page is the canonical public contract for the current SyncNos **selected JSON export** with `schemaVersion: 2`. It is a read-only interchange format for selected local items. It is not the SyncNos Backup ZIP format and is not an import/restore schema.

## Archive contract

Selected JSON export downloads one ZIP archive, including when only one item is selected.

- One selected SyncNos item produces one JSON file at the ZIP root.
- JSON files use the existing human-readable conversation basename. Name collisions receive the next unused `-2`, `-3`, and so on suffix in input order.
- Materialized local image files are stored under `attachments/`.
- The archive filename is `SyncNos-json-<local timestamp>.zip`.
- JSON text is UTF-8 and formatted for readability.
- There is no combined JSON file.

A JSON filename is a presentation path, not item identity. Consumers must use the JSON object's opaque `source` + `key` pair as item identity and must not parse either value for internal structure.

## Common object

Every v2 item contains these fields:

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | `2` | Public schema version. |
| `type` | `"chat" \| "article" \| "video"` | Item shape discriminator. |
| `source` | `string` | Non-empty source identity from SyncNos. |
| `key` | `string` | Non-empty conversation key; combine with `source` for machine identity. |
| `title` | `string \| null` | Stored title when available. |
| `url` | `string \| null` | Stored source URL when available. |
| `lastActivityAt` | `string \| null` | ISO 8601 projection of the item's valid local business-activity timestamp. |
| `warnings` | `string[]` | Stored warning codes in order. Treat codes as opaque strings. |
| `attachments` | `Attachment[]` | Only cached internal images actually materialized into this ZIP. |

`lastActivityAt` is item-level metadata. It may advance because of a successful capture/recapture or a user mutation such as adding, replying to, or deleting an article comment. Selected JSON v2 does not export article comments, so the reason for a later activity timestamp is not guaranteed to be reconstructible from the JSON body itself.

`Attachment` contains:

```json
{
  "path": "attachments/example-0001.png",
  "mediaType": "image/png",
  "byteSize": 1234
}
```

`path` is relative to the current archive. It is not a persistent asset identifier. `byteSize` is the size of the Blob written to the archive. `mediaType` uses the first valid normalized cached/Blob MIME value, or `application/octet-stream` when it cannot be determined.

## Chat

A chat adds `messages`. Array order is the canonical conversation-detail order returned by SyncNos.

```json
{
  "schemaVersion": 2,
  "type": "chat",
  "source": "chatgpt",
  "key": "opaque-conversation-key",
  "title": "Example",
  "url": "https://example.com/chat",
  "lastActivityAt": "2026-09-08T00:00:00.000Z",
  "warnings": [],
  "attachments": [],
  "messages": [
    {
      "key": "message-key",
      "role": "assistant",
      "author": null,
      "content": {
        "format": "markdown",
        "value": "Saved Markdown"
      }
    }
  ]
}
```

Each message contains only:

- `key: string` — a non-empty persisted `messageKey`;
- `role: string` — an empty or malformed stored role falls back to `assistant`;
- `author: string | null`;
- `content: { format: "markdown", value: string } | null`.

v2 exposes only the canonical saved Markdown body. It does not emit the historical v1 `format: "text"` representation. Missing or exactly empty canonical Markdown is exported as `null`.

Local message IDs, `conversationId`, `sequence`, and `updatedAt` are not exported.

## Article

An article adds:

```json
{
  "author": "Author name or null",
  "publishedAt": "source value or null",
  "content": {
    "format": "markdown",
    "value": "Saved Markdown"
  }
}
```

SyncNos selects the message whose `messageKey` is exactly `article_body`. Only when that semantic key is absent does it fall back to the first canonical detail message. Empty canonical Markdown remains authoritative and is exported as `null`.

`publishedAt` preserves the stored source string. v2 does not reinterpret it as a new timestamp type.

## Video

A video adds:

```json
{
  "author": "Creator or null",
  "transcript": {
    "format": "markdown",
    "value": "Saved transcript Markdown"
  }
}
```

SyncNos selects the message whose `messageKey` is exactly `video_transcript`. Only when that key is absent does it fall back to the first canonical detail message.

v2 does not publish `platform`, `durationSeconds`, `thumbnailUrl`, `transcriptSource`, or `hasTimestamps`.

## Nulls, strings, and content fidelity

- Required identity fields (`source`, `key`, and chat message `key`) must be actual non-empty strings after trimming. Malformed required identity fails export rather than inventing an ID.
- Optional metadata strings such as `title`, `url`, `author`, and `publishedAt` become `null` when missing, non-string, or empty after trimming.
- `warnings` always exists. Only actual non-empty string codes are retained, in their existing order.
- `lastActivityAt` is `null` unless the stored value is an actual finite positive number representable as an ISO timestamp. `0`, negative values, NaN, Infinity, out-of-range values, and numeric strings do not become timestamps and never fall back to the export time.
- Canonical saved content is preserved exactly. SyncNos does not trim it, normalize line endings, or re-render it for JSON export.
- Public content is `{ "format": "markdown", "value": string } | null`. Any non-string saved Markdown value is malformed and makes that item fail export rather than being silently erased as `null`.

The only intentional content rewrite is internal-image materialization.

## Internal images and attachments

For each item, SyncNos walks Markdown content in stable public order and parses real Markdown image targets.

- A valid `syncnos-asset://...` image target is read only from that item's own conversation-scoped image cache.
- A successfully materialized asset is written once and listed once in `attachments`, in first-real-reference order. Repeated references reuse the same archive path.
- The Markdown image target is rewritten to that relative attachment path.
- A malformed, missing, or cross-conversation internal image target is replaced with `[Image unavailable]`; the failed image does not abort the rest of the item export.
- Ordinary prose, inline code, fenced code, indented code, and other non-image Markdown containing the same internal URI text are not rewritten.
- Existing `http(s)` image targets remain remote URLs.
- Existing `data:image/...` targets remain inline data URLs.
- Selected export does not make a new image network request and does not write to the image cache.

The local image-cache ID itself is never part of the public JSON schema.

## Explicit exclusions

Selected JSON v2 does not expose or bundle:

- conversation or message local database IDs;
- message `conversationId`, `sequence`, or `updatedAt`;
- list source/site cache keys;
- Notion/Feishu document IDs or workspace state;
- sync mappings or provider remote state;
- article comments or `commentThreadCount`;
- settings, OAuth/authentication state, or provider secrets;
- unresolved internal asset IDs as real Markdown image targets.

For SyncNos backup and restore behavior, see [storage.md](storage.md). Backup ZIP is a separate recovery protocol and may contain data that Selected JSON intentionally excludes.

## Compatibility rules

Consumers should branch on `schemaVersion` and ignore unknown optional fields they do not understand. JSON object key serialization order is not part of the contract.

A schema-version change is required for incompatible changes such as removing or renaming an existing field, changing an existing field's type or meaning, or introducing an item kind that requires a new mandatory object shape.

The historical v1 contract is retained at [export-json-v1.md](export-json-v1.md). In particular, v1 used `capturedAt`; consumers must not reinterpret that historical field as `lastActivityAt`.

Selected JSON v2 is export-only. SyncNos does not import or restore from this format; use Backup ZIP for SyncNos recovery.
