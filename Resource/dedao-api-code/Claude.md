# 得到课程下载桌面端 - 项目文档

## 项目概述

这是一个基于 **Wails + Go + Vue** 构建的《得到》APP 课程下载桌面客户端。

### 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 后端 | Go | 1.23+ |
| 桌面框架 | Wails | v2.10.2 |
| 前端框架 | Vue | 3.5+ |
| 状态管理 | Pinia | 3.x |
| UI 组件库 | Element Plus | 2.11+ |
| 构建工具 | Vite | 7.x |
| 语言 | TypeScript | 5.x |

### 核心功能

- ✅ 扫码登录得到账号
- ✅ 查看购买的课程、课程详情、文章列表
- ✅ 播放课程音频
- ✅ 查看听书书架、电子书架
- ✅ 下载课程 PDF、Markdown 文档、MP3 音频
- ✅ 下载电子书（PDF、HTML、EPUB 格式）
- ✅ 支持亮色/暗色主题切换
- ✅ 查看知识城邦

---

## 项目结构

```
dedao-gui/
├── main.go                 # 应用入口
├── wails.json              # Wails 配置
├── go.mod                  # Go 依赖管理
├── backend/                # Go 后端代码
│   ├── app.go              # Wails 应用生命周期
│   ├── app/                # 前端绑定的方法（暴露给前端调用）
│   │   ├── article.go      # 文章相关
│   │   ├── course.go       # 课程相关
│   │   ├── download.go     # 下载相关
│   │   ├── ebook.go        # 电子书相关
│   │   ├── login.go        # 登录相关
│   │   └── ...
│   ├── config/             # 配置管理
│   │   ├── config.go       # 配置文件读写
│   │   └── dedao.go        # 得到服务配置
│   ├── services/           # 得到 API 服务层（核心）
│   │   ├── service.go      # 基础服务、HTTP 客户端
│   │   ├── requester.go    # 所有 API 请求方法
│   │   ├── login.go        # 登录服务
│   │   ├── course.go       # 课程服务
│   │   ├── ebook.go        # 电子书服务
│   │   └── ...
│   ├── downloader/         # 下载器
│   └── utils/              # 工具函数
├── frontend/               # Vue 前端代码
│   ├── src/
│   │   ├── App.vue         # 根组件
│   │   ├── main.ts         # 入口
│   │   ├── views/          # 页面组件
│   │   ├── components/     # 通用组件
│   │   ├── stores/         # Pinia 状态管理
│   │   └── router/         # 路由配置
│   └── wailsjs/            # Wails 生成的前端绑定
├── build/                  # 构建资源
└── scripts/                # 构建脚本
```

---

## API 文档

完整的得到 API 文档请参阅：[DedaoAPI.md](./DedaoAPI.md)

---

## Mac 部署指南

### 前置依赖

1. **Go 1.23+**
   ```bash
   # 使用 Homebrew 安装
   brew install go
   
   # 验证版本
   go version
   ```

2. **Node.js 18+ 和 npm**
   ```bash
   # 使用 Homebrew 安装
   brew install node
   
   # 或使用 nvm
   nvm install 18
   nvm use 18
   
   # 验证版本
   node --version
   npm --version
   ```

3. **Wails CLI**
   ```bash
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   
   # 验证安装
   wails doctor
   ```

4. **（可选）wkhtmltopdf** - 电子书转 PDF
   ```bash
   brew install wkhtmltopdf
   ```

5. **（可选）ffmpeg** - 音频合成
   ```bash
   brew install ffmpeg
   ```

### 构建步骤

```bash
# 1. 克隆项目
git clone https://github.com/yann0917/dedao-gui.git
cd dedao-gui

# 2. 安装前端依赖
cd frontend
npm install
cd ..

# 3. 开发模式运行
wails dev

# 4. 构建生产版本
wails build --clean

# 或使用脚本构建 macOS ARM 版本
cd scripts
./build-macos-arm.sh

# 构建通用版本（Intel + ARM）
./build-macos.sh
```

### 构建产物

构建完成后，应用程序位于：
```
build/bin/dedao-gui.app
```

### 配置文件位置

用户配置和登录信息存储在：
```
~/.config/dedao/config.json
```

如果遇到登录问题，可以删除此文件重新登录：
```bash
rm -rf ~/.config/dedao/config.json
```

---

## 注意事项

1. **版权声明**：本项目仅供个人学习使用，请尊重版权，内容版权均为得到所有，请勿传播内容。

2. **496 错误**：如果遇到 `496 NoCertificate` 消息提示，请登录网页版进行图形验证码验证。

3. **Cookie 失效**：在本应用登录后再登录官方网页版会导致保存的 cookie 失效，需要删除配置文件后重新登录。

