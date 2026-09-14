---
title: GitHub
description: 用 GitHub App Device Flow 授权，把内容以 Markdown 同步到仓库分支。
---

GitHub Provider 把 SyncNos 的本地内容投影为 Markdown 和受管附件，并提交到你选择的仓库与分支。

## 连接 GitHub

1. 打开 **SyncNos → 设置 → GitHub**。
2. 点击连接，按页面提示完成 GitHub Device Flow。
3. 如果提示 GitHub App 尚未安装，为需要同步的账号 / 仓库安装 SyncNos GitHub App。
4. 刷新仓库列表，选择一个 SyncNos 具有内容写权限的仓库。
5. 选择或填写目标分支。
6. 点击 **Test** 验证连接。

## 初始化空仓库

如果测试结果提示目标仓库尚未初始化，可以使用设置页中的 **Initialize repository**。初始化完成后再次测试连接。

不要对同一个初始化动作反复盲点；先查看当前状态，再决定是否重试。

## 同步

GitHub 同步支持手动与自动模式。同步时 SyncNos 会计算本地内容对应的 Git 文件变化，再以 GitHub API 更新目标仓库。

本地同步 mapping 用于识别由 SyncNos 管理的远端文件和后续增量更新；本地数据库仍然是内容主记录。

## 授权与隐私

GitHub Device Flow 的 access / refresh token 和 pending 凭据保存在 extension-local storage，并从 Backup ZIP 中排除。

**Disconnect** 只清理 SyncNos 扩展中的本地 GitHub 认证状态。要撤销 GitHub 授权或卸载 GitHub App，需要在 GitHub 一侧完成。

## 排障

- **看不到仓库**：确认 SyncNos GitHub App 已安装到对应账号 / 组织，并授予了目标仓库访问权限，然后刷新仓库列表。
- **提示没有写权限**：GitHub App 的 Contents 权限和当前用户对目标仓库都需要具备写入能力。
- **空仓库无法测试**：使用 **Initialize repository** 初始化，再重新测试。
- **找不到分支**：选择仓库中已经存在的分支，或使用仓库的默认分支。

同步失败不会删除本地原始内容。先确认远端当前状态和权限，再重试。
