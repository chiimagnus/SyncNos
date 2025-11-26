[ChangeLog-Chinese Version 中文版更新日志](ChangeLog.cn.md)

## v0.8.4.2 November 26, 2025

*Architecture Refactoring*

- RootView Architecture: Added RootView as root view to manage Onboarding, PayWall, and MainListView transitions
- PayWall Priority: Moved PayWall check logic from MainListView to RootView, ensuring display before data source initialization
- Lazy Bookmark Restoration: Bookmark restoration now uses lazy loading, only triggered when user switches to the corresponding data source
  - Apple Books: AppleBooksListView.onAppear → viewModel.restoreBookmarkAndConfigureRoot()
  - GoodLinks: GoodLinksListView.onAppear → loadRecentLinks() → resolveDatabasePath()

*Improvements*

- PayWallView UI Refactor: Adopted Onboarding-style bottom layout, added gift icon wiggle animation and urgent reminder pulse animation
- Background Coverage: Fixed PayWallView background not covering entire view
- Code Cleanup: Removed PayWall-related code from MainListView, simplified view structure

## v0.8.0 November 24, 2025

*Added*

- IAP Loading States: Added loading state indicator to product purchase button for better user feedback
- Annual Subscription Tracking: Implemented annual subscription expiration tracking and display functionality
- Subscription Status Polling: Added subscription status polling and app lifecycle refresh mechanisms
- Purchase Duplicate Detection: Added transaction ID tracking to detect duplicate purchases
- 30-Day Trial Period: Implemented 30-day trial period with refactored paywall UI
- Purchase Type Tracking: Added purchase type tracking and expiration date retrieval for subscriptions
- StoreKit Configuration: Added StoreKit configuration and comprehensive IAP localization

*Changed*

- IAP System Consolidation: Consolidated IAP views into unified presentation system with PayWallView
- IAP Debug Tools: Consolidated debug functionality into main IAPViewModel, removed separate debug views
- Settings Layout: Simplified settings layout and updated IAP messaging for clarity
- WeRead Authentication: Enhanced WebKit cookie clearing in authentication service with MainActor support
- UI Dynamic Colors: Added dynamic title color based on source type
- Debug Logging: Updated debug log level color from gray to blue, downgraded some logging from info to debug
- Trial Status Logic: Improved trial status logic with comprehensive logging and documentation

*Fixed*

- Purchase Button State: Updated purchase button disabled state logic to use hasPurchased properly
- Cookie Clearing Concurrency: Made cookie clearing async with WebKit synchronization for thread safety

## v0.7.0 November 22, 2025

*Added*

- WeRead Integration: Full WeRead (微信读书) support including authentication, data sync, and UI components
- Cookie Authentication: Implemented WeRead cookie-based authentication with automatic refresh mechanism
- Highlight Sync: Added WeRead highlights and reviews synchronization with Notion
- Sort Options: New sorting options for WeRead content including created and last edited timestamps
- Notification System: Notification-driven sorting and filtering for WeRead highlights
- Color Scheme Alignment: Unified WeRead highlight color mapping with API index
- Internationalization: Enhanced i18n support for WeRead features
- Auto Sync Providers: Added WeRead to auto sync service providers
- Main List Integration: Integrated WeRead support in MainListView and ViewCommands

*Changed*

- Data Flow Simplification: Removed SwiftData persistence for WeRead to simplify data flow
- Authentication UI: Simplified WeRead login view and removed manual cookie input
- Sort Key Unification: Merged sorting key handling using BookListSortKey
- Display Optimization: Improved WeRead book list item metadata display
- Timestamp Display: Enhanced detail view headers with timestamp information
- Thread Safety: Improved LoggerService with thread-safe concurrent access
- Code Organization: Moved KeychainHelper to Core services for better structure
- Error Handling: Enhanced error handling in WeRead services
- Performance: Removed unnecessary recompute triggers after successful sync
- Menu Consistency: Updated WeRead menu label and icon for UI consistency
- Deployment Target: Updated macOS deployment target settings

