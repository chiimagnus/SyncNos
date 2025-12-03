import Foundation

/// 得到 API 请求限流器
/// 基于令牌桶算法 + 冷却期机制，防止触发反爬
///
/// 核心机制：
/// 1. **令牌桶限流**：控制请求速率，避免瞬时大量请求
/// 2. **冷却期**：检测到反爬后进入冷却，等待恢复
/// 3. **连续失败检测**：多次连续失败自动触发冷却
/// 4. **请求抖动**：添加随机延迟，避免规律性请求
actor DedaoRequestLimiter {
    // MARK: - Configuration
    
    /// 令牌桶配置
    private let maxTokens: Int = 5           // 最大令牌数
    private let tokenRefillRate: Double = 0.5 // 令牌产生速率（个/秒）
    
    /// 冷却期配置
    private let cooldownDuration: TimeInterval = 60  // 冷却期时长（秒）
    private let maxConsecutiveFailures: Int = 3      // 触发冷却的连续失败次数
    
    /// 重试配置
    static let maxRetries: Int = 3                         // 最大重试次数
    static let initialBackoff: TimeInterval = 3.0          // 初始退避时间（秒）
    static let antiSpiderBackoffMultiplier: Double = 3.0   // 反爬错误退避倍数
    
    // MARK: - State
    
    /// 当前可用令牌数
    private var tokens: Int
    
    /// 上次令牌填充时间
    private var lastRefillTime: Date
    
    /// 上次请求时间
    private var lastRequestTime: Date = .distantPast
    
    /// 连续失败次数
    private var consecutiveFailures: Int = 0
    
    /// 是否处于冷却期
    private var inCooldown: Bool = false
    
    /// 冷却开始时间
    private var cooldownStartTime: Date?
    
    /// Logger
    private let logger: LoggerServiceProtocol?
    
    // MARK: - Initialization
    
    init(logger: LoggerServiceProtocol? = nil) {
        self.tokens = 5
        self.lastRefillTime = Date()
        self.logger = logger
    }
    
    // MARK: - Public API
    
    /// 等待直到可以发送下一个请求
    /// 自动处理令牌桶、冷却期和随机抖动
    func waitForNextRequest() async {
        // 1. 检查并处理冷却期
        await handleCooldown()
        
        // 2. 从令牌桶获取令牌
        let waitTime = getToken()
        if waitTime > 0 {
            try? await Task.sleep(nanoseconds: UInt64(waitTime * 1_000_000_000))
        }
        
        // 3. 更新最后请求时间
        lastRequestTime = Date()
    }
    
    /// 记录请求成功
    func recordSuccess() {
        consecutiveFailures = 0
    }
    
    /// 记录请求失败
    /// - Parameter error: 错误信息
    /// - Returns: 是否应该重试
    func recordFailure(error: Error) -> Bool {
        let errorDescription = error.localizedDescription.lowercased()
        
        // 检查是否为反爬相关错误
        let isAntiSpider = errorDescription.contains("403")
            || errorDescription.contains("forbidden")
            || errorDescription.contains("429")
            || errorDescription.contains("too many requests")
            || errorDescription.contains("rate")
            || errorDescription.contains("496")
        
        if isAntiSpider {
            // 直接进入冷却期
            logger?.warning("[DedaoLimiter] Anti-spider detected, entering cooldown")
            consecutiveFailures = maxConsecutiveFailures
            inCooldown = true
            cooldownStartTime = Date()
            return true  // 建议重试
        }
        
        // 增加连续失败计数
        consecutiveFailures += 1
        
        // 如果连续失败次数超过阈值，启动冷却期
        if consecutiveFailures >= maxConsecutiveFailures {
            logger?.warning("[DedaoLimiter] \(consecutiveFailures) consecutive failures, entering cooldown")
            inCooldown = true
            cooldownStartTime = Date()
        }
        
        return consecutiveFailures < maxConsecutiveFailures
    }
    
    /// 判断错误是否为反爬相关
    func isAntiSpiderError(_ error: Error) -> Bool {
        let desc = error.localizedDescription.lowercased()
        return desc.contains("403")
            || desc.contains("forbidden")
            || desc.contains("429")
            || desc.contains("too many requests")
            || desc.contains("rate")
            || desc.contains("496")
    }
    
    /// 获取当前状态信息（调试用）
    func getStatus() -> (tokens: Int, inCooldown: Bool, failures: Int) {
        (tokens, inCooldown, consecutiveFailures)
    }
    
    // MARK: - Private Methods
    
    /// 处理冷却期
    private func handleCooldown() async {
        guard inCooldown, let startTime = cooldownStartTime else { return }
        
        let elapsed = Date().timeIntervalSince(startTime)
        
        if elapsed >= cooldownDuration {
            // 冷却期结束
            inCooldown = false
            cooldownStartTime = nil
            consecutiveFailures = 0
            logger?.info("[DedaoLimiter] Cooldown ended, resuming requests")
        } else {
            // 仍在冷却期，需要等待
            let remaining = cooldownDuration - elapsed
            logger?.info("[DedaoLimiter] In cooldown, waiting \(String(format: "%.1f", remaining))s...")
            try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            
            // 冷却结束后重置状态
            inCooldown = false
            cooldownStartTime = nil
            consecutiveFailures = 0
        }
    }
    
    /// 从令牌桶获取令牌
    /// - Returns: 需要等待的时间（秒）
    private func getToken() -> TimeInterval {
        // 计算从上次填充到现在应该填充的令牌数
        let now = Date()
        let elapsedTime = now.timeIntervalSince(lastRefillTime)
        let newTokens = Int(elapsedTime * tokenRefillRate)
        
        if newTokens > 0 {
            // 填充令牌，但不超过最大值
            tokens = min(tokens + newTokens, maxTokens)
            lastRefillTime = now
        }
        
        // 如果没有令牌，计算等待时间
        if tokens <= 0 {
            // 计算需要等待多久才能获得一个令牌
            let waitTime = 1.0 / tokenRefillRate
            return waitTime
        }
        
        // 消耗一个令牌
        tokens -= 1
        
        // 添加小的随机抖动（0-200ms），使请求不那么规律
        let jitter = Double.random(in: 0...0.2)
        return jitter
    }
}

