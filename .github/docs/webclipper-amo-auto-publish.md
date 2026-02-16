# WebClipper：AMO（Firefox）自动发布（Listed）

本指南用于在 **打 Git tag（`v*`）** 时，自动构建并将 WebClipper 的新版本提交到 **AMO（Firefox Add-ons / Listed）**。

> 说明：AMO 的“首次上架审核”通过前后都可以提交新版本，但版本会进入队列等待审核/签名。

---

## 你将得到什么

- 自动构建 `SyncNos-WebClipper-firefox.xpi`
- 自动生成 AMO 要求的“源码包” `SyncNos-WebClipper-amo-source.zip`
- 自动调用 AMO API：上传 XPI → 等待校验 → 创建新版本（附带源码包）

---

## 前置条件（必须）

### 1) AMO Add-on 已创建（Listed）

你已经在 AMO Developer Hub 创建了该插件（Listed），并能在页面里看到它。

### 2) 版本号策略（非常关键）

AMO 要求**每次提交的扩展版本号必须递增**。本项目的版本来自：

- `Extensions/WebClipper/manifest.json` → `version`

建议规则：

- Git tag：`v0.14.5`
- WebClipper manifest：`"version": "0.14.5"`

发布前请先更新 `Extensions/WebClipper/manifest.json` 的 `version` 并提交到 tag 对应的 commit。

一个可复用的命令（在仓库根目录执行）：

```bash
node -e "const fs=require('fs');const p='Extensions/WebClipper/manifest.json';const v=process.argv[1];const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=v;fs.writeFileSync(p, JSON.stringify(j,null,2)+'\\n');" 0.14.5
```

### 3) 准备 AMO API Key（JWT）

进入 AMO Developer Hub → **Tools** → **API keys** 创建一对凭证：

- `AMO_JWT_ISSUER`：API Key（issuer）
- `AMO_JWT_SECRET`：API Secret

同时你还需要 **AMO addon_id**（数字 id）：

- 在 AMO Developer Hub 该插件的 URL 或页面信息中能找到 `addon_id`（是一个数字）

### 4) 配置 GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret 添加：

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`
- `AMO_ADDON_ID`

---

## 本地自检（建议）

```bash
npm --prefix Extensions/WebClipper ci
npm --prefix Extensions/WebClipper run build:firefox
npm --prefix Extensions/WebClipper run package:amo-source
```

检查产物：

- `Extensions/WebClipper/SyncNos-WebClipper-firefox.xpi`
- `Extensions/WebClipper/SyncNos-WebClipper-amo-source.zip`

---

## 触发方式（与当前 release 一致）

当你 push 一个 tag（`v*`）：

```bash
git tag v0.14.5
git push origin v0.14.5
```

GitHub Actions 会自动运行 AMO 发布工作流。

---

## 常见问题（排查顺序）

### 1) AMO 报“Version already exists”

说明 `Extensions/WebClipper/manifest.json` 的 `version` 没有更新（或不递增）。

### 2) 工作流使用了旧的 workflow 文件

GitHub Actions 对 tag 触发时会使用 **tag 指向的 commit 上的 workflow**。

如果你修复了 workflow，但 tag 仍指向旧 commit，会继续跑旧逻辑。解决方式是：

- 让新 tag 指向包含最新 workflow 的 commit（或重新打 tag）

### 3) AMO 校验失败（validation errors）

脚本会输出 AMO 返回的错误详情；按提示修复后重新发版（新 `version`）即可。

---

## 下一步（Unlisted）

当你要做 Unlisted（仅签名分发）时，推荐在 AMO 创建一个 **单独的 Unlisted Add-on**（独立 addon_id），然后复用同一套工作流/脚本，仅把 `AMO_ADDON_ID` 切换到 Unlisted 的 addon_id。

