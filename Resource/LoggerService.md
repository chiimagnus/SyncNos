# LoggerService 使用说明

## 概述

LoggerService 是一个统一的日志服务，用于替代项目中的所有 `print` 语句。它提供了不同级别的日志记录功能，并支持可配置的日志级别。

## 日志级别

LoggerService 支持以下日志级别（按严重程度递增）：

1. **verbose** - 详细信息，用于调试
2. **debug** - 调试信息，用于开发环境
3. **info** - 一般信息，用于生产环境
4. **warning** - 警告信息
5. **error** - 错误信息

## 使用方法

### 1. 在类中引入 LoggerService

```swift
class YourClass {
    private let logger = DIContainer.shared.loggerService

    func yourMethod() {
        logger.info("这是一条信息日志")
        logger.error("这是一条错误日志")
    }
}
```

### 2. 直接使用共享实例

```swift
LoggerService.shared.info("这是一条信息日志")
LoggerService.shared.error("这是一条错误日志")
```

### 3. 不同级别的日志记录

```swift
let logger = DIContainer.shared.loggerService

// 详细信息（仅在verbose级别显示）
logger.verbose("详细调试信息")

// 调试信息（默认在开发环境中显示）
logger.debug("调试信息")

// 一般信息（默认在生产环境中显示）
logger.info("一般信息")

// 警告信息
logger.warning("警告信息")

// 错误信息
logger.error("错误信息")
```

## 配置日志级别

可以通过设置 `currentLevel` 属性来配置日志级别：

```swift
let logger = DIContainer.shared.loggerService

// 只显示警告和错误信息
logger.currentLevel = .warning

// 显示所有信息
logger.currentLevel = .verbose
```

## 默认行为

- 在开发环境（DEBUG模式）中，默认日志级别为 `.debug`
- 在生产环境中，默认日志级别为 `.info`
- 只有当日志级别大于等于当前配置级别时，日志才会被输出

## 扩展功能

LoggerService 设计为可扩展，未来可以添加以下功能：

1. 文件记录功能
2. 网络日志传输
3. 日志过滤器
4. 结构化日志记录

## 注意事项

1. LoggerService 使用依赖注入容器（DIContainer）进行管理
2. 所有日志都会输出到控制台（未来可扩展为文件记录）
3. 日志包含时间戳、文件名、行号和方法名，便于调试