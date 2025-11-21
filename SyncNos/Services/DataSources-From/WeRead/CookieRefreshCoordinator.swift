import Foundation

/// Cookie 刷新协调器
/// 使用 actor 模式确保并发安全，防止多个请求同时触发刷新操作
actor CookieRefreshCoordinator {
    private var refreshInProgress: Task<String, Error>?
    
    /// 尝试刷新 Cookie，如果已有刷新在进行中则等待
    /// - Parameters:
    ///   - refreshService: Cookie 刷新服务
    ///   - authService: 认证服务，用于更新 Cookie
    /// - Returns: 新的 Cookie header
    /// - Throws: 刷新失败时抛出错误
    func attemptRefresh(
        refreshService: WeReadCookieRefreshService,
        authService: WeReadAuthServiceProtocol
    ) async throws -> String {
        // 如果已有刷新任务在进行中，等待其完成
        if let existingTask = refreshInProgress {
            return try await existingTask.value
        }
        
        // 创建新的刷新任务
        let task = Task<String, Error> {
            do {
                // 执行静默刷新
                let newCookie = try await refreshService.attemptSilentRefresh()
                
                // 更新认证服务中的 Cookie
                await MainActor.run {
                    authService.updateCookieHeader(newCookie)
                }
                
                return newCookie
            } catch {
                // 刷新失败，抛出错误
                throw error
            }
        }
        
        // 保存任务引用
        refreshInProgress = task
        
        do {
            // 等待任务完成
            let result = try await task.value
            
            // 清除任务引用
            refreshInProgress = nil
            
            return result
        } catch {
            // 清除任务引用
            refreshInProgress = nil
            
            throw error
        }
    }
    
    /// 重置状态（用于测试或错误恢复）
    func reset() {
        refreshInProgress?.cancel()
        refreshInProgress = nil
    }
}