## v0.6.8 November 20, 2025

*Added*

- Window Management: Enhanced window activation when opening from menu bar view
- Pagination Support: Added visible books property to support pagination and incremental loading
- Task Counter: Added total task count display in SyncQueueView

*Changed*

- Menu Bar UI: Removed sync buttons and Notion configuration alerts for cleaner interface
- Layout Optimization: Improved toolbar layout in detail views and adjusted filter/sync button positions
- Localization: Updated sync status strings and modified button icons across multiple languages
- Window Title: Hidden main window title to optimize display
- Performance: Optimized SyncQueueViewModel to limit displayed tasks and improve UI performance
- AutoSyncService: Removed unnecessary sleep calls and improved background processing

## v0.6.7 November 18, 2025

*Added*

- Notion Rate Limiting: Enhanced NotionRequestHelper to include search endpoint in read limiter
- Debug Support: Added conditional Apple account navigation link in SettingsView for debug mode

*Changed*

- Notion Integration UI: Updated NotionIntegrationView to conditionally display manual credential input based on OAuth authorization status
- Notion Pagination: Improved pagination logic in NotionService for dynamic page retrieval with better logging
- Notion Configuration: Simplified NotionOAuthConfig by removing Keychain integration and using local Swift configuration
- Notion OAuth Configuration: Migrated Notion OAuth configuration to use environment variables instead of config file
- Project Configuration: Updated .gitignore to include additional build artifacts and user settings

*Fixed*

- App Store Link: Updated App Store ID in HelpCommands to correct value for app review link

*Removed*

- Unused Scheme: Removed unused scheme file and updated scheme management plist

## v0.6.6 November 14, 2025

*Added*

- Debug Support Section: Added conditional compilation for a debug support section in SettingsView to enhance development experience
- MenuBar Window Management: Enhanced MenuBarView with window management functionality, including button to open main window
- Language Support Updates: Updated supported languages in LanguageView for improved localization

*Fixed*

- Notion Integration UI: Restored Notion integration UI elements and improved manual credential entry instructions

*Changed*

- MenuBar Layout: Added divider in MenuBarView for better visual separation of sync actions and settings
- Internationalization: Enhanced i18n support across multiple features

## v0.6.5.4 November 12, 2025

*Added*

- Main Window Behavior: Optimized main window display and behavior logic
- Open at Login Technical Documentation: Added technical documentation for the login item feature

*Changed*

- Removed User Guide: Removed user guide functionality from the app to simplify the interface
- Refactored FileCommands: Updated menu structure, replacing previous implementation with CommandGroup
- Merged NotionAuth PR: Integrated Notion authentication-related feature improvements

## v0.6.5.3 November 12, 2025

*Changed*

- Menu Bar Improvements: Fixed unused menu items in menu settings
- Enhanced Logging: Improved logging functionality in LoggerService and HelperStatusBarController
- Configuration Cleanup: Replaced SharedDefaults with UserDefaults for consistency
- Language Preference Handling: Enhanced language preference setting management logic

## v0.6.5.2 November 12, 2025

*Changed*

- Login Item Optimization: Enhanced interaction logic between LoginItemViewModel and SettingsView
- Registration Logic Fix: Updated login item registration logic to improve stability
- Internationalization Updates: Improved localization support for background activity management
- Label Text Optimization: Updated label text in SettingsView for better clarity

## v0.6.5.1 November 12, 2025

*Changed*

- Notion Sync Configuration Validation: Enhanced configuration validation logic
- Page Selection Feature: Added page selection functionality for Notion integration
- UI Handling Improvements: Optimized Notion page selection and interface handling logic

## v0.6.5 November 11, 2025

*Changed*

- Loading State Handling: Improved loading state management logic
- UI Simplification: Simplified page display logic in NotionIntegrationView
- Page Selection Enhancement: Optimized Notion page selection UI
- Sync Mode Cleanup: Removed unused sync mode UI elements

## v0.6.4 November 11, 2025

*Added*

