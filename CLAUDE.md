# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SyncNos** is a SwiftUI macOS application that synchronizes reading highlights and notes from Apple Books and GoodLinks to Notion databases. It features a Python FastAPI backend for Apple Sign In authentication.

### Core Features
- Apple Books highlight/note extraction from SQLite database
- GoodLinks article sync with tags and highlights
- Notion database synchronization with two strategies:
  - **Single DB mode**: All content in one Notion database
  - **Per-book mode**: Separate database per book/article
- Automatic background sync with configurable intervals
- Apple Sign In authentication via FastAPI backend

## Build & Development Commands

### macOS App (Xcode)
```bash
# Open in Xcode
open SyncNos.xcodeproj

# Build Debug configuration
xcodebuild -scheme SyncNos -configuration Debug build

# Build Release configuration
xcodebuild -scheme SyncNos -configuration Release build

# Run the app
open build/Debug/SyncNos.app
```

**Requirements:**
- macOS 13.0+
- Xcode 15.0+
- Swift 5.0+

### Python Backend (FastAPI)
```bash
cd Backend/

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
# Edit .env with Apple credentials

# Run development server
uvicorn app.main:app --reload --port 8000

# Access API docs
# http://127.0.0.1:8000/docs
```

**Backend Environment Variables** (Backend/.env):
```bash
APPLE_TEAM_ID=YOUR_TEAM_ID
APPLE_KEY_ID=YOUR_KEY_ID
APPLE_CLIENT_ID=com.example.app.services
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
APP_JWT_SECRET=your_jwt_secret
```

## Architecture

### SwiftUI App Structure

The app follows **MVVM architecture** with strict separation of concerns:

```
SyncNos/
├── SyncNosApp.swift              # App entry point
├── Views/                        # SwiftUI Views (UI layer)
│   ├── Components/
│   ├── AppleBooks/
│   ├── GoodLinks/
│   └── Settting/
├── ViewModels/                   # ObservableObject ViewModels
│   ├── AppleBooks/
│   ├── GoodLinks/
│   ├── Account/
│   ├── Notion/
│   └── LogViewModel.swift
├── Models/                       # Data models
│   └── Models.swift              # BookRow, Highlight, etc.
└── Services/                     # Business logic & data access
    ├── 0-NotionAPI/              # Notion integration
    │   ├── Core/
    │   ├── Operations/
    │   └── 1-AppleBooksSyncToNotion/
    ├── 1-AppleBooks/             # Apple Books SQLite access
    ├── 2-GoodLinks/              # GoodLinks database access
    ├── Infrastructure/           # DI, Logger, Auth, etc.
    └── IAP/                      # In-app purchases
```

### Dependency Injection

Services are managed via `DIContainer.shared` (Services/Infrastructure/DIContainer.swift:4):

```swift
// Access services
DIContainer.shared.notionService
DIContainer.shared.databaseService
DIContainer.shared.appleBooksSyncService
DIContainer.shared.autoSyncService
```

### Key Service Layers

**1. Apple Books Data Access** (Services/1-AppleBooks/)
- `DatabaseService`: SQLite connection & query management
- `DatabaseConnectionService`: Read-only DB connections
- `DatabaseQueryService`: SQL query execution
- `BookFilterService`: Filtering logic for books
- `BookmarkStore`: macOS bookmark persistence

**2. Notion API Integration** (Services/0-NotionAPI/)
- `NotionService`: Main orchestrator (Services/0-NotionAPI/Core/NotionService.swift:23)
- `NotionServiceCore`: Configuration & HTTP client
- Operation modules:
  - `NotionDatabaseOperations`: Database creation & property management
  - `NotionPageOperations`: Page CRUD operations
  - `NotionHighlightOperations`: Highlight formatting & sync
  - `NotionQueryOperations`: Query existing data
- Sync strategies:
  - `AppleBooksSyncStrategySingleDB`: Single database mode
  - `AppleBooksSyncStrategyPerBook`: Per-book database mode

**3. GoodLinks Integration** (Services/2-GoodLinks/)
- `GoodLinksService`: Database query & sync orchestrator
- `GoodLinksQueryService`: Article & highlight queries
- `GoodLinksTagParser`: Tag extraction & parsing

**4. Infrastructure** (Services/Infrastructure/)
- `AutoSyncService`: Background sync scheduling (Services/Infrastructure/AutoSyncService.swift)
- `LoggerService`: Unified logging (Services/Infrastructure/LoggerService.swift)
- `AuthService`: Apple Sign In integration
- `ConcurrencyLimiter`: Rate limiting for API calls
- `KeychainHelper`: Secure credential storage

