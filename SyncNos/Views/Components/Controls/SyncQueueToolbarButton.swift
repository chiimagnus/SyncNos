import SwiftUI
import Combine

// MARK: - SyncQueueToolbarStatus

private enum SyncQueueToolbarStatus: Equatable {
    case idle
    case syncing(progress: Double)
    case succeeded
    case failed
}

// MARK: - SyncQueueToolbarViewModel

private final class SyncQueueToolbarViewModel: ObservableObject {
    @Published var status: SyncQueueToolbarStatus = .idle

    private var cancellables = Set<AnyCancellable>()

    init() {
        DIContainer.shared.syncQueueStore.tasksPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] tasks in
                self?.updateStatus(tasks: tasks)
            }
            .store(in: &cancellables)
    }

    private func updateStatus(tasks: [SyncQueueTask]) {
        guard !tasks.isEmpty else {
            status = .idle
            return
        }

        let hasActive = tasks.contains { $0.state == .queued || $0.state == .running }
        if hasActive {
            let completedCount = tasks.filter { task in
                task.state == .succeeded || task.state == .failed || task.state == .cancelled
            }.count

            var currentTaskFraction: Double = 0
            if let runningTask = tasks.first(where: { $0.state == .running }),
               let progressText = runningTask.progressText,
               let parsed = Self.parseFraction(from: progressText) {
                currentTaskFraction = parsed
            }

            let totalCount = max(tasks.count, 1)
            let value = (Double(completedCount) + currentTaskFraction) / Double(totalCount)
            status = .syncing(progress: min(max(value, 0), 1))
            return
        }

        if tasks.contains(where: { $0.state == .failed }) {
            status = .failed
        } else {
            status = .succeeded
        }
    }

    private static func parseFraction(from text: String) -> Double? {
        // 兼容形如 "Downloading 4 / 6" 或 "4/6" 或 "4 of 6"
        let patterns = [
            #"(\d+)\s*/\s*(\d+)"#,
            #"(\d+)\s+of\s+(\d+)"#
        ]

        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let range = NSRange(text.startIndex..<text.endIndex, in: text)
            guard let match = regex.firstMatch(in: text, options: [], range: range),
                  match.numberOfRanges >= 3,
                  let currentRange = Range(match.range(at: 1), in: text),
                  let totalRange = Range(match.range(at: 2), in: text),
                  let current = Int(text[currentRange]),
                  let total = Int(text[totalRange]),
                  total > 0 else { continue }

            let fraction = Double(current) / Double(total)
            return min(max(fraction, 0), 1)
        }

        return nil
    }
}

// MARK: - SyncQueueToolbarIcon

private struct SyncQueueToolbarIcon: View {
    let status: SyncQueueToolbarStatus

    var body: some View {
        switch status {
        case .idle:
            ring(progress: 0, tint: Color.secondary.opacity(0.45))
        case .syncing(let progress):
            ring(progress: progress, tint: Color.accentColor)
        case .succeeded:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
        }
    }

    private func ring(progress: Double, tint: Color) -> some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.25), lineWidth: 2)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    tint,
                    style: StrokeStyle(lineWidth: 2, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 16, height: 16)
        .animation(.easeInOut(duration: 0.18), value: progress)
    }
}

// MARK: - SyncQueuePopoverView

private struct SyncQueuePopoverView: View {
    var body: some View {
        ScrollView {
            SyncQueueView()
                .padding(12)
        }
        .frame(width: 420, height: 520)
    }
}

// MARK: - SyncQueueToolbarButton

struct SyncQueueToolbarButton: View {
    @StateObject private var viewModel = SyncQueueToolbarViewModel()
    @State private var isPopoverPresented: Bool = false

    var body: some View {
        Button {
            isPopoverPresented.toggle()
        } label: {
            SyncQueueToolbarIcon(status: viewModel.status)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isPopoverPresented, arrowEdge: .top) {
            SyncQueuePopoverView()
        }
    }
}

