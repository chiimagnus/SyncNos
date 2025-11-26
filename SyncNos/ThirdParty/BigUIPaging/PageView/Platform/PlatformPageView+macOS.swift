import SwiftUI
import AppKit

extension PlatformPageView: NSViewControllerRepresentable {
    
    typealias NSViewControllerType = NSPageController
    
    func makeNSViewController(context: Context) -> NSPageController {
        let pageController = NSPageController()
        pageController.view = NSView()
        pageController.view.wantsLayer = true
        pageController.delegate = context.coordinator
        
        let (arrangedObjects, selectedIndex) = makeArrangedObjects(around: selection)
        pageController.arrangedObjects = arrangedObjects
        pageController.selectedIndex = selectedIndex
        pageController.transitionStyle = configuration.transition.platform
        
        return pageController
    }
    
    func updateNSViewController(_ pageController: NSPageController, context: Context) {
        // 保持选择值与页面控制器同步
        if context.coordinator.selectedValue(in: pageController) != selection {
            context.coordinator.go(
                to: selection,
                in: pageController,
                animated: context.transaction.animation != nil
            )
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }
    
    // MARK: - Coordinator
    
    class Coordinator: NSObject, NSPageControllerDelegate {
        var parent: PlatformPageView
        var viewCache = [SelectionValue: NSView]()
        
        init(parent: PlatformPageView) {
            self.parent = parent
        }
        
        // MARK: - NSPageControllerDelegate
        
        func pageController(_ pageController: NSPageController, identifierFor object: Any) -> NSPageController.ObjectIdentifier {
            guard let value = object as? SelectionValue else {
                return "unknown"
            }
            return "\(value.hashValue)"
        }
        
        func pageController(_ pageController: NSPageController, viewControllerForIdentifier identifier: NSPageController.ObjectIdentifier) -> NSViewController {
            // 查找匹配的值
            guard let value = pageController.arrangedObjects.compactMap({ $0 as? SelectionValue }).first(where: { "\($0.hashValue)" == identifier }) else {
                return ContainerViewController(content: AnyView(EmptyView()))
            }
            
            let view = parent.content(value)
            return ContainerViewController(content: AnyView(view))
        }
        
        func pageControllerDidEndLiveTransition(_ pageController: NSPageController) {
            pageController.completeTransition()
            
            // 更新选择绑定
            if let value = selectedValue(in: pageController) {
                parent.selection = value
            }
            
            // 刷新排列对象以支持无限滚动
            refreshArrangedObjects(in: pageController)
            
            // 清理视图缓存
            flushViewCache(in: pageController)
        }
        
        // MARK: - Navigation
        
        func go(to value: SelectionValue, in pageController: NSPageController, animated: Bool) {
            // 检查目标值是否在当前排列对象中
            if let index = pageController.arrangedObjects.firstIndex(where: { ($0 as? SelectionValue) == value }) {
                if animated {
                    NSAnimationContext.runAnimationGroup { context in
                        context.duration = 0.25
                        context.allowsImplicitAnimation = true
                        pageController.animator().selectedIndex = index
                    } completionHandler: {
                        pageController.completeTransition()
                        self.refreshArrangedObjects(in: pageController)
                    }
                } else {
                    pageController.selectedIndex = index
                    pageController.completeTransition()
                    refreshArrangedObjects(in: pageController)
                }
            } else {
                // 目标值不在当前范围内，重建排列对象
                let (newObjects, newIndex) = parent.makeArrangedObjects(around: value)
                pageController.arrangedObjects = newObjects
                pageController.selectedIndex = newIndex
            }
        }
        
        func selectedValue(in pageController: NSPageController) -> SelectionValue? {
            guard pageController.selectedIndex >= 0,
                  pageController.selectedIndex < pageController.arrangedObjects.count else {
                return nil
            }
            return pageController.arrangedObjects[pageController.selectedIndex] as? SelectionValue
        }
        
        // MARK: - Private
        
        private func refreshArrangedObjects(in pageController: NSPageController) {
            guard let currentValue = selectedValue(in: pageController) else { return }
            let (newObjects, newIndex) = parent.makeArrangedObjects(around: currentValue)
            pageController.arrangedObjects = newObjects
            pageController.selectedIndex = newIndex
        }
        
        private func flushViewCache(in pageController: NSPageController) {
            guard let currentValues = pageController.arrangedObjects as? [SelectionValue] else { return }
            for value in viewCache.keys {
                if !currentValues.contains(value) {
                    viewCache.removeValue(forKey: value)
                }
            }
        }
    }
    
    // MARK: - ContainerViewController
    
    class ContainerViewController: NSViewController {
        private let hostingView: HostingView
        
        init(content: AnyView) {
            self.hostingView = HostingView(rootView: content)
            super.init(nibName: nil, bundle: nil)
        }
        
        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }
        
        override func loadView() {
            view = hostingView
        }
    }
    
    // MARK: - HostingView
    
    class HostingView: NSHostingView<AnyView> {
        override func wantsForwardedScrollEvents(for axis: NSEvent.GestureAxis) -> Bool {
            // 确保滑动事件能传递到 NSPageController
            return true
        }
    }
}

