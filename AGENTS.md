# SyncNos 项目导航

**SyncNos** 是一个 SwiftUI macOS 应用程序，用于将 Apple Books、GoodLinks、WeRead、Dedao（得到）和微信聊天 OCR 中的读书高亮和笔记同步到 Notion 数据库。

---

## 项目结构

```
SyncNos/
├── AGENTS.md                    # 👈 你在这里（项目入口）
├── SyncNos/                     # 源代码目录
│   ├── AGENTS.md                # 🔥 核心：架构规范 + 业务说明
│   ├── Models/                  # 数据模型
│   ├── ViewModels/              # 视图模型
│   ├── Views/                   # 视图
│   │   └── Components/Main/
│   │       └── AGENTS.md        # 键盘导航技术文档
│   └── Services/                # 服务层
│       ├── AGENTS.md            # SwiftData/@ModelActor 规范
│       ├── Core/
│       │   └── AGENTS.md        # 动态字体 + DIContainer
│       └── DataSources-From/
│           └── OCR/
│               └── AGENTS.md    # Apple Vision OCR 技术文档
├── .codex/docs/                 # 开发指南文档
└── Resource/                    # 资源文件
```

---

## 核心规范文档

| 文档 | 路径 | 内容 |
|------|------|------|
| **项目架构** | `SyncNos/AGENTS.md` | MVVM 规范、同步架构、依赖注入、协议驱动开发 |
| **SwiftData 规范** | `SyncNos/Services/AGENTS.md` | @ModelActor 后台服务实现规范 |
| **动态字体** | `SyncNos/Services/Core/AGENTS.md` | 字体缩放、DIContainer、日志服务 |
| **OCR 技术** | `SyncNos/Services/DataSources-From/OCR/AGENTS.md` | Apple Vision OCR 集成 |
| **键盘导航** | `SyncNos/Views/Components/Main/AGENTS.md` | 键盘快捷键、焦点管理 |

---

## 开发指南

| 文档 | 路径 | 用途 |
|------|------|------|
| 添加新数据源 | `.codex/docs/添加新数据源完整指南.md` | 完整的数据源开发流程 |
| 添加新同步目标 | `.codex/docs/添加新同步目标完整指南.md` | 添加 Obsidian、Lark 等目标 |
| 国际化翻译 | `.codex/docs/国际化翻译流程指南.md` | i18n 操作流程 |

---

## 技术栈

- **架构**: MVVM + Protocol-Oriented Programming
- **UI**: SwiftUI (macOS 14+)
- **响应式**: Combine
- **数据持久化**: SwiftData
- **语言**: Swift 5.9+ / Swift 6.0+

---

## 快速开始

```bash
# 打开项目
open SyncNos.xcodeproj

# 构建
xcodebuild -scheme SyncNos -configuration Debug build
```

---

## 核心功能

- ✅ Apple Books 高亮同步
- ✅ GoodLinks 文章同步
- ✅ WeRead（微信读书）同步
- ✅ Dedao（得到）同步
- ✅ 微信聊天 OCR 识别
- ✅ Notion 数据库同步
- ✅ 智能增量自动同步
- ✅ 16 种语言国际化
