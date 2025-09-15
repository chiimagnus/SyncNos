import SwiftUI
import AppKit
import Combine

struct BooksListView: View {
    @StateObject private var viewModel = BookViewModel()
    @State private var selectedBookId: String? = nil

    var body: some View {
        NavigationSplitView {
            Group {
                if viewModel.isLoading {
                    ProgressView("Loading books...")
                } else if let errorMessage = viewModel.errorMessage {
                    VStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(.orange)
                            .font(.largeTitle)
                        Text("Error: Please allow SyncNos to access Apple Books notes; otherwise they cannot be loaded.")
                            .multilineTextAlignment(.center)
                            .padding()
                        // Button("Retry") { viewModel.loadBooks() }
                        //     .buttonStyle(.borderedProminent)
                        Button("Please restart SyncNos") {
                            restartApp()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } else if viewModel.books.isEmpty {
                    VStack {
                        Image(systemName: "books.vertical")
                            .foregroundColor(.secondary)
                            .font(.largeTitle)
                        Text("No books found")
                            .padding()
                        // Button("Refresh") { viewModel.loadBooks() }
                            // .buttonStyle(.borderedProminent)
                        Button("Open Apple Books notes") {
                            AppleBooksPicker.pickAppleBooksContainer()
                        }
                    }
                } else {
                    List(selection: $selectedBookId) {
                        ForEach(viewModel.books, id: \.bookId) { book in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(book.bookTitle).font(.headline)
                                    Text(book.authorName).font(.subheadline).foregroundColor(.secondary)
                                    Text("\(book.highlightCount) highlights").font(.caption)
                                }
                                Spacer()
                            }
                            .padding(.vertical, 4)
                            .tag(book.bookId)
                        }
                    }
                    .listStyle(.sidebar)
                }
            }
            .navigationTitle("Books")
        } detail: {
            // Detail content: show selected book details
            if let sel = selectedBookId, let book = viewModel.books.first(where: { $0.bookId == sel }) {
                BookDetailView(book: book, annotationDBPath: viewModel.annotationDatabasePath)
                    .id(book.bookId) // force view refresh when selection changes
            } else {
                Text("Select a book to view details").foregroundColor(.secondary)
            }
        }
        .onAppear {
            if let url = BookmarkStore.shared.restore() {
                let started = BookmarkStore.shared.startAccessing(url: url)
                print("Using restored bookmark on appear, startAccess=\(started)")
                let selectedPath = url.path
                let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
                viewModel.setDbRootOverride(rootCandidate)
                viewModel.loadBooks()
            }
        }
        .onDisappear {
            // Release security-scoped bookmark when view disappears
            BookmarkStore.shared.stopAccessingIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("AppleBooksContainerSelected"))) { notif in
            guard let selectedPath = notif.object as? String else { return }
            let rootCandidate = viewModel.determineDatabaseRoot(from: selectedPath)
            viewModel.setDbRootOverride(rootCandidate)
            viewModel.loadBooks()
        }
    }
}

// MARK: - App restart helper

fileprivate func restartApp() {
    // Debug info: show bundle identifier and bundle path we're trying to open
    let bundleID = Bundle.main.bundleIdentifier ?? ""
    let bundleURL = Bundle.main.bundleURL
    let bundlePath = bundleURL.path
    print("Attempting to restart app. bundleID=\(bundleID), bundlePath=\(bundlePath)")

    // 1) Prefer launching by bundle identifier (system will locate installed app in /Applications)
    var launchIdentifier: NSNumber? = nil
    let launchedByBundleID = NSWorkspace.shared.launchApplication(
        withBundleIdentifier: bundleID,
        options: [],
        additionalEventParamDescriptor: nil,
        launchIdentifier: &launchIdentifier
    )

    if launchedByBundleID {
        print("Launched by bundle identifier, launchIdentifier=\(String(describing: launchIdentifier))")
        // Give the new process time to start up before exiting
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            NSApplication.shared.terminate(nil)
        }
        return
    }

    print("launchApplication(withBundleIdentifier:) failed or returned false")

    // 2) Try NSWorkspace.openApplication with the bundle URL we have
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.openApplication(at: bundleURL, configuration: configuration) { runningApp, error in
        if let error = error {
            print("NSWorkspace.openApplication failed: \(error). Falling back to /usr/bin/open")

            // 3) Fallback: use '/usr/bin/open -a <AppName>' so LaunchServices can resolve the installed app
            let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? bundleURL.deletingPathExtension().lastPathComponent
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            task.arguments = ["-a", appName]
            do {
                try task.run()
                print("Fallback /usr/bin/open -a \(appName) invoked")
            } catch {
                print("Fallback open failed: \(error)")
            }

            // Terminate after fallback attempt (give it a moment)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                NSApplication.shared.terminate(nil)
            }
            return
        }

        if let runningApp = runningApp {
            print("NSWorkspace.openApplication launched: \(runningApp.localizedName ?? "unknown")")
        } else {
            print("NSWorkspace.openApplication returned no error but runningApp is nil; will fallback to /usr/bin/open")
            let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? bundleURL.deletingPathExtension().lastPathComponent
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            task.arguments = ["-a", appName]
            do {
                try task.run()
                print("Fallback /usr/bin/open -a \(appName) invoked (no runningApp)")
            } catch {
                print("Fallback open failed: \(error)")
            }
        }

        // Give the launched process time to start before terminating the current one
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            NSApplication.shared.terminate(nil)
        }
    }
}

struct BooksListView_Previews: PreviewProvider {
    static var previews: some View {
        BooksListView()
    }
}
