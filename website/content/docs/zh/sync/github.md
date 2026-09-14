---
title: GitHub
description: 把 SyncNos 内容以 Markdown 同步到 GitHub 仓库。
---

## 连接 GitHub

1. 打开 **SyncNos → 设置 → GitHub**
2. 点击 **Connect**，按提示完成 GitHub 授权
3. 如果提示尚未安装 GitHub App，为需要使用的账号或仓库安装 SyncNos
4. 刷新仓库列表并选择目标仓库
5. 选择目标分支
6. 点击 **Test** 确认连接正常

## 空仓库

如果 Test 提示仓库尚未初始化，点击 **Initialize repository**，完成后再测试一次。

## 同步

连接成功后可以手动同步，也可以开启自动同步。

SyncNos 会把内容以 Markdown 和附件写入你选择的仓库与分支。

## 断开连接

**Disconnect** 会断开 SyncNos 中的 GitHub 连接。

如果还要撤销 GitHub 授权或卸载 GitHub App，需要到 GitHub 中操作。

## 遇到问题

- **看不到仓库**：检查 GitHub App 是否已经获得目标仓库的访问权限，然后刷新列表
- **没有写权限**：确认 GitHub App 和当前账号都可以写入目标仓库
- **空仓库无法测试**：先使用 **Initialize repository**
- **找不到分支**：选择一个已经存在的分支或默认分支

同步失败不会删除本地内容。修复问题后重新同步即可。