- Custom Clipboard Operations: Implemented custom clipboard and selection commands in EditCommands
- StatusBarController: Added status bar controller for the Helper app

*Fixed*

- Logic Sequence Fix: Corrected configuration check → pass → send notification → execute task flow
- Mac App Store Links: Updated Mac App Store links in documentation
*Changed*

- Scheme Management: Cleaned up scheme management plist file, removed unused entries
- Project Configuration: Updated SyncNosHelper project configuration

## v0.6.3 November 11, 2025

*Added*

- Menu Bar Functionality: Implemented MenuBarViewModel and MenuBarView to enhance sync functionality
- Custom Menu Bar Icon: Added custom menu bar icon for the SyncNos application
- Modular Processing: Modularized command handling to improve code maintainability

*Changed*

- Project Configuration: Updated project file to include file system synchronization exception configuration
- Bundle Identifier Fix: Updated PRODUCT_BUNDLE_IDENTIFIER
- Helper App Updates: Adjusted app icon handling, optimized helper app behavior

## v0.6.2.3 November 10, 2025

*Added*

- Background Activity Service Enhancement: Enhanced background activity service to improve background task management
- Helper App Refactor: Refactored SyncNosHelper app structure and removed ContentView
- File System Synchronization: Added file system synchronization exception configuration for SyncNosHelper target
- Background Mode: Enabled background mode for the application

*Changed*

- Background Activity Integration: Implemented background activity service for automatic syncing
- Data Source Selection: Refactored data source selection logic in MainListView
- Apple Books Integration: Added button to open Apple Books notes in AppleBooksListView
- Logging Protocol Update: Updated logging protocol and fixed debug logging in DatabaseQueryService

## v0.6.2.2 November 10, 2025

*Added*

- Status Bar Controller: Added HelperStatusBarController for the Helper app
- SharedDefaults Migration: Continued migration to SharedDefaults for managing user preferences
- Helper App Integration: Implemented helper app integration for background syncing

*Changed*

- Background Activity Management: Enhanced background activity management with thread-safe state handling
- Settings View Cleanup: Removed unused status text
- Background Activity Service: Improved logging in BackgroundActivityService
- Background Activity Management: Streamlined background activity management in ViewModel

## v0.6.2.1 November 9, 2025

*Added*

- Internationalization Support: Added i18n support for background activity management
- Status Bar Interaction: Added HelperStatusBarController for managing status bar interactions
- SharedDefaults Migration: Migrated user defaults to SharedDefaults for improved data management

*Changed*

- Background Mode: Updated plist key for background-only mode
- Background Activity Service: Removed HelperLauncher, enhanced background activity service
- Background Activity Management: Improved helper management in background activity service

## v0.6.2 November 9, 2025

*Added*

- Background Activity Service Enhancement: Enhanced BackgroundActivityService to improve background task management
- Helper App Refactor: Refactored SyncNosHelper app structure and removed ContentView
- File System Synchronization: Added file system synchronization exception configuration for SyncNosHelper target
- Background Mode: Enabled background mode for the application
- MainListView Refactor: Refactored data source selection logic in MainListView

*Changed*

- Background Activity Integration: Implemented background activity service for automatic syncing
- Apple Books Integration: Added button to open Apple Books notes in AppleBooksListView
- User Notifications Integration: Removed user notifications integration from AppDelegate and LoginItemViewModel
- Logging Enhancement: Improved logging mechanism in LoggerService
- CLAUDE.md Update: Updated documentation for clarity and added development commands

## v0.6.1 November 7, 2025

*Added*

- Notification Handling Enhancement: Enhanced notification handling in AppDelegate
- User Notifications Integration: Integrated User Notifications for app status updates
- Open at Login Technical Documentation: Added technical documentation for the login item feature

*Changed*

- Login Item Service Enhancement: Enhanced LoginItemService with migration for legacy helper registration
- SyncNosHelper App Update: Removed ContentView and updated initialization
- Project Configuration: Updated project configuration to support login item functionality

## v0.6.0 November 7, 2025

*Added*

