# 仓库指南

SyncNos 是一款 macOS 应用，将 Apple Books、GoodLinks、微信读书、得到和微信聊天 OCR 中的高亮笔记同步到 Notion。

## 项目结构

```
SyncNos/
├── SyncNos/                     # 源代码
│   ├── Models/                  # 数据模型（DTO、缓存模型）
│   ├── ViewModels/              # MVVM 视图模型
│   ├── Views/                   # SwiftUI 视图
│   └── Services/                # 业务服务层
│       ├── Core/                # 核心服务（DI、日志、加密）
│       ├── DataSources-From/    # 数据源适配器
│       └── DataSources-To/      # 同步目标适配器
├── .github/docs/                 # 开发指南文档
└── Resource/                    # 资源文件
```

## 构建与运行

```bash
open SyncNos.xcodeproj           # 打开项目
xcodebuild -scheme SyncNos build # 构建
```

目标平台：macOS 14.0+，Swift 6.0+

## 代码风格

- **架构**：MVVM + Protocol-Oriented Programming
- **缩进**：4 空格
- **命名**：Swift API Design Guidelines（驼峰命名）
- **注释**：中文注释，`// MARK:` 分隔代码区块
- **协议优先**：所有服务通过协议定义，通过 `DIContainer` 注入

## 核心规范

| 规范 | 路径 |
|------|------|
| 架构与业务 | `SyncNos/AGENTS.md` |
| SwiftData 后台服务 | `SyncNos/Services/AGENTS.md` |
| 动态字体 | `SyncNos/Services/Core/AGENTS.md` |
| OCR 技术 | `SyncNos/Services/DataSources-From/OCR/AGENTS.md` |
| 键盘导航 | `SyncNos/Views/Components/Main/AGENTS.md` |

## 开发指南

| 指南 | 路径 |
|------|------|
| 添加新数据源 | `.github/docs/添加新数据源完整指南.md` |
| 添加新同步目标 | `.github/docs/添加新同步目标完整指南.md` |

## 提交规范

遵循 Conventional Commits：

```
feat: 添加 Obsidian 同步支持
fix: 修复 WeRead 登录超时问题
docs: 更新 AGENTS.md 文档
refactor: 重构 NotionSyncEngine
```

## 测试

当前无自动化测试套件。服务层通过协议定义，支持依赖注入，便于后续添加单元测试。
