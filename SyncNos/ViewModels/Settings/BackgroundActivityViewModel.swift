import Foundation
import Combine
import SwiftUI

final class BackgroundActivityViewModel: ObservableObject {
    @Published var isEnabled: Bool = false
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    private let service: BackgroundActivityServiceProtocol
    private var cancellables = Set<AnyCancellable>()
    
    init(service: BackgroundActivityServiceProtocol = DIContainer.shared.backgroundActivityService) {
        self.service = service
        self.isEnabled = service.isEnabled
    }
    
    func setEnabled(_ enabled: Bool) {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        
        // 本地操作为同步且快速，这里直接切换并更新 UI 状态
        service.setEnabled(enabled)
        DispatchQueue.main.async {
            self.isEnabled = self.service.isEnabled
            self.isLoading = false
        }
    }
}