- Login Item Service Implementation: Implemented LoginItemService and integrated it into settings
- SyncNosHelper App: Added initial implementation of SyncNosHelper app
- Background Login Item Status Retrieval: Improved background login item status retrieval

*Changed*

- Removed LoginHelper App: Removed LoginHelper app and associated assets
- Login Item Status: Improved background login item status retrieval
- Project Configuration: Updated project configuration to support new login item implementation

## v0.5.11.6 November 7, 2025

*Added*

- Auto-save Functionality: Implemented auto-save functionality in AppleBooks and GoodLinks settings views

*Changed*

- Documentation Update: Updated CLAUDE.md documentation
- Project Maintenance: Project configuration and build optimization

## v0.5.11.5 November 6, 2025

*Changed*

- Notification Handling: Improved notification handling in AppleBooks and GoodLinks view models
- Auto-sync Optimization: Updated AutoSyncService to include all links in the sync process
- Sync Triggers: Added per-source immediate triggers for AutoSyncService

## v0.5.11.4 November 6, 2025

*Added*

- Failed Task Management: Added failed tasks section in SyncQueueView to improve task management
- Sync Queue Enhancement: Enhanced sync queue management to track failed tasks

*Changed*

- Error Handling: Enhanced error handling in GoodLinksQueryService
- UI Update: Updated MainListView toolbar with emoji buttons to differentiate content sources

## v0.5.11.3 November 5, 2025

*Changed*

- Notification Handling: Improved notification handling in AppleBooks and GoodLinks view models
- Auto-sync Optimization: Updated AutoSyncService to include all links in the sync process
- Sync Triggers: Added per-source immediate triggers for AutoSyncService

## v0.5.11.2 November 5, 2025

*Changed*

- UI Improvement: Updated MainListView toolbar with emoji buttons to differentiate content sources

## v0.5.11.1 November 4, 2025

*Added*

- Sync Task Navigation: Enhanced sync task selection and navigation functionality
- Sync Queue Navigation: Implemented navigation to sync task detail from sync queue

*Changed*

- Date Handling: Updated date handling in Notion synchronization services to use system timezone
- Documentation Update: Updated ChangeLog

## v0.5.11 November 4, 2025

*Changed*

- Notion Integration Optimization: Improved iBooks link encoding in NotionHelperMethods to enhance link processing accuracy.
- Highlight Processing Enhancement: Optimized highlight link and metadata processing logic.
- Sync Strategy Update: Updated AppleBooksSyncStrategy to use token-based highlight mapping.
- Code Cleanup: Removed obsolete and invalid methods in NotionHelperMethods.

## v0.5.10 November 2, 2025

*Added*

- New Feature: Implemented highlight color management functionality for Apple Books and GoodLinks.

*Changed*

- Architecture Refactor: Modularized command structure, split into independent command files for improved maintainability.

## v0.5.9.3 November 2, 2025

*Added*

- Sync Queue Management: Implemented sync queue management and UI interface, added source identification badges for tasks.
- Global Concurrency Control: Implemented global concurrency limiter to optimize sync operation performance.

*Changed*

- API Optimization: Improved Notion API read/write rate limiting mechanism, enhanced sync stability.
- Sync Queue Refactor: Optimized SyncQueueView layout and functionality, integrated into InfoHeaderCardView and MainListView.
- Concurrency Control Enhancement: Integrated concurrency limiter in AppleBooksDetailViewModel and GoodLinksViewModel.
- UI Improvements: Removed sync queue window, updated sync queue layout and background styles.
- Logging Mechanism: Improved logging mechanism in LoggerService.
- State Management: Optimized sync state management in GoodLinksViewModel.

## v0.5.9.2 October 30, 2025

*Added*

- Sync Queue: Implemented sync queue management and UI interface.

*Changed*

- UI Optimization: Unified toolbar structure in AppleBooksDetailView and GoodLinksDetailView.
- Layout Improvements: Reorganized LogWindow layout and toolbar integration, updated SyncQueueView layout and navigation.

## v0.5.9.1 October 30, 2025

