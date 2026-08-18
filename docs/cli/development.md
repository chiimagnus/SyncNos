# SyncNos CLI 本地开发

本页只负责 CLI 的本地编译、运行、测试与打包。最终用户命令面见 [`packages/syncnoscli/README.zh-CN.md`](../../packages/syncnoscli/README.zh-CN.md)；Local Database 的共享数据契约见 [`../storage.md`](../storage.md)。

## 编译与运行

在仓库根目录安装依赖并构建 CLI：

```bash
npm ci
npm run compile:syncnoscli
npm run build:syncnoscli
```

构建产物是 `packages/syncnoscli/dist/cli.cjs`。开发时可以直接运行，不需要先全局安装：

```bash
node packages/syncnoscli/dist/cli.cjs --version
node packages/syncnoscli/dist/cli.cjs --help
node packages/syncnoscli/dist/cli.cjs doctor
node packages/syncnoscli/dist/cli.cjs stats
```

普通数据命令保持只读。开发环境中不要随意执行 `doctor --fix`；它会进入 Native Host registration / permission 修复路径，只有明确测试 lifecycle 时才应该使用。

## 测试

CLI 专项测试：

```bash
npm run test:syncnoscli
```

提交前仍以仓库统一 gate 为准：

```bash
npm run gate:ci
```

## 本地打包

只检查 npm 最终文件面、不生成 `.tgz`：

```bash
npm run pack:syncnoscli
```

这个命令实际使用 `npm pack --dry-run --json`。

需要真正生成本地 tarball 时：

```bash
cd packages/syncnoscli
npm pack
```

`npm pack` 会先执行 package 的 `prepack`，因此会重新运行 `node build.mjs`，随后生成类似 `chiimagnus-syncnoscli-1.0.0.tgz` 的文件。

如果要模拟真实全局安装，可以安装刚生成的 tarball：

```bash
npm install -g ./chiimagnus-syncnoscli-<version>.tgz
syncnoscli --version
syncnoscli doctor
```

全局安装会执行 package 的 `postinstall`，并可能更新属于 SyncNos CLI 的 Native Host registration；这不是无副作用的开发运行方式。只调试 CLI 命令时优先直接执行 `dist/cli.cjs`。
