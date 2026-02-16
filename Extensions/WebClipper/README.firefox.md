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

Firefox 正式分发需要 AMO 签名；你需要为扩展设置稳定的 id。

- 默认 id 在构建时注入的 `browser_specific_settings.gecko.id`
- 可通过环境变量 `FIREFOX_EXTENSION_ID` / `FIREFOX_MIN_VERSION` 覆盖

> AMO 审核提示：如果你上传的包里包含压缩/混淆后的代码（本项目构建确实会 terser 压缩并 mangle），通常需要同时提供**未混淆的源码包**（Source code / Source package），否则很容易被要求补交或被打回。

> AMO 校验提示：Firefox 对 MV3 的 `background.service_worker` 支持存在渠道差异；构建会在 manifest 里同时写入 `background.scripts` 作为兼容回退，以通过 AMO 校验并确保后台逻辑可运行。

### 提交步骤（概览）

1. 注册/登录 AMO（Firefox Add-ons）开发者账号
2. 创建新扩展（Add-on），填写基本信息与隐私相关说明
3. 上传 `SyncNos-WebClipper-firefox.xpi`
4. 如被要求，补充上传未混淆源码包（与发布包对应的源码）
5. 等待审核，通过后由 AMO 签名并分发

官方提交文档：

```
https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
```

### `.xpi` 为什么用 `zip` 打包

`.xpi` 本质就是一个 Zip 压缩包（扩展名不同）；因此 `build:firefox` 直接调用系统 `zip` 命令即可完成打包，无需引入额外打包依赖。