### Main App Entry Point

**SyncNosApp.swift:5** initializes:
1. Bookmark restoration for Apple Books database access
2. IAP transaction monitoring
3. Auto-sync service startup (if enabled)

App windows:
- MainListView: Book/article selection & sync
- Settings: Notion configuration, sync options
- UserGuide: Help documentation
- Logs: Sync operation logs

### Python Backend Structure

```
Backend/
├── app/
│   ├── main.py                   # FastAPI app entry
│   ├── api/                      # Route handlers
│   ├── core/                     # Core config & security
│   ├── services/                 # Business logic
│   ├── models/                   # Data models
│   └── security/                 # JWT & Apple auth
├── requirements.txt
└── .env                          # Environment config
```

The backend handles Apple Sign In OAuth flow and JWT token issuance for the macOS app.

## Development Patterns

### ViewModels (ObservableObject + Combine)

ViewModels use reactive patterns with `@Published` properties and Combine operators:

**Services/ViewModels/AppleBooks/AppleBookViewModel.swift:5**
```swift
class AppleBookViewModel: ObservableObject {
    @Published var books: [BookListItem] = []
    @Published var isLoading = false

    private var cancellables = Set<AnyCancellable>()

    init() {
        // Reactive data processing with Combine
        $books
            .map { /* filtering/transformation */ }
            .assign(to: &$filteredBooks)
    }
}
```

### Service Protocols

All services implement protocols for testability:

**Services/Infrastructure/Protocols.swift:1**
```swift
protocol DatabaseServiceProtocol {
    func canOpenReadOnly(dbPath: String) -> Bool
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow]
    // ... other methods
}
```

### Concurrency

- **Swift**: `async/await` for service operations
- **SQLite**: Synchronous calls wrapped in `DatabaseReadOnlySession`
- **Notion API**: Rate-limited with `ConcurrencyLimiter`
- **Actor-based locking**: `NotionSourceEnsureLock` prevents concurrent database creation

### Data Models

Key models (Models/Models.swift:18):
- `Highlight`: Individual highlight with UUID, text, note, timestamps
- `BookListItem`: Book metadata without full highlight load
- `BookRow`: Simple book information
- `HighlightRow`: Highlight with associated book ID
- `AssetHighlightStats`: Aggregated statistics per asset

## Important Notes

### Apple Books Database Access
- Reads from `~/Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books/*.sqlite`
- Uses macOS security-scoped bookmarks for persistent access
- **Read-only** connections to avoid corrupting source database

### Sync Strategies

**Single Database** (default):
- One Notion database for all books/articles
- Book pages created as child pages
- Highlights added as bullet points

**Per-Book Database**:
- New Notion database per book/article
- Each highlight becomes a database item
- Better organization but more Notion databases

### Rate Limiting
- Notion API: 3 requests/second (configurable in `NotionSyncConfig`)
- Batch operations: Configurable concurrency limits
- Retry logic: Automatic with exponential backoff

### Internationalization
- Supports Chinese (zh-Hans) and English (en)
- User can switch language in Settings
- UI strings use `LocalizedStringResource`

## Cursor Rules

**.cursor/rules/SwiftUI响应式布局+MVVM架构+Combine响应式编程.mdc:1** contains strict architectural guidelines:

**DO:**
- Use MVVM with ObservableObject + @Published or @Observable
- Keep Views pure (no business logic)
- Use Combine for reactive data streams
- Follow file structure: Views/, ViewModels/, Models/, Services/
- Use dependency injection via DIContainer

**DON'T:**
- Use singletons for ViewModels
- Mix ObservableObject with @Observable
- Put business logic in Views
- Share ViewModel instances between views
- Use manual state management

## Configuration Files

- **SyncNos.xcodeproj/project.pbxproj**: Xcode project settings
- **SyncNos/SyncNos.entitlements**: App sandboxing & capabilities
- **Backend/requirements.txt**: Python dependencies
- **Backend/.env**: Apple credentials (NOT in git)
- **buildServer.json**: Build server configuration

## Testing

**No unit tests found** in the current codebase. Test infrastructure would need to be added following Xcode test conventions.

## Deployment

### Mac App Store
- Product bundle ID: `com.chiimagnus.macOS`
- Current version: 0.5.5
- App sandbox enabled with network permissions
- Available on Mac App Store

### Distribution
- Code signing: Automatic (Development team: RDQHYSDFFG)
- Hardened runtime enabled
- App Transport Security configured for Notion API