*Changed*

- Scroll Experience Optimization: Improved scroll behavior in AppleBooksDetailView and GoodLinksDetailView.
- UI Fine-tuning: Enhanced optional expand state binding in ArticleContentCardView, disabled text selection to improve user experience.

## v0.5.8 October 30, 2025

*Added*

- Internationalization Support: Added multi-language internationalization support for the application.
- Sync Monitoring: Implemented sync activity monitoring and application termination handling.
- Content Enhancement: Enhanced ArticleContentCardView to support custom content slots, added titles and sync progress messages for multi-selection placeholder views.
- Fallback Mechanism: Added fallback content handling for GoodLinksDetailView.

*Changed*

- UI Improvements: Enhanced MainListView layout and style, updated icons in AppleBooksDetailView and GoodLinksDetailView for consistency.
- Link Display: Updated link colors in GoodLinksDetailView for better visibility, clarified fallback message clarity.
- License Update: Updated license in README file from GPL-3.0 to AGPL-3.0.

## v0.5.7.2 October 28, 2025

*Changed*

- UI Optimization: Updated AppCommands menu icons for better clarity, replaced Toggle with Button in FiltetSortBar and AppCommands for note filtering, maintained compact mask for highlight selection in ViewModels.
- Feature Enhancement: Implemented color filter selection in ViewModels, unified filtering and sorting experience.

## v0.5.7.1 October 28, 2025

*Added*

- Global Settings: Synchronized global highlight settings in AppleBooks and GoodLinks view models, added global highlight sorting and filtering options in AppCommands.

*Changed*

- State Management Optimization: Optimized UserDefaults usage and enhanced debounce mechanism in ViewModels, enhanced sync notifications in GoodLinksViewModel, improved application restart process.
- Documentation Update: Removed ViewModels improvement plan document, streamlined project documentation structure.

## v0.5.7 October 28, 2025

*Changed*

- Architecture Refactor: Simplified AppCommands structure, removed unused reset filter functionality in detail views, updated toolbar item positions in detail views.
- Component Update: Replaced FilterBar with FiltetSortBar in AppleBooks and GoodLinks detail views, enhanced concurrency and service-level Sendable compliance.

## v0.5.6.7 October 28, 2025

*Changed*

- Code Optimization: Removed syncToNotion method from AppleBookDetailViewModel, merged highlight filtering and sorting into GoodLinksViewModel to improve consistency.
- Feature Enhancement: Enhanced sorting functionality in GoodLinksDetailViewModel and UI components, added GoodLinksDetailViewModel and FilterBar to enhance filtering options.

## v0.5.6.6 October 27, 2025

*Changed*

- Parsing Optimization: Enhanced EPUB CFI parsing capability in AppleBooksLocationParser, optimized highlight sorting mechanism in AppleBookDetailView.
- UI Improvements: Refined sorting field display, corrected syntax errors in AppleBookDetailView, simplified sorting options and hidden menu indicators.

## v0.5.6.5 October 26, 2025

*Changed*

- Interaction Improvements: Implemented selection commands for AppleBooksListView and GoodLinksListView, updated deselect button icon in AppCommands.

## v0.5.6.3 October 25, 2025

*Added*

- Deep Integration: Added context menu options for Apple Books and GoodLinks to directly open applications, added deep linking functionality for GoodLinks.

*Changed*

- UI Improvements: Optimized last sync time display logic in AppleBooksListView and GoodLinksListView, enhanced user experience feedback.

## v0.5.6.2 October 24, 2025

*Added*

- Notion Integration Enhancement: Added "Last Sync Time" property to Notion database and updated page properties, providing more detailed sync status information.

## v0.5.6.1 October 24, 2025

*Changed*

- Database Management: Implemented serialized database creation mechanism in NotionService, ensuring consistency and stability of database operations.

## v0.5.5.1 October 24, 2025

*Changed*

- Documentation Adjustment: Rolled back planning documents, maintained project documentation conciseness and practicality.

## v0.5.5 October 17, 2025

*Added*

