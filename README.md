# SyncBookNotes 📚

[![macOS](https://img.shields.io/badge/macOS-13+-blue.svg)](https://developer.apple.com/macos/)
[![SwiftUI](https://img.shields.io/badge/SwiftUI-5.0-orange.svg)](https://developer.apple.com/documentation/swiftui/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

SyncBookNotes 帮你把 Apple Books 的高亮与注释变成可导出的数据，目标是让笔记可以被长期保存、搜索和同步到第三方工具（如Notion）。

<p align="center">
  <img src="https://user-images.githubusercontent.com/placeholder-image.jpg" alt="SyncBookNotes 主界面" width="600"/>
</p>

## 🌟 为什么使用

- **直接导出**：无需手动复制粘贴，一键读取 Apple Books 笔记
- **多种格式**：导出为 JSON/Markdown，便于归档或导入其他笔记工具
- **精美展示**：采用瀑布流布局，优雅展示读书笔记
- **安全访问**：使用安全范围书签机制，保护用户隐私

## 🚀 主要功能

### ✅ 已实现功能
- 从本地 Apple Books 数据库读取高亮与注释
- 导出为 JSON、Markdown 格式
- 按书名/作者/assetId 过滤导出内容
- 分页加载大量笔记数据
- 瀑布流布局展示笔记
- 支持在 Apple Books 中打开特定笔记位置

### 🔄 计划中功能
- 扩展到更多的无官方同步笔记的平台
- 直接同步到 Notion 等第三方工具
- 批量导出和自动化同步

## 🛠 技术架构

### 核心技术
- **SwiftUI**：现代化声明式 UI 框架
- **MVVM 架构**：清晰的分层设计模式
- **SQLite3**：高效访问 Apple Books 数据库
- **原生框架**：无第三方依赖，轻量级应用

### 架构设计
```
macOS/
├── Models/       # 数据模型定义
├── Services/     # 数据库访问和业务逻辑
├── ViewModels/   # 连接数据和UI的桥梁
└── Views/        # SwiftUI 用户界面组件
```

## ❓ 常见问题

### 我可以直接同步到 Notion 吗？
目前支持导出功能，Notion 同步为后续计划功能。

### 支持批量导出吗？
支持按书籍批量导出（在 UI 中选择多个书籍）。

### 如何保证数据安全？
应用使用安全范围书签机制访问数据库，不会存储用户敏感信息。

## 🤝 贡献

欢迎提交 Issue 或 PR：
- 🐛 报告 bug 或提出改进建议
- 🎨 提交 UI/UX 改进方案
- ✨ 添加新功能或优化现有功能
- 📖 完善文档和使用说明

简单明了地描述问题或改进点即可。

## 📄 许可证

本项目采用 GPL-3.0 License