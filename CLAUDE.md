# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Commands for Development

### Building and Running
- The project is an Xcode project, open `SyncBookNotesWithNotion.xcodeproj` to build and run
- macOS deployment target is 15.4
- Swift version is 5.0

### Code Structure
- macOS directory contains the macOS SwiftUI application for reading Apple Books annotations and exporting them

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