4. **反爬虫机制**：项目内置了请求限流和重试机制，避免触发得到的反爬虫保护。

---

## 开发说明

### 前后端通信

Wails 通过代码生成实现前后端绑定：

1. 后端在 `backend/app/*.go` 中定义方法
2. Wails 自动生成 `frontend/wailsjs/go/backend/App.js` 绑定文件
3. 前端直接调用这些方法

```typescript
// 前端调用示例
import { CourseList } from '../wailsjs/go/backend/App'

const courses = await CourseList('course', 'study', 1, 18)
```

### 添加新 API

1. 在 `backend/services/requester.go` 添加请求方法（`req*` 前缀）
2. 在对应的服务文件（如 `course.go`）添加业务方法
3. 在 `backend/app/` 对应文件中添加前端绑定方法
4. 运行 `wails dev` 或 `wails build` 自动生成前端绑定

### 服务层文件说明

| 文件 | 说明 |
|------|------|
| `service.go` | HTTP 客户端初始化、Cookie 管理、响应处理 |
| `requester.go` | 所有底层 HTTP 请求方法 |
| `login.go` | 登录相关业务逻辑 |
| `user.go` | 用户信息、VIP 信息 |
| `course.go` | 课程列表、详情 |
| `course_category.go` | 课程分类、计数 |
| `chapter.go` | 章节数据结构 |
| `article.go` | 文章列表、详情、评论 |
| `ebook.go` | 电子书详情、页面、缓存 |
| `odob.go` | 每天听本书 |
| `media.go` | 音视频、火山引擎播放 |
| `topic.go` | 知识城邦话题 |
| `live.go` | 直播相关 |
| `comment.go` | 评论数据结构 |
| `sunflower.go` | 首页、搜索、推荐 |

---

## dedao-gui 与 dedao-dl 项目对比

### 项目概述

| 项目 | 类型 | 技术栈 | 特点 |
|------|------|--------|------|
| **dedao-gui** | 桌面 GUI 应用 | Wails + Go + Vue 3 | 可视化界面，适合普通用户 |
| **dedao-dl** | 命令行工具 | Go + Cobra CLI | 纯命令行，适合开发者和自动化 |

### API 数量对比

| 项目 | API 请求方法数 | 特有 API |
|------|---------------|----------|
| **dedao-gui** | 44 个 | 直播 API、火山引擎媒体、热门搜索、首页算法推荐 |
| **dedao-dl** | 31 个 | **电子书笔记 API**、学习圈频道 API、课程分组列表 |

### 功能对比

| 功能 | dedao-gui | dedao-dl |
|------|:---------:|:--------:|
| 扫码登录 | ✅ | ✅ |
| Cookie 登录 | ✅ | ✅ |
| 查看课程列表 | ✅ | ✅ |
| 下载课程 MP3 | ✅ | ✅ |
| 下载课程 PDF | ✅ | ✅ |
| 下载课程 Markdown | ✅ | ✅ |
| 查看电子书架 | ✅ | ✅ |
| 下载电子书 HTML | ✅ | ✅ |
| 下载电子书 PDF | ✅ | ✅ |
| 下载电子书 EPUB | ✅ | ✅ |
| **电子书笔记导出** | ❌ | ✅ |
| 查看听书书架 | ✅ | ✅ |
| 下载听书音频 | ✅ | ✅ |
| 查看知识城邦 | ✅ | ✅ |
| 直播功能 | ✅ | ❌ |
| 火山引擎播放器 | ✅ | ❌ |
| 热门搜索 | ✅ | ❌ |
| 首页推荐算法 | ✅ | ❌ |
| 学习圈频道 | ❌ | ✅ |
| 课程分组列表 | ❌ | ✅ |
| 名家讲书合集详情 | ❌ | ✅ |

### 选择建议

| 使用场景 | 推荐项目 |
|---------|---------|
| 日常使用、可视化操作 | **dedao-gui** |
| 批量下载、自动化脚本 | **dedao-dl** |
| **导出电子书笔记** | **dedao-dl** ⭐ |
| 观看直播 | **dedao-gui** |
| 开发参考（API 学习） | 两者都参考 |

### 如果要开发自己的应用

1. **API 参考**: 优先参考 `dedao-dl`，代码更简洁清晰
2. **笔记功能**: 必须参考 `dedao-dl`，因为 `dedao-gui` 没有实现
3. **直播/媒体播放**: 参考 `dedao-gui`，有完整的火山引擎集成
4. **首页推荐**: 参考 `dedao-gui`，有完整的算法推荐 API

---

*文档更新时间：2024年12月*
