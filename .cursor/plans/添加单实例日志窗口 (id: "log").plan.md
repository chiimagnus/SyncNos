<!-- d0151e75-77f2-4c5b-994d-689dbf726659 f5ec63d0-cd7b-4e15-9c08-c18b8540f64e -->
# 添加单实例日志窗口 (id: "log")

简要说明

- 目标：在 `Window(id: "log")` 中显示应用运行时日志（单实例），支持实时追加（tail）、按级别过滤、清空和导出。日志来源使用现有 `LoggerService`，并通过 Combine 发布到 UI。

修改点（按优先级）

- **扩展日志服务**
- 文件：`SyncNos/Services/Infrastructure/LoggerService.swift`
- 要点：在现有的 `LoggerService` 中新增一个 `PassthroughSubject<LogEntry, Never>` 或 `CurrentValueSubject<[LogEntry], Never>`，并提供 `clear()` 与 `export(to:)` 接口；保留现有 `log(...)` 行为但同时将条目发送到这个 subject。保留单例用法（当前项目中 DIContainer 仍可使用）。

- **新增 ViewModel**
- 文件：`SyncNos/ViewModels/LogViewModel.swift`（新建）
- 要点：实现 `ObservableObject`，暴露 `@Published var entries: [LogEntry]`、`@Published var levelFilter: LogLevel`。订阅 `LoggerService` 的 subject，应用级别过滤并在新条目到达时追加（滚动到底部逻辑由 View 控制）。提供 `clear()` 与 `export()` 调用转发到 `LoggerService`。

- **新增 View（窗口）**
- 文件：`SyncNos/Views/Components/LogWindow.swift`（新建）
- 要点：使用 `@StateObject private var viewModel = LogViewModel()`；界面包含可滚动的 `Text`/`List` 展示日志行、顶部 toolbar (级别选择器、清空按钮、导出按钮)、自动滚到底部（当新条目到达且用户未滚动到顶部时）。窗口标题："Logs"。遵循 macOS 样式（.windowResizability(.contentSize) 可选）。

- **在 App 场景中注册窗口**
- 文件：`SyncNos/SyncNosApp.swift`（编辑）
- 要点：新增一个单例窗口声明：
- `Window("Logs", id: "log") { LogWindow() }`
- 可选：`.windowResizability(.contentSize)`。

- **在应用命令里添加打开日志窗口的菜单项**
- 文件：`SyncNos/AppCommands.swift`（编辑）
- 要点：在合适的位置添加 `Button("Show Logs") { openWindow(id: "log") }` 并设定快捷键（例如 Cmd+L）以便快速打开。

设计与实现细节（重要）

- 日志数据结构：新增 `struct LogEntry { let id: UUID; let timestamp: Date; let level: LogLevel; let message: String; let file: String; let line: Int; let function: String }`（放在 `LoggerService.swift` 或 `Models/` 中，视项目风格）。
- Publish 机制：使用 `PassthroughSubject<LogEntry, Never>`。ViewModel 在 init 中订阅并存入 `Set<AnyCancellable>`。
- 滚动到底部：在 `ScrollViewReader` 内使用 `withAnimation` 跳到最新 `id`；仅在用户未主动滚动查看旧条目时自动滚动（用 `isAutoScrollEnabled` 标志）。
- 导出：`LoggerService.export()` 将日志写入临时文件并通过 `NSOpenPanel`/`NSSavePanel` 显示保存对话框（或直接写入 `~/Downloads`）；UI 调用 viewModel.export() 并展示 `NSAlert` 成功/失败。
- 过滤：ViewModel 维护 `levelFilter`，UI 提供 Picker（All/Debug/Info/Warning/Error），并在收到新条目时根据 filter 决定是否追加到 `entries`。

回退与兼容性

- 若不希望修改 `LoggerService` 单例签名，可改为在 `DIContainer` 中注入一个 wrapper/publisher。计划中默认直接在 `LoggerService` 中加入 subject（最少改动、最直接）。

实现任务（todos）

- id: "extend-logger" content: "在 LoggerService 中添加 Combine subject、clear 与 export 接口" dependencies: []
- id: "add-log-vm" content: "新增 LogViewModel，订阅 LoggerService 并提供过滤/clear/export" dependencies: ["extend-logger"]
- id: "add-log-view" content: "新增 LogWindow SwiftUI 视图并实现滚动/工具栏" dependencies: ["add-log-vm"]
- id: "register-window-and-menu" content: "在 SyncNosApp 与 AppCommands 中注册 log 窗口与菜单项" dependencies: ["add-log-view"]

测试要点

- 在启动流程（`SyncNosApp.init`）或其他服务中调用 `DIContainer.shared.loggerService.info("test")`，并确认日志窗口实时显示。
- 验证过滤器只展示所选级别以上或匹配级别（按实现定义）。
- 验证清空按钮能清空 UI 中的条目（并可选清空服务侧持久化）。
- 验证导出能将当前日志导出到用户选定路径。

我将等待你确认此计划，然后开始按计划实施。若你同意，我会在实施前再创建并更新 todo 列表的状态，然后逐步编辑文件并运行 lint 检查。

### To-dos

- [ ] 在 LoggerService 中添加 Combine subject、clear 与 export 接口
- [ ] 新增 LogViewModel，订阅 LoggerService 并提供过滤/clear/export
- [ ] 新增 LogWindow SwiftUI 视图并实现滚动/工具栏
- [ ] 在 SyncNosApp 与 AppCommands 中注册 log 窗口与菜单项