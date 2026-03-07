# 仓库指南

SyncNos 仓库当前包含两条产品线：

- `SyncNos/`：macOS App，将 Apple Books、GoodLinks、微信读书、得到和微信聊天 OCR 中的高亮笔记同步到 Notion。
- `Extensions/WebClipper/`：浏览器扩展，抓取 AI 对话与网页文章，支持本地保存、导出、备份，以及同步到 Notion / Obsidian。

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
open SyncNos.xcodeproj                                  # 打开 macOS App 工程
xcodebuild -scheme SyncNos -configuration Debug build   # 构建 macOS App
npm --prefix Extensions/WebClipper install              # 安装 WebClipper 依赖
npm --prefix Extensions/WebClipper run dev              # 启动 WebClipper Chrome 开发模式
npm --prefix Extensions/WebClipper run build            # 构建 WebClipper Chrome 产物
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
| 仓库总览 | `README.md` |
| deepwiki 总入口 | `.github/deepwiki/INDEX.md` |
| deepwiki 业务入口 | `.github/deepwiki/business-context.md` |
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

WebClipper 发布产物（Chrome/Edge/Firefox 包）由 GitHub Actions 统一生成与上传，本地仅保留 WXT 开发与验证流程。

## 开发工作流

### 先判断产品线

- 开始任何仓库级理解、规划、评审或文档改动前，先读 `.github/deepwiki/business-context.md`；需要继续展开时，再从 `.github/deepwiki/INDEX.md` 进入对应专题页。
- 修改 `SyncNos/` 时，优先查看 `.github/deepwiki/modules/syncnos-app.md`、`SyncNos/AGENTS.md`、对应服务层 `AGENTS.md` 与业务文档，按 MVVM + 协议注入边界落点修改。
- 修改 `Extensions/WebClipper/` 时，优先查看 `.github/deepwiki/modules/webclipper.md`、`Extensions/WebClipper/AGENTS.md`，先确认变更属于 `background`、`content`、`popup` 还是 `app`。
- 若改动影响共享业务说明或仓库级入口文档，代码确认后同步更新相关 `AGENTS.md`、`.github/deepwiki/INDEX.md`、`.github/deepwiki/business-context.md` 与 `README.md`。

### SyncNos App 工作流

1. 先确认改动落点属于 `Models`、`Services`、`ViewModels` 还是 `Views`，避免跨层混杂职责。
2. 涉及数据源、同步目标、OCR、动态字体、键盘焦点等专项能力时，先读对应专项文档再动代码。
3. 优先通过协议与依赖注入改动 `Service` / `ViewModel`，避免直接引入全局状态或 UI 反向依赖。
4. 完成后至少执行一次 `xcodebuild -scheme SyncNos -configuration Debug build`，并补充 `SwiftUI #Preview` 或最小人工冒烟验证。

### WebClipper 工作流

1. 先确认职责边界：采集逻辑放 `collectors/content`，持久化与路由放 `background`，界面交互放 `popup` / `app`。
2. 权限、content scripts、消息协议、构建产物变更要同时检查 `wxt` 入口、manifest 结果与 CI 脚本是否一致。
3. 默认验证顺序使用：
   - `npm --prefix Extensions/WebClipper run compile`
   - `npm --prefix Extensions/WebClipper run test`
   - `npm --prefix Extensions/WebClipper run build`
4. 若改动涉及 Firefox、发布打包、manifest/content script 重写或产物完整性，再补：
   - `npm --prefix Extensions/WebClipper run build:firefox`
   - `npm --prefix Extensions/WebClipper run check`
5. 发布包与 AMO Source 包由 GitHub Actions 和 `.github/scripts/webclipper/*.mjs` 负责，本地以开发验证为主。

### 文档同步工作流

1. 先从代码和脚本确认实际行为，再更新文档，不根据旧文档互相抄写。
2. 涉及仓库级行为变化时，优先同步这些入口文档：
   - `AGENTS.md`
   - `.github/deepwiki/INDEX.md`
   - `.github/deepwiki/business-context.md`
   - `SyncNos/AGENTS.md` 或 `Extensions/WebClipper/AGENTS.md`
   - `README.md`
3. 未被明确要求时，不要查看或编辑国际化字段。

## 常用命令

### SyncNos App

- 打开工程：`open SyncNos.xcodeproj`
- Debug 构建：`xcodebuild -scheme SyncNos -configuration Debug build`

### WebClipper 开发与验证

- 安装依赖：`npm --prefix Extensions/WebClipper install`
- Chrome 开发模式：`npm --prefix Extensions/WebClipper run dev`
- Firefox 开发模式：`npm --prefix Extensions/WebClipper run dev:firefox`
- TypeScript 编译检查：`npm --prefix Extensions/WebClipper run compile`
- 单元测试：`npm --prefix Extensions/WebClipper run test`
- Chrome 构建：`npm --prefix Extensions/WebClipper run build`
- Firefox 构建：`npm --prefix Extensions/WebClipper run build:firefox`
- 产物校验：`npm --prefix Extensions/WebClipper run check`

### WebClipper 发布相关脚本

- Chrome/Firefox 发布产物打包：`node .github/scripts/webclipper/package-release-assets.mjs`
- AMO Source 包：`node .github/scripts/webclipper/package-amo-source.mjs`
- AMO 发布：`node .github/scripts/webclipper/publish-amo.mjs`

## 测试

当前仓库无强制自动化测试套件，但功能改动需要完成以下验证：

- 单元测试优先覆盖 `ViewModel` 和 `Service` 的核心逻辑（数据转换、状态变化、边界条件），通过协议 + 依赖注入 + Mock 隔离外部依赖。至少覆盖三类场景：数据转换、状态变化、边界条件（空数据、重复数据、异常数据）
- 使用 `SwiftUI #Preview` 做 UI 人工验证，至少覆盖加载态、错误态、空态和主流程态。
- 每次改动后执行最小冒烟：应用可启动、关键数据源可读取、至少一次同步成功、失败路径提示正确。
- 构建校验命令：`xcodebuild -scheme SyncNos -configuration Debug build`。
