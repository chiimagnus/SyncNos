# SyncNos 📚

[![](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-%E4%B8%AD%E6%96%87%E7%89%88-ff0000?style=flat)](README.cn.md)
[![](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-000aff?style=flat)](README.md)

[<img src="Resource/image.png" alt="Download on the Mac App Store" width="200">](https://apps.apple.com/app/syncnos/id6755133888)

> **SyncNos** - A professional reading notes sync tool that seamlessly syncs highlights and annotations from Apple Books, GoodLinks, WeRead, and Dedao to Notion, supporting multiple sync strategies and powerful customization features.

## ✨ Main Features

### Support multi-platform synchronization
- Apple Books
- GoodLinks
- WeRead
- Dedao
- Notion
- Chat History beta - OCR version

### Apple Books Sync
- **Complete Data Extraction**: Book title, author, highlights, notes, color labels
- **Timestamp Support**: Precise sync of creation and modification times
- **Smart Pagination**: Paginated processing of large amounts of data for performance optimization
- **Database Monitoring**: Automatic detection of the latest Apple Books database files

### GoodLinks Sync
- **Article Content Sync**: Title, link, full content, tags
- **Highlight Notes**: Support for all GoodLinks highlighting features
- **Tag Parsing**: Complete tag system support
- **Batch Processing**: Efficient handling of large amounts of article data

### WeRead Sync
- **Book List Sync**: Complete bookshelf data synchronization
- **Highlights & Thoughts**: Full sync of annotations and highlights
- **Cookie Auto-Refresh**: Transparent authentication management
- **Local Caching**: SwiftData persistence for offline access

### Dedao Sync
- **WebView Login**: Secure login through dedao.cn WebView
- **Ebook Library**: Complete bookshelf data synchronization
- **Notes & Highlights**: Full sync of annotations and highlights
- **Token Bucket Rate Limiting**: Intelligent rate limiting to prevent anti-crawler blocks
- **Local Caching**: SwiftData persistence for offline access

### Smart Sync Strategies
- **Single Database Mode**: All content managed in one Notion database
- **Multi-Database Mode**: Separate databases for each book/article for better organization
- **Idempotent Sync**: UUID-based to ensure no duplicate syncing
- **Incremental Sync**: Timestamp-based intelligent incremental updates

### Advanced Features
- **Smart Auto Sync**: Intelligent incremental sync every 5 minutes, only syncing changed content
- **Real-time Status**: Real-time display of sync progress
- **Error Retry**: Intelligent error retry mechanism
- **Apple Sign In**: Secure Apple ID authentication integration

## 🎉 Download SyncNos from Mac App Store

[Download SyncNos from Mac App Store ->](https://apps.apple.com/app/syncnos/id6755133888)

## 🏗️ Architecture

<p align="center">
  <img src="Resource/architecture.svg" alt="SyncNos Architecture" width="100%">
</p>

<details>
<summary>📊 View Text-based Architecture Diagram</summary>

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   SyncNos                                        │
│                         Multi-Source → Multi-Target Sync                         │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   User / App    │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │   ViewModels    │
                              │ (Business Logic)│
                              └────────┬────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         │                             │                             │
         ▼                             ▼                             ▼
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│  AppleBooks     │          │   GoodLinks     │          │    WeRead       │
│  Adapter        │          │   Adapter       │          │    Adapter      │
│ (Local SQLite)  │          │ (Local SQLite)  │          │   (Web API)     │
└────────┬────────┘          └────────┬────────┘          └────────┬────────┘
         │                             │                             │
         └─────────────────────────────┼─────────────────────────────┘
                                       │
                                       ▼
        ┌─────────────────────────────────────────────────────────────┐
        │                    SyncSourceProtocol                        │
        │              (Unified Data Source Interface)                 │
        └──────────────────────────────┬──────────────────────────────┘
                                       │
                                       ▼
        ┌─────────────────────────────────────────────────────────────┐
        │                 UnifiedHighlight / UnifiedSyncItem           │
        │                    (Unified Data Models)                     │
        └──────────────────────────────┬──────────────────────────────┘
                                       │
                                       ▼
        ┌─────────────────────────────────────────────────────────────┐
        │                    SyncTargetRegistry                        │
        │              (Target Management & Routing)                   │
        └──────────────────────────────┬──────────────────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         │                             │                             │
         ▼                             ▼                             ▼
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│  NotionTarget   │          │ ObsidianTarget  │          │   LarkTarget    │
│  (Cloud API)    │          │ (Local Files)   │          │  (Cloud API)    │
└────────┬────────┘          └────────┬────────┘          └────────┬────────┘
         │                             │                             │
         ▼                             ▼                             ▼
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│  Notion API     │          │  Local Vault    │          │   Lark API      │
└─────────────────┘          └─────────────────┘          └─────────────────┘
```

</details>

### Sync Strategies

| Mode | Description |
|------|-------------|
| **Single Database** | All books in one Notion database, each book as a page |
| **Per-Book Database** | Each book gets its own database with highlights as items |

### Data Flow

```
1. User selects books/articles to sync
                    ↓
2. ViewModel creates Adapter (e.g., WeReadNotionAdapter)
                    ↓
3. Adapter implements SyncSourceProtocol
   - fetchHighlights() → [UnifiedHighlight]
   - syncItem → UnifiedSyncItem
                    ↓
4. SyncTargetRegistry routes to enabled targets
                    ↓
5. Each SyncTarget (Notion/Obsidian/Lark) processes data
   - NotionTarget → NotionSyncEngine → Notion API
   - ObsidianTarget → MarkdownWriter → Local .md files
   - LarkTarget → LarkService → Lark API
                    ↓
6. SyncTimestampStore records last sync time
```

### Extensibility

| Add New Data Source | Add New Sync Target |
|---------------------|---------------------|
| 1. Create `XxxModels.swift` | 1. Create `YyyConfigStore.swift` |
| 2. Create `XxxNotionAdapter.swift` | 2. Create `YyySyncTarget.swift` |
| 3. Implement `SyncSourceProtocol` | 3. Implement `SyncTargetProtocol` |
| 4. Create ViewModel & Views | 4. Create Integration Views |
| 5. Register in DIContainer | 5. Register in SyncTargetRegistry |

## 📄 License

This project is licensed under the [AGPL-3.0 License](LICENSE).

---

<div align="center">

**⭐ If this project helps you, please give us a Star!**

Made with ❤️ by [Chii Magnus](https://github.com/chiimagnus)

</div>
