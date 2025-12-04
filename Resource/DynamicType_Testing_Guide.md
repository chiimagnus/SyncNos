# Dynamic Type 测试指南

## Xcode 调试器环境覆盖（Environment Overrides）

这是在运行时测试 Dynamic Type 最便捷的方法，无需修改系统设置，可以实时查看应用在不同文字大小下的表现。

### 步骤详解

#### 1. 运行应用

在 Xcode 中按 `⌘R` 运行 SyncNos 应用。

#### 2. 打开 Environment Overrides 面板

有两种方式打开：

**方式 A：通过调试工具栏**
1. 应用运行后，在 Xcode 底部的调试区域找到工具栏
2. 点击 **Environment Overrides** 按钮（图标看起来像一个有滑块的矩形）

**方式 B：通过菜单**
1. 菜单栏 → **Debug** → **Environment Overrides...**
2. 或使用快捷键 `⌘⇧E`

#### 3. 启用 Dynamic Type 覆盖

在 Environment Overrides 面板中：

1. 找到 **Text** 部分
2. 打开 **Dynamic Type** 开关
3. 使用滑块调整文字大小

```
┌─────────────────────────────────────────────────┐
│  Environment Overrides                     ✕    │
├─────────────────────────────────────────────────┤
│                                                 │
│  ▼ Text                                         │
│                                                 │
│    [✓] Dynamic Type                             │
│                                                 │
│    ├──●──────────────────────────────────┤      │
│    xSmall                            AX5        │
│                                                 │
│    Current: Large (Default)                     │
│                                                 │
├─────────────────────────────────────────────────┤
│  ▼ Appearance                                   │
│    [ ] Light/Dark Mode                          │
│                                                 │
│  ▼ Accessibility                                │
│    [ ] Bold Text                                │
│    [ ] Increase Contrast                        │
│    [ ] Reduce Motion                            │
│    [ ] Reduce Transparency                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 可用的文字大小

滑块提供 12 种大小选项：

| 大小 | 类型 | 说明 |
|-----|------|-----|
| xSmall | 标准 | 最小 |
| Small | 标准 | 较小 |
| Medium | 标准 | 中等 |
| **Large** | 标准 | **默认大小** |
| xLarge | 标准 | 较大 |
| xxLarge | 标准 | 更大 |
| xxxLarge | 标准 | 最大标准 |
| AX1 | 辅助功能 | 辅助功能大小 1 |
| AX2 | 辅助功能 | 辅助功能大小 2 |
| AX3 | 辅助功能 | 辅助功能大小 3 |
| AX4 | 辅助功能 | 辅助功能大小 4 |
| AX5 | 辅助功能 | 最大辅助功能大小 |

### 测试检查清单

在调整滑块时，检查以下内容：

#### ✅ 文字显示
- [ ] 所有文字是否完整显示，没有被截断？
- [ ] 文字是否随滑块变化而缩放？
- [ ] 长文本是否正确换行？

#### ✅ 布局适配
- [ ] OnboardingSourcesView 在 AX1-AX5 时是否切换为垂直布局？
- [ ] AboutView 在 AX1-AX5 时是否切换为垂直布局？
- [ ] 元素之间的间距是否合理？

#### ✅ 图标缩放
- [ ] Onboarding 页面的卫星图标是否随文字缩放？
- [ ] PayWall 的礼物图标是否随文字缩放？
- [ ] SourceCard 的图标是否随文字缩放？

#### ✅ 可交互元素
- [ ] 按钮是否仍然可以点击？
- [ ] 按钮文字是否清晰可读？
- [ ] 长按 DataSourceIndicatorBar 是否显示 Large Content Viewer？

### 其他可用的 Environment Overrides

除了 Dynamic Type，还可以测试：

| 选项 | 用途 |
|-----|------|
| **Appearance** | 测试深色/浅色模式 |
| **Bold Text** | 测试粗体文字 |
| **Increase Contrast** | 测试高对比度模式 |
| **Reduce Motion** | 测试减少动画模式 |
| **Reduce Transparency** | 测试减少透明度模式 |

### 注意事项

1. **Environment Overrides 仅在调试时有效**
   - 这些覆盖不会影响实际的系统设置
   - 停止调试后，覆盖会自动失效

2. **某些效果可能需要重新导航**
   - 有些视图可能需要重新加载才能看到变化
   - 尝试切换页面或重新打开窗口

3. **与系统设置的关系**
   - Environment Overrides 会覆盖系统设置
   - 禁用覆盖后，会恢复使用系统设置

### 快速测试流程

1. `⌘R` 运行应用
2. `⌘⇧E` 打开 Environment Overrides
3. 启用 Dynamic Type
4. 将滑块拖到 **Large**（默认）→ 观察基准表现
5. 将滑块拖到 **xxxLarge** → 观察标准最大值表现
6. 将滑块拖到 **AX3** → 观察辅助功能大小表现
7. 将滑块拖到 **AX5** → 观察最大辅助功能大小表现
8. 在各个大小下浏览应用的主要页面

### 常见问题

**Q: 为什么改变滑块后界面没有变化？**
A: 检查是否已启用 Dynamic Type 开关。某些自定义视图可能没有正确支持 Dynamic Type。

**Q: 为什么有些文字变大了，有些没变？**
A: 使用固定字体大小（如 `.font(.system(size: 16))`）的文字不会响应 Dynamic Type。应改用系统样式（如 `.font(.body)`）或 `@ScaledMetric`。

**Q: 如何测试 Large Content Viewer？**
A: Large Content Viewer 在辅助功能大小（AX1-AX5）下生效。启用辅助功能大小后，长按支持 Large Content Viewer 的控件即可看到放大视图。

---

> 📝 **文档版本**: 1.0  
> 📅 **最后更新**: 2024年12月

