# SyncNos 📚

[![](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-%E4%B8%AD%E6%96%87%E7%89%88-ff0000?style=flat)](README.md)
[![](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-000aff?style=flat)](README_EN.md)

[<img src="Resource/image.png" alt="Download on the Mac App Store" width="200">](https://apps.apple.com/app/syncnos/id6755133888)

> **SyncNos** - A professional reading notes sync tool that seamlessly syncs highlights and annotations from Apple Books and GoodLinks to Notion, supporting multiple sync strategies and powerful customization features.

## ✨ Main Features

### 📚 Apple Books Sync
- **Complete Data Extraction**: Book title, author, highlights, notes, color labels
- **Timestamp Support**: Precise sync of creation and modification times
- **Smart Pagination**: Paginated processing of large amounts of data for performance optimization
- **Database Monitoring**: Automatic detection of the latest Apple Books database files

### 🔗 GoodLinks Sync
- **Article Content Sync**: Title, link, full content, tags
- **Highlight Notes**: Support for all GoodLinks highlighting features
- **Tag Parsing**: Complete tag system support
- **Batch Processing**: Efficient handling of large amounts of article data

### 🔄 Smart Sync Strategies
- **Single Database Mode**: All content managed in one Notion database
- **Multi-Database Mode**: Separate databases for each book/article for better organization
- **Idempotent Sync**: UUID-based to ensure no duplicate syncing
- **Incremental Sync**: Timestamp-based intelligent incremental updates

### 🎯 Advanced Features
- **Auto Sync**: Configurable background scheduled sync
- **Real-time Status**: Real-time display of sync progress
- **Error Retry**: Intelligent error retry mechanism
- **Apple Sign In**: Secure Apple ID authentication integration

## 🚀 Quick Start

### Method 1: Mac App Store Installation (Recommended)

1. **Download the App**
   - Visit [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888)
   - Click "Get" to install the application

2. **Configure Notion**
   - Open [Notion Integrations Page](https://www.notion.so/profile/integrations)
   - Create a new integration to get the API Token
   - Create a database in Notion and get the database ID

3. **Setup SyncNos**
   - Open the SyncNos application
   - Enter the Notion API Token and database ID in settings
   - Click "Save" to complete the configuration

### Method 2: Source Code Compilation Installation

#### System Requirements
- macOS 13.0+
- Xcode 15.0+
- Swift 5.0+

#### Compilation Steps

```bash
# Clone repository
git clone https://github.com/chiimagnus/SyncNos.git
cd SyncNos

# Open Xcode project
open SyncNos.xcodeproj

# Or compile using command line
xcodebuild -scheme SyncNos -configuration Debug build
```

## 📄 License

This project is licensed under the [AGPL-3.0 License](LICENSE).

---

<div align="center">

**⭐ If this project helps you, please give us a Star!**

Made with ❤️ by [Chii Magnus](https://github.com/chiimagnus)

</div>
