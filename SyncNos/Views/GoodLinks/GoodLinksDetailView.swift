import SwiftUI

struct GoodLinksDetailView: View {
    @ObservedObject var viewModel: GoodLinksViewModel
    @Binding var selectedLinkId: String?

    var body: some View {
        Group {
            if let linkId = selectedLinkId, !linkId.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let link = viewModel.links.first(where: { $0.id == linkId }) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(link.title?.isEmpty == false ? link.title! : link.url)
                                    .font(.title3).bold()
                                if let author = link.author, !author.isEmpty {
                                    Text(author).font(.subheadline).foregroundColor(.secondary)
                                }
                                if let host = URL(string: link.url)?.host { Text(host).font(.caption).foregroundColor(.secondary) }
                            }
                            .padding(.bottom, 8)
                        }

                        let highlights = viewModel.highlightsByLinkId[linkId] ?? []
                        ForEach(highlights, id: \.id) { item in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(item.content)
                                if let note = item.note, !note.isEmpty {
                                    Text(note).font(.caption).foregroundColor(.secondary)
                                }
                            }
                            .padding()
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.gray.opacity(0.08)))
                        }
                    }
                    .padding()
                }
                .onAppear {
                    viewModel.loadHighlights(for: linkId)
                }
                .navigationTitle("GoodLinks")
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "text.quote").font(.largeTitle).foregroundColor(.secondary)
                    Text("选择条目后将在此显示高亮内容").foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .navigationTitle("GoodLinks")
            }
        }
        .onAppear {
            if selectedLinkId == nil, let first = viewModel.links.first?.id {
                selectedLinkId = first
            }
        }
        .onChange(of: viewModel.links) { links in
            if selectedLinkId == nil, let first = links.first?.id {
                selectedLinkId = first
            }
        }
    }
}


