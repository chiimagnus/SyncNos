# SyncBookNotes

一个用于导出Apple Books高亮笔记和注释的命令行工具，可以将数据保存为JSON格式，便于同步到Notion或其他笔记应用。

## 功能特点

- 导出Apple Books中的高亮文本和笔记
- 支持按书名、作者、资产ID过滤
- 输出JSON格式，便于后续处理和同步
- 支持美观格式化输出
- 命令行界面，易于自动化

## 安装

### 通过Homebrew安装（推荐）

```bash
# 方式1：通过自定义Tap安装（推荐，适用于新项目）
brew tap chiimagnus/syncbooknotes
brew install syncbooknotes

# 方式2：如果项目被收录到Homebrew核心仓库，可以直接安装
# brew install syncbooknotes
```

安装后可以使用以下命令：
```bash
# 使用完整命令
syncbooknotes [命令] [选项]

# 或者使用简短别名
sbn [命令] [选项]
```

## 使用方法

### 基本命令

```bash
# 检查数据库信息
syncbooknotes inspect
# 或者使用别名
sbn inspect

# 列出所有书籍及其高亮数量
syncbooknotes list
# 或者使用别名
sbn list

# 导出所有书籍的笔记
syncbooknotes export
# 或者使用别名
sbn export
```

### 导出选项

```bash
# 导出到文件
syncbooknotes export --out notes.json

# 格式化输出（美化JSON）
syncbooknotes export --pretty --out notes.json

# 根据书名过滤
syncbooknotes export --book "书名" --out notes.json

# 根据作者过滤
syncbooknotes export --author "作者名" --out notes.json

# 根据资产ID过滤
syncbooknotes export --asset "资产ID" --out notes.json

# 组合过滤
syncbooknotes export --book "书名" --author "作者名" --out notes.json

# 多个过滤条件
syncbooknotes export --book "书名1" --book "书名2" --out notes.json
```

## Homebrew分发

Homebrew公式文件: `syncbooknotes.rb`

### 通过自定义Tap安装（当前方式）
```bash
brew tap chiimagnus/syncbooknotes
brew install syncbooknotes
```

### 未来可能的直接安装方式
如果项目被收录到Homebrew核心仓库，用户可以直接安装：
```bash
brew install syncbooknotes
```

安装后可以使用以下命令：
```bash
syncbooknotes [命令] [选项]
# 或者使用简短别名
sbn [命令] [选项]
```

## 许可证

GPL-3.0 License

## 贡献

欢迎提交Issue和Pull Request。