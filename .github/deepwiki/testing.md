# 测试

## 测试策略
| 产品线 | 主策略 | 自动化程度 | 核心目标 |
| --- | --- | --- | --- |
| SyncNos App | 构建校验 + SwiftUI Preview + 人工冒烟 | 低到中 | 确认 UI、数据源连接和一次完整同步都可工作。 |
| WebClipper | `compile` + `test` + `build` | 中到高 | 确认类型正确、关键逻辑稳定、产物可生成。 |
| 发布流程 | GitHub Actions workflow 校验 | 自动化 | 确认版本号、打包脚本和上传流程一致。 |

## macOS App 验证
| 场景 | 方法 | 期望 |
| --- | --- | --- |
| 工程可构建 | `xcodebuild -scheme SyncNos -configuration Debug build` | 无编译错误。 |
| ViewModel / Service 核心逻辑 | 优先补充单元测试或最小 mock 验证 | 覆盖数据转换、状态变化、边界条件。 |
| UI 状态切换 | `SwiftUI #Preview` / 人工检查 | 覆盖加载态、空态、错误态和主流程态。 |
| 同步冒烟 | 手动连接数据源并完成一次同步 | Notion 中出现对应数据库 / 页面。 |
| 键盘与焦点 | 参考专项文档逐项验证 | List / Detail、搜索面板与快捷键不串窗。 |

## WebClipper 自动化验证
| 命令 / 目录 | 覆盖点 | 备注 |
| --- | --- | --- |
| `npm --prefix Extensions/WebClipper run compile` | TypeScript 类型正确性 | 默认验证顺序第一步。 |
| `npm --prefix Extensions/WebClipper run test` | 单元测试 | 使用 Vitest。 |
| `npm --prefix Extensions/WebClipper run build` | Chrome / Edge 产物 | 验证 WXT 构建流程。 |
| `Extensions/WebClipper/tests/unit/markdown-renderer.test.ts` | Markdown 渲染 | 防止消息气泡渲染回归。 |
| `Extensions/WebClipper/tests/unit/notion-sync-cursor.test.ts` | Notion 游标逻辑 | 保证增量同步判断正确。 |
| `Extensions/WebClipper/tests/storage/conversations-idb.test.ts` | IndexedDB 数据访问 | 验证 conversations 存储。 |
| `Extensions/WebClipper/tests/storage/schema-migration.test.ts` | Schema 迁移 | 防止本地数据库升级破坏旧数据。 |

## 手动冒烟流程
1. 对 App：启动应用、确认主窗口与设置窗口可打开、连接至少一个数据源、完成一次同步、再触发一次增量同步。
2. 对 WebClipper：在一个支持站点和一个普通网页上验证 inpage 行为，检查 popup 中会话是否落库，执行一次导出或 Notion / Obsidian 手动同步。
3. 对发布链路：至少确认 workflow 文件、打包脚本与 manifest 版本规则一致，避免 tag 后才暴露问题。

## 示例片段
### 片段 1：WebClipper 的自动化入口高度集中在 package.json
```json
"compile": "tsc --noEmit",
"check": "npm run build && node ../../.github/scripts/webclipper/check-dist.mjs --root=Extensions/WebClipper/.output/chrome-mv3",
"test": "vitest run"
```

### 片段 2：App 侧的测试重点由仓库规范直接给出
```text
至少覆盖三类场景：数据转换、状态变化、边界条件（空数据、重复数据、异常数据）。
```

## 常见失败点
| 失败点 | 容易出现的位置 | 建议检查 |
| --- | --- | --- |
| App 只通过编译但未做同步冒烟 | 数据源 / Notion 集成改动 | 至少做一次“读取 → 同步 → 结果校验”。 |
| WebClipper 只跑 `build` 不跑 `compile` / `test` | Collector、消息协议、同步逻辑改动 | 按默认顺序执行 compile → test → build。 |
| 发布 workflow 版本不一致 | `wxt.config.ts` 与 tag | 本地提交前先核对 manifest 版本。 |
| 键盘导航回归 | `Views/Settings/Commands/`、`MainListView+KeyboardMonitor.swift` | 对照专项文档验证窗口过滤与焦点恢复。 |

## 回归优先级
| 优先级 | 场景 | 原因 |
| --- | --- | --- |
| P0 | Notion 授权 / Parent Page / 同步主链路 | 直接影响核心价值交付。 |
| P1 | 本地存储、备份导入导出、Obsidian 同步 | 影响用户数据完整性。 |
| P1 | collector 解析规则与消息协议 | 影响采集范围与 UI 稳定性。 |
| P2 | 菜单栏模式、键盘焦点、字体缩放 | 影响体验但通常不阻断主流程。 |

## 来源引用（Source References）
- `AGENTS.md`
- `SyncNos/AGENTS.md`
- `SyncNos/Services/AGENTS.md`
- `.github/docs/键盘导航与焦点管理技术文档（全项目）.md`
- `Extensions/WebClipper/AGENTS.md`
- `Extensions/WebClipper/package.json`
- `Extensions/WebClipper/tests/unit/markdown-renderer.test.ts`
- `Extensions/WebClipper/tests/unit/notion-sync-cursor.test.ts`
- `Extensions/WebClipper/tests/storage/conversations-idb.test.ts`
- `Extensions/WebClipper/tests/storage/schema-migration.test.ts`