- Sync Experience Improvement: Enhanced sync feedback and added progress tracking for batch sync, displayed last sync time for selected items.

*Changed*

- UI Cleanup and Optimization: Removed redundant sync buttons and related context menus, simplified `MainListView` layout and improved item selection feedback.
- Concurrency Control Unification: Unified and strengthened batch sync concurrency control logic, improved sync stability and consistency.

## v0.5.4 October 17, 2025

*Added*

- Batch Sync: Added batch sync functionality for selected items in Apple Books and GoodLinks, improved operation efficiency.
- Filtering and Sorting: Implemented filtering and sorting options for Apple Books and GoodLinks, flattened filter menu structure to simplify operations.

*Fixed*

- Fixed error log writing thread issue in batch sync, ensured safe log recording on main thread.

## v0.5.3.1 October 17, 2025

*Changed*

- Feature Experiment: Added Markdown support for article and highlight views (rolled back in later versions).

## v0.5.3 October 15, 2025

*Added*

- Sign in with Apple Backend Enhancement: Implemented Apple ID token verification, nonce support, and more secure JTI storage, improved Apple login flow.

*Changed*

- Backend Refactor and Type Improvements: Updated user models and security dependencies to improve type handling and security.

*Docs*

- Added Sign in with Apple development guide and updated README and related documentation.

## v0.5.2 October 15, 2025

*Added*

- Logging and Debugging: Added log window with export/share functionality, improved log filtering and level options, enhanced debugging experience.

*Changed*

- UI Fine-tuning: Optimized labels and icons in several settings views, improved readability and consistency.

## v0.5.1 October 15, 2025

*Added*

- Backend and Authentication: Initialized FastAPI backend skeleton, added user authentication and Apple OAuth support (backend initial implementation).

*Changed*

- Account and Permissions: Improved token retrieval logic in `AccountViewModel` and added Apple Sign In permission configuration (entitlements) to the project.

*Docs*

- Updated AppleBooks/GoodLinks localization strings and related documentation, Changelog entries.

## v0.4.15 October 12, 2025

*Changed*

- Settings Refactor: Split settings into per-source (AppleBooks/GoodLinks) management, moved data authorization buttons to corresponding source settings, removed global autoSync, adopted per-source switches with clearer navigation and icons.

*Fixed*

- Notion Integration Fix: Fixed issue with Notion-related ViewModels using generic `databaseIdForSource`, improved per-source configuration usage flow.

## v0.4.14 October 12, 2025

*Changed*

- Notion Configuration Enhancement: Provided optional database ID configuration for AppleBooks and GoodLinks, refactored `NotionConfigStore` and `NotionService` to improve configuration management.
- GoodLinks Improvements: Refactored sorting and filtering logic for GoodLinks list, moved toolbar to main list for unified experience; renamed and cleaned up several views and enums.

## v0.4.13 October 11, 2025

*Added*

- Notion Feature Extension (Experimental): Introduced page-level database mapping and sub-database lookup functionality, feature flag to control sub-block/sub-database lookup behavior; added Notion API version upgrade and rate limit retry support.
- Concurrent Sync: `AutoSyncService` supports concurrent sync (up to 10 books), improved sync throughput and stability.

## v0.4.12.1 October 11, 2025

*Fixed*

- Fixed MainList background handling and default background settings, completed GoodLinks sorting and filtering implementation.

*Changed*

- ViewModel and Performance Optimization: Abstracted and injected timestamp storage (`SyncTimestampStore`), removed unused imports, cleaned up multiple ViewModels; used Combine to optimize IAP state monitoring and remove redundant object change notifications.

## v0.4.12 October 11, 2025

*Added*

- AppleBooks Features: Implemented sorting and filtering functionality for highlights and books, simplified related menu structure to improve usability.

*Changed*

- State Management Refactor: Replaced sorting/filtering state from `@AppStorage` with injection through `UserDefaults` to simplify state dependencies and testing.
- Reusability Improvements: Extracted shared UI components to reduce duplication and refactored several views and project file updates.
