# 仓库指南

SyncNos 是一款 macOS 应用，将 Apple Books、GoodLinks、微信读书、得到和微信聊天 OCR 中的高亮笔记同步到 Notion。

需要注意，当我没有明确说明的情况下，不要查看不要编辑国际化字段

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
├── Extensions/                  # 浏览器扩展
│   └── WebClipper/              # Browser Extension (MV3)
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
| OCR 技术 | `SyncNos/Services/DataSources-From/OCR/AppleVisionOCR技术文档.md` |
| 键盘导航 | `.github/docs/键盘导航与焦点管理技术文档（全项目）.md` |
| WebClipper 扩展 | `Extensions/WebClipper/AGENTS.md` |

## 开发指南

| 指南 | 路径 |
|------|------|
| 添加新数据源 | `SyncNos/Services/DataSources-From/添加新数据源完整指南.md` |
| 添加新同步目标 | `SyncNos/Services/DataSources-To/添加新同步目标完整指南.md` |
| WebClipper：Obsidian Local REST API 同步 | `.github/guide/obsidian/LocalRestAPI.zh.md` |

## 测试

当前仓库无强制自动化测试套件，但功能改动需要完成以下验证：

- 单元测试优先覆盖 `ViewModel` 和 `Service` 的核心逻辑（数据转换、状态变化、边界条件），通过协议 + 依赖注入 + Mock 隔离外部依赖。至少覆盖三类场景：数据转换、状态变化、边界条件（空数据、重复数据、异常数据）
- 使用 `SwiftUI #Preview` 做 UI 人工验证，至少覆盖加载态、错误态、空态和主流程态。
- 每次改动后执行最小冒烟：应用可启动、关键数据源可读取、至少一次同步成功、失败路径提示正确。
- 构建校验命令：`xcodebuild -scheme SyncNos -configuration Debug build`。
