# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Commands for Development

### Building and Running
- The project is an Xcode project, open `SyncBookNotesWithNotion.xcodeproj` to build and run
- macOS deployment target is 13
- Swift version is 5.0

### Testing
- Run tests using Xcode's test navigator or Cmd+U
- For running specific tests, use Xcode's test filtering capabilities

### Code Structure
- macOS directory contains the macOS SwiftUI application for reading Apple Books annotations and exporting them
- Models in `macOS/Models/` define the data structures
- Services in `macOS/Services/` handle database access and business logic
- ViewModels in `macOS/ViewModels/` connect data to UI
- Views in `macOS/Views/` contain the SwiftUI UI components

### Key Design Principles
- Composition over inheritance using dependency injection
- Interface-based design for testability and flexibility
- Clear data flow and explicit dependencies
- Single responsibility principle - each component has a focused purpose

### Architecture Patterns
- MVVM (Model-View-ViewModel) for the macOS app
- Service-oriented architecture with protocol-based interfaces
- Separation of concerns between data access, business logic, and presentation layers

### Shared Components
- Data models in `Models/` directories
- SQLite database access logic in `Services/` directories

### Technology Stack
- Swift 5.0
- SwiftUI for macOS UI
- SQLite3 for database access
- Foundation framework for core functionality

## 2. Project Overview

This project is a macOS application that reads Apple Books annotations and exports them. It has two main components:
1. A CLI (command-line interface) version for direct execution
2. A macOS SwiftUI UI version for graphical interaction

The macOS app reads data from Apple Books' SQLite database and presents it in a user-friendly interface.

## 3. Key Implementation Details

### Database Access
- Uses SQLite3 to access Apple Books annotation data
- Dynamically detects available columns in the database to handle different versions
- Implements proper error handling for database operations
- Uses security-scoped bookmarks for accessing the database file in the App Sandbox

### Data Models
- `Highlight`: Represents a single highlight/note from Apple Books
- `BookExport`: Represents a book with its highlights
- `HighlightRow` and `BookRow`: Intermediate representations for database rows
- `BookListItem`: Lightweight model for listing books without loading all highlights
- `AssetHighlightCount`: Aggregated highlight count per asset/book

### Services
- `DatabaseService`: Main service that coordinates database operations
- `DatabaseConnectionService`: Handles database connections and operations
- `DatabaseQueryService`: Contains the actual SQL queries and data fetching logic
- `BookFilterService`: Handles filtering of books based on criteria
- `BookmarkStore`: Manages security-scoped bookmarks for accessing the database file
- All services use protocols for testability and dependency injection

### UI Components
- `BooksListView`: Main view showing the list of books with highlight counts
- `BookDetailView`: Detail view showing highlights for a selected book with pagination
- `BookViewModel`: ViewModel that manages the data flow between services and BooksListView
- `BookDetailViewModel`: ViewModel that manages pagination and data loading for BookDetailView
- Custom `WaterfallLayout` for adaptive masonry-style layout of highlights

### Dependency Injection
- `DIContainer` provides shared instances of services
- Services are injected into ViewModels through initializer parameters with default values

## 4. Development Guidelines

### Adding New Features
1. Follow the MVVM pattern by adding new data to Models, business logic to Services, and UI presentation to Views
2. Use dependency injection for better testability
3. Maintain single responsibility principle for each component
4. Use protocols for service interfaces to enable mocking in tests

### Error Handling
- Use Swift's error handling mechanisms
- Provide user-friendly error messages in the UI
- Log errors appropriately for debugging

### Testing
- Add unit tests for new business logic in Services
- Test edge cases and error conditions
- Ensure UI components behave correctly with different data states

### Security Considerations
- Uses App Sandbox with security-scoped bookmarks for accessing user's Apple Books database
- All database access is read-only
- Properly manages security-scoped resource access lifecycle