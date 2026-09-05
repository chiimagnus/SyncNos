# Selected JSON Export v1

This page is the canonical public contract for SyncNos **selected JSON export** with `schemaVersion: 1`. It describes a read-only interchange format for selected captured items. It is not the SyncNos Backup ZIP format and is not an import/restore schema.

## Archive contract

Selected JSON export always downloads one ZIP archive, including when only one item is selected.

- One selected SyncNos item produces one JSON file at the ZIP root.
- JSON files use the existing human-readable conversation basename. If two or more selected items resolve to the same basename, the archive claims the next unused `-2`, `-3`, and so on suffix in input order.
- Materialized local image files are stored under `attachments/`.
- The archive filename is `SyncNos-json-<local timestamp>.zip`.
- JSON text is UTF-8 and formatted for readability.
- There is no combined/merged JSON file.

A JSON filename is a presentation path, not item identity. Consumers must use the JSON object's opaque `source` + `key` pair as the item identity and must not parse either value for internal structure.

## Common object

Every v1 item contains these fields:

| Field | Type | Contract |
| --- | --- | --- |
| `schemaVersion` | `1` | Public schema version. |
| `type` | `"chat" \| "article" \| "video"` | Item shape discriminator. |
| `source` | `string` | Non-empty source identity from SyncNos. |
| `key` | `string` | Non-empty conversation key; combine with `source` for machine identity. |
| `title` | `string \| null` | Captured title when available. |
| `url` | `string \| null` | Captured source URL when available. |
| `capturedAt` | `string \| null` | ISO 8601 projection of a valid local capture timestamp. |
| `warnings` | `string[]` | Capture/integrity warning codes in stored order. Treat codes as opaque strings. |
| `attachments` | `Attachment[]` | Only cached internal images actually written into this ZIP. |

`Attachment` has exactly the public fields below in v1:

```json
{
  "path": "attachments/example-0001.png",
  "mediaType": "image/png",
  "byteSize": 1234
}
```

`path` is relative to the current archive. It is not a persistent asset identifier and can change when the selection or item order changes. `byteSize` is the size of the Blob written to the archive. `mediaType` uses the first valid normalized cached/Blob MIME value, or `application/octet-stream` when it cannot be determined.

## Chat

A chat adds `messages`. Array order is the public message order and follows the canonical conversation detail returned by SyncNos.

```json
{
  "schemaVersion": 1,
  "type": "chat",
  "source": "chatgpt",
  "key": "opaque-conversation-key",
  "title": "Example",
  "url": "https://example.com/chat",
  "capturedAt": "2026-09-06T00:00:00.000Z",
  "warnings": [],
  "attachments": [],
  "messages": [
    {
      "key": "message-key",
      "role": "assistant",
      "author": null,
      "content": {
        "markdown": "Saved Markdown",
        "text": "Saved text"
      }
    }
  ]
}
```

Each message contains only:

- `key: string` — a non-empty persisted `messageKey`;
- `role: string` — an empty or malformed stored role falls back to `assistant`;
- `author: string | null`;
- `content: { markdown: string | null, text: string | null }`.

Local message IDs, `conversationId`, `sequence`, and `updatedAt` are not exported.

## Article

An article adds:

```json
{
  "author": "Author name or null",
  "publishedAt": "source value or null",
  "content": {
    "markdown": "Saved Markdown or null",
    "text": "Saved text or null"
  }
}
```

SyncNos selects the message whose `messageKey` is exactly `article_body`. Only when that semantic key is absent does it fall back to the first canonical detail message. If `article_body` exists with empty content, that empty content remains authoritative and is represented with `null` content fields rather than replaced by another message.

`publishedAt` preserves the captured source string. v1 does not reinterpret it as a new timestamp type.

## Video

A video adds:

```json
{
  "author": "Creator or null",
  "transcript": {
    "markdown": "Saved transcript Markdown or null",
    "text": "Saved transcript text or null"
  }
}
```

SyncNos selects the message whose `messageKey` is exactly `video_transcript`. Only when that key is absent does it fall back to the first canonical detail message.

v1 does **not** publish `platform`, `durationSeconds`, `thumbnailUrl`, `transcriptSource`, or `hasTimestamps`. These are not part of the stable selected-export contract.

## Nulls, strings, and content fidelity

- Required identity fields (`source`, `key`, and chat message `key`) must be actual strings and non-empty after trimming. A malformed required identity makes the export fail rather than inventing an ID or silently dropping the item.
- Optional metadata strings such as `title`, `url`, `author`, and `publishedAt` become `null` when missing, non-string, or empty after trimming.
- `warnings` always exists. Only actual non-empty string codes are retained, in their existing order.
- `capturedAt` is `null` unless the stored value is an actual finite positive number that can be represented as an ISO timestamp.
- Saved content is different from metadata: `content.markdown`, `content.text`, and transcript/message content are preserved exactly when they are non-empty strings. SyncNos does not trim them, normalize their line endings, or re-render them for JSON export.
- A missing or exact empty saved content string becomes `null`.

The only intentional content rewrite is the internal-image handling below.

## Internal images and attachments

For each item, SyncNos walks its Markdown-bearing fields in their stable public order and parses real Markdown image targets.

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

Selected JSON v1 does not expose or bundle:

- conversation or message local database IDs;
- message `conversationId`, `sequence`, or `updatedAt`;
- list source/site cache keys;
- Notion/Feishu document IDs or workspace state;
- sync mappings or provider remote state;
- article comments or `commentThreadCount`;
- settings, OAuth/authentication state, or provider secrets;
- unresolved internal asset IDs as real Markdown image targets.

For SyncNos backup and restore behavior, see [storage.md](storage.md). Backup ZIP is a separate recovery protocol and may contain data that selected JSON intentionally excludes.

## Compatibility rules

Consumers should branch on `schemaVersion` and ignore unknown optional fields they do not understand. JSON object key serialization order is not part of the contract.

The following can remain within v1:

- a new warning code;
- an additional optional field that existing v1 consumers can safely ignore.

A `schemaVersion` change is required for incompatible changes such as removing or renaming an existing field, changing an existing field's type or meaning, or introducing an item kind that requires a new mandatory object shape.

Selected JSON v1 is export-only. SyncNos does not import or restore from this format; use Backup ZIP for SyncNos recovery.
