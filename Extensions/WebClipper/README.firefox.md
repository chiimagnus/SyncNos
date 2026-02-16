# SyncNos WebClipper (Firefox)

本扩展基于 WebExtensions MV3，核心代码与 Chrome 版本共用；Firefox 版本只在构建产物的 `manifest.json` 中注入 `browser_specific_settings`，并输出可分发的 `.xpi` 包。

## 构建（含混淆/压缩）

> 当前构建会使用 `terser` 对 `content.js` / `background.js` / `popup.js` 做压缩与 `toplevel` 级别的 mangle（同时 `drop_console`）。

```bash
npm --prefix Extensions/WebClipper run build:firefox
```

可选：指定 Firefox 扩展 id / 最低版本（用于 AMO）：

```bash
FIREFOX_EXTENSION_ID="your-addon-id@your.domain" FIREFOX_MIN_VERSION="109.0" \
  npm --prefix Extensions/WebClipper run build:firefox
```

产物：

- `Extensions/WebClipper/dist-firefox/`（可直接加载）
- `Extensions/WebClipper/SyncNos-WebClipper-firefox.xpi`（可分发）

## 本地加载（临时扩展）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 “Load Temporary Add-on…”
3. 选择 `Extensions/WebClipper/dist-firefox/manifest.json`

## 发布（AMO 签名）

Firefox 正式分发通常需要 AMO 签名；你需要为扩展设置稳定的 id。

- 默认 id 在构建时注入的 `browser_specific_settings.gecko.id`
- 可通过环境变量 `FIREFOX_EXTENSION_ID` / `FIREFOX_MIN_VERSION` 覆盖

构建出的 `.xpi` 可以用于：

- 上传 AMO 后由 AMO 签名并分发
- 内部分发（取决于目标环境是否允许未签名扩展）

> 注意：`build:firefox` 会调用系统的 `zip` 命令来生成 `.xpi`。
