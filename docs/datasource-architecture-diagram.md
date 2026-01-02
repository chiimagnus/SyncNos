# SyncNos 数据源架构图 (DataSource Architecture Diagram)

## 整体架构 (Overall Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SwiftUI Views (UI Layer)                           │
│  AppleBooksListView │ GoodLinksListView │ WeReadListView │ DedaoListView    │
│  ChatsListView      │ OCR Settings                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ViewModels (ObservableObject Layer)                       │
│  AppleBooksVM │ GoodLinksVM │ WeReadVM │ DedaoVM │ ChatsVM │ OCR VM         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DIContainer (Dependency Injection)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Service Layer (31 Classes)                           │
│  AppleBooks (7) │ GoodLinks (6) │ WeRead (7) │ Dedao (4) │ Chats (4) │ OCR (3)│
└─────────────────────────────────────────────────────────────────────────────┘
```

详细架构图请参见 DATASOURCE_ARCHITECTURE.md
