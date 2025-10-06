# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
SyncNos is a macOS application that synchronizes highlights and notes from Apple Books and GoodLinks to Notion. The app is built with SwiftUI for macOS 13+ using Swift 5.0+.

## Architecture
The application follows a clean architecture pattern with dependency injection using a DIContainer. Key architectural elements:
- **Dependency Injection**: Uses DIContainer.swift for managing service dependencies
- **Services Layer**: Organized in numbered directories (0-NotionAPI, 1-AppleBooks, 2-GoodLinks, Infrastructure, IAP)
- **Models**: Core data models defined in Models.swift
- **ViewModels**: Follow MVVM pattern with specific view models for each feature
- **Views**: SwiftUI views organized in Components, AppleBooks, GoodLinks, and Settings directories

## Key Services
- `AppleBooksSyncService`: Handles Apple Books data synchronization
- `GoodLinksDatabaseService`: Handles GoodLinks app integration
- `NotionService`: Manages Notion API interactions
- `AutoSyncService`: Provides automatic synchronization functionality
- `IAPService`: Handles in-app purchases
- `LoggerService`: Provides logging functionality

## Data Models
- `BookListItem`: Lightweight model for book listings
- `Highlight`: Represents individual highlights with text, notes, and metadata
- `HighlightRow` and `BookRow`: UI-specific data representations
- `ContentSource`: Enum for data source selection (Apple Books, GoodLinks)

## Development Commands
- **Build**: `xcodebuild -scheme SyncNos -configuration Debug`
- **Build Release**: `xcodebuild -scheme SyncNos -configuration Release`
- **Clean**: `xcodebuild clean -scheme SyncNos`
- **Test**: Standard Xcode testing via `xcodebuild test` (if tests exist)
- **Run**: Use Xcode IDE or `xcodebuild build` then run the resulting app

## Build Environment
- macOS 13+ required
- Xcode 14+ recommended
- Swift 5.0+ compatible
- Project scheme: "SyncNos"
- Build configurations: Debug, Release

## Project Structure
```
SyncNos/
├── Models/                 # Data models
├── Services/               # Business logic services
│   ├── 0-NotionAPI/        # Notion integration
│   ├── 1-AppleBooks/       # Apple Books integration
│   ├── 2-GoodLinks/        # GoodLinks integration
│   ├── Infrastructure/     # Core infrastructure
│   └── IAP/                # In-app purchase
├── ViewModels/             # View model layer
├── Views/                  # SwiftUI views
│   ├── AppleBooks/         # Apple Books UI
│   ├── GoodLinks/          # GoodLinks UI
│   ├── Components/         # Reusable components
│   └── Setting/            # Settings UI
├── Assets.xcassets/        # Asset catalog
├── SyncNosApp.swift        # App entry point
└── MainListView.swift      # Main application view
```

## Key Implementation Notes
- Uses bookmark APIs for persistent file access permissions
- Implements auto-sync functionality with UserDefaults management
- Follows Apple's data access guidelines for protected containers
- Includes in-app purchase support
- Uses UserDefaults for configuration persistence
- Implements proper error handling throughout services