// MARK: - Retry Utilities

extension DedaoRequestLimiter {
    /// 带重试的异步操作执行器
    /// - Parameters:
    ///   - operation: 要执行的异步操作
    ///   - operationName: 操作名称（用于日志）
    /// - Returns: 操作结果
    func withRetry<T>(
        operationName: String = "request",
        operation: @escaping () async throws -> T
    ) async throws -> T {
        var lastError: Error?
        var backoff = Self.initialBackoff
        
        for attempt in 1...Self.maxRetries {
            // 等待直到可以发送请求
            await waitForNextRequest()
            
            do {
                let result = try await operation()
                recordSuccess()
                return result
            } catch {
                lastError = error
                
                // 检查是否应该重试
                let shouldRetry = recordFailure(error: error)
                let isAntiSpider = isAntiSpiderError(error)
                
                logger?.warning("[DedaoLimiter] Attempt \(attempt)/\(Self.maxRetries) failed for \(operationName): \(error.localizedDescription)")
                
                if attempt < Self.maxRetries {
                    // 如果是反爬错误，使用更长的退避时间
                    if isAntiSpider {
                        backoff *= Self.antiSpiderBackoffMultiplier
                        logger?.info("[DedaoLimiter] Anti-spider error, using extended backoff: \(String(format: "%.1f", backoff))s")
                    }
                    
                    logger?.info("[DedaoLimiter] Retrying in \(String(format: "%.1f", backoff))s...")
                    try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
                    
                    // 指数退避
                    backoff *= 2
                    
                    // 如果不应该重试（已触发冷却），提前退出
                    if !shouldRetry {
                        logger?.warning("[DedaoLimiter] Max consecutive failures reached, stopping retries")
                        break
                    }
                }
            }
        }
        
        // 所有重试都失败
        logger?.error("[DedaoLimiter] All \(Self.maxRetries) attempts failed for \(operationName)")
        throw lastError ?? DedaoAPIError.invalidResponse
    }
}

