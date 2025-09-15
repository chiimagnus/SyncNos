# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Commands for Development

### Building and Running
- The project is an Xcode project, open `SyncBookNotesWithNotion.xcodeproj` to build and run
- macOS deployment target is 13.0
- Swift version is 5.0
- Uses App Sandbox with security-scoped bookmarks for accessing user's Apple Books database

### Testing
- Run tests using Xcode's test navigator or Cmd+U
- For running specific tests, use Xcode's test filtering capabilities
- Add unit tests for new business logic in Services
- Test edge cases and error conditions
- Ensure UI components behave correctly with different data states

### Code Structure
- Models in `SyncNos/Models/` define the data structures
- Services in `SyncNos/Services/` handle database access and business logic
- ViewModels in `SyncNos/ViewModels/` connect data to UI
- Views in `SyncNos/Views/` contain the SwiftUI UI components

### Key Design Principles
- Composition over inheritance using dependency injection
- Interface-based design for testability and flexibility
- Clear data flow and explicit dependencies
- Single responsibility principle - each component has a focused purpose

### Architecture Patterns
- MVVM (Model-View-ViewModel) for the macOS app
- Service-oriented architecture with protocol-based interfaces
- Separation of concerns between data access, business logic, and presentation layers

## 2. High-Level Architecture

### Core Components
1. **Database Access Layer**: 
   - Uses SQLite3 to access Apple Books annotation data directly
   - Dynamically detects available columns in the database to handle different versions
   - Implements proper error handling for database operations
   - All database access is read-only for security

2. **Data Models**:
   - `Highlight`: Represents a single highlight/note from Apple Books
   - `BookExport`: Represents a book with its highlights
   - `BookListItem`: Lightweight model for listing books without loading all highlights
   - `AssetHighlightCount`: Aggregated highlight count per asset/book

3. **Services**:
   - `DatabaseService`: Main service that coordinates database operations
   - `DatabaseConnectionService`: Handles database connections and operations
   - `DatabaseQueryService`: Contains the actual SQL queries and data fetching logic
   - `BookFilterService`: Handles filtering of books based on criteria
   - `BookmarkStore`: Manages security-scoped bookmarks for accessing the database file
   - `NotionService`: Handles communication with the Notion API
   - All services use protocols for testability and dependency injection

4. **UI Components**:
   - `BooksListView`: Main view showing the list of books with highlight counts
   - `BookDetailView`: Detail view showing highlights for a selected book with pagination
   - Custom `WaterfallLayout` for adaptive masonry-style layout of highlights
   - `SettingsView`: Configuration interface for Apple Books container and Notion integration
   - `NotionIntegrationView`: UI for configuring Notion API credentials and testing integration

5. **ViewModels**:
   - `BookViewModel`: Manages the data flow between services and BooksListView
   - `BookDetailViewModel`: Manages pagination and data loading for BookDetailView
   - `NotionIntegrationViewModel`: Handles UI logic for Notion integration setup

6. **Dependency Injection**:
   - `DIContainer` provides shared instances of services
   - Services are injected into ViewModels through initializer parameters with default values

### Data Flow
1. Views observe ViewModels through @Published properties
2. ViewModels coordinate with Services to fetch data
3. Services handle database access and return model objects
4. ViewModels process and expose data to Views
5. User interactions trigger updates through the same flow

### Security Considerations
- Uses App Sandbox with security-scoped bookmarks for accessing user's Apple Books database
- All database access is read-only
- Properly manages security-scoped resource access lifecycle
- Notion API credentials stored in UserDefaults (standard for macOS apps)

### Notion Integration
- `NotionService` handles all Notion API communications
- `NotionConfigStore` manages credential storage and retrieval
- Idempotent sync using UUID tracking to prevent duplicate highlights
- Batch operations for efficient API usage
- Rich formatting of highlights with metadata and iBooks links
- Progress tracking during sync operations

### Database Access Patterns
- Security-Scoped Access: Uses security-scoped bookmarks for accessing the Apple Books database within the App Sandbox
- Dynamic Schema Detection: Dynamically detects available columns to handle different Apple Books database versions
- Error Handling: Implements proper error handling for database operations
- Pagination: Implements pagination for efficient loading of large datasets
- Read-Only Access: All database access is read-only for security

### UI/UX Patterns
- Custom `WaterfallLayout` for adaptive masonry-style layout of highlights
- Master-detail interface using `NavigationSplitView`
- Progress indicators for long-running operations
- Error states with user-friendly messages
- Pagination with "Load More" functionality
- Toolbar integration for primary actions