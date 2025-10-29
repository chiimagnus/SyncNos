# SyncNos 📚

[![macOS](https://img.shields.io/badge/macOS-13+-blue.svg)](https://developer.apple.com/macos/)
[![SwiftUI](https://img.shields.io/badge/SwiftUI-5.0-orange.svg)](https://developer.apple.com/documentation/swiftui/)
[![License](https://img.shields.io/badge/license-GPL3.0-green.svg)](LICENSE)
[![](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-%E4%B8%AD%E6%96%87%E7%89%88-ff0000?style=flat)](README.md)
[![](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-000aff?style=flat)](README_EN.md)

[<img src="Resource/image.png" alt="Download on the Mac App Store" width="200">](https://apps.apple.com/app/syncnos/id6752426176)

> **SyncNos** - 专业的阅读笔记同步工具，将 Apple Books 和 GoodLinks 中的高亮与注释无缝同步到 Notion，支持多种同步策略和强大的自定义功能。

## ✨ 主要功能

### 📚 Apple Books 同步
- **完整数据提取**：书名、作者、高亮笔记、注释、颜色标签
- **时间戳支持**：创建时间和修改时间的精确同步
- **智能分页**：大量数据的分页处理，确保性能优化
- **数据库监控**：自动检测最新的 Apple Books 数据库文件

### 🔗 GoodLinks 同步
- **文章内容同步**：标题、链接、全文内容、标签
- **高亮笔记**：支持 GoodLinks 的所有高亮功能
- **标签解析**：完整的标签系统支持
- **批量处理**：高效处理大量文章数据

### 🔄 智能同步策略
- **单库模式**：所有内容在一个 Notion 数据库中统一管理
- **分库模式**：每本书/文章单独创建数据库，便于组织
- **幂等同步**：基于 UUID 确保不重复同步
- **增量同步**：基于时间戳的智能增量更新

### 🎯 高级功能
- **自动同步**：可配置的后台定时同步
- **实时状态**：同步进度的实时显示
- **错误重试**：智能的错误重试机制
- **Apple 登录**：安全的 Apple ID 认证集成

## 🚀 快速开始

### 方式一：Mac App Store 安装（推荐）

1. **下载应用**
   - 访问 [Mac App Store](https://apps.apple.com/app/syncnos/id6752426176)
   - 点击"获取"安装应用

2. **配置 Notion**
   - 打开 [Notion 集成页面](https://www.notion.so/profile/integrations)
   - 创建新的集成，获取 API Token
   - 在 Notion 中创建数据库，获取数据库 ID

3. **设置 SyncNos**
   - 打开 SyncNos 应用
   - 在设置中输入 Notion API Token 和数据库 ID
   - 点击"保存"完成配置

### 方式二：源码编译安装

#### 环境要求
- macOS 13.0+
- Xcode 15.0+
- Swift 5.0+

#### 编译步骤

```bash
# 克隆仓库
git clone https://github.com/chiimagnus/SyncNos.git
cd SyncNos

# 打开 Xcode 项目
open SyncNos.xcodeproj

# 或使用命令行编译
xcodebuild -scheme SyncNos -configuration Debug build
```

## 📄 许可证

本项目采用 [AGPL-3.0 License](LICENSE)。

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给我们一个 Star！**

Made with ❤️ by [Chii Magnus](https://github.com/chiimagnus)

</div>