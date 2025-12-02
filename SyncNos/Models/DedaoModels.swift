import Foundation

// MARK: - API 响应包装

/// 得到 API 通用响应结构
struct DedaoResponse<T: Codable>: Codable {
    let h: DedaoResponseHeader
    let c: T?
}

/// 得到 API 响应头
struct DedaoResponseHeader: Codable {
    let c: Int           // 状态码，0 表示成功
    let e: String        // 错误信息
    let s: Int
    let t: Int64
}

// MARK: - 电子书模型

/// 得到电子书模型（来自书架列表 API）
struct DedaoEbook: Codable, Identifiable {
    let id: Int
    let enid: String?          // 加密 ID（可能不存在，使用 id 作为备用）
    let title: String
    let author: String?
    let icon: String?          // 封面图
    let intro: String?
    let progress: Int?         // 阅读进度
    let price: String?
    let isVipBook: Int?
    let type: Int?             // 类型
    let classType: Int?
    let duration: Int?         // 时长
    let courseNum: Int?        // 课程数量
    let publishNum: Int?       // 已发布数量
    let isFinished: Int?       // 是否已完成
    let status: Int?           // 状态
    let isNew: Int?            // 是否新内容
    let groupId: Int?          // 分组 ID
    let ddUrl: String?         // 得到 App URL
    let extInfo: String?       // 扩展信息
    let isCollected: Bool?     // 是否收藏
    let isSelfBuildGroup: Bool? // 是否自建分组
    let productIntro: String?  // 产品介绍
    let lastReadInfo: String?  // 最后阅读信息
    
    /// 获取有效的唯一标识符（优先使用 enid，否则使用 id）
    var effectiveId: String {
        enid ?? String(id)
    }
    
    private enum CodingKeys: String, CodingKey {
        case id, enid, title, author, icon, intro, progress, price, type, duration, status
        case isVipBook = "is_vip_book"
        case classType = "class_type"
        case courseNum = "course_num"
        case publishNum = "publish_num"
        case isFinished = "is_finished"
        case isNew = "is_new"
        case groupId = "group_id"
        case ddUrl = "dd_url"
        case extInfo = "ext_info"
        case isCollected = "is_collected"
        case isSelfBuildGroup = "is_self_build_group"
        case productIntro = "product_intro"
        case lastReadInfo = "last_read_info"
    }
}

/// 书籍列表响应
struct DedaoEbookListResponse: Codable {
    let list: [DedaoEbook]
    let total: Int?
    let isMore: Int?
    let sphereGuide: Bool?
    let bottomTips: String?
    
    private enum CodingKeys: String, CodingKey {
        case list, total
        case isMore = "is_more"
        case sphereGuide = "sphere_guide"
        case bottomTips = "bottom_tips"
    }
}

// MARK: - 电子书笔记模型

/// 得到电子书笔记 - 兼容多种 API 响应格式
/// 实际 API 可能返回两种格式：
/// 1. 标准格式：包含 note_id, note_line 等字段（纯电子书笔记）
/// 2. 混合格式：包含 origin_note_id_hazy, highlights, video 等字段（课程/视频笔记）
struct DedaoEbookNote: Codable, Identifiable {
    // === 标准格式字段 ===
    let noteId: Int64?
    let noteIdStr: String?
    let noteIdHazy: String?
    let uid: Int?
    let isFromMe: Int?          // 1 = 自己的笔记
    let notesOwner: DedaoNotesOwner?
    let noteType: Int?
    let sourceType: Int?
    let note: String?           // 用户备注（可能为空字符串）
    let noteTitle: String?
    let noteLine: String?       // 划线内容（标准格式）
    let noteLineStyle: String?
    let createTime: Int64?
    let updateTime: Int64?
    let tips: String?
    let shareUrl: String?
    let extra: DedaoNoteExtra?
    let notesCount: DedaoNotesCount?
    let canEdit: Bool?
    let isPermission: Bool?
    
    // === 混合格式字段 ===
    let originNoteIdHazy: String?    // 原始笔记ID（混合格式）
    let rootNoteId: Int64?
    let rootNoteIdHazy: String?
    let originContentType: Int?
    let contentType: Int?
    let noteClass: Int?              // "class" 是 Swift 关键字，重命名
    let highlights: [DedaoHighlightItem]?  // 高亮列表
    let rootHighlights: [DedaoHighlightItem]?
    let state: Int?
    let auditState: Int?
    let lesson: DedaoLesson?         // 课程信息
    let ddurl: DedaoDdUrl?           // 得到 URL
    let video: DedaoVideo?           // 视频信息
    let notesLikeCount: Int?
    
    /// 获取有效的唯一标识符
    var effectiveId: String {
        if let str = noteIdStr, !str.isEmpty { return str }
        if let id = noteId { return String(id) }
        if let hazy = originNoteIdHazy, !hazy.isEmpty { return hazy }
        if let hazy = noteIdHazy, !hazy.isEmpty { return hazy }
        return UUID().uuidString
    }
    
    /// 获取有效的划线内容（优先标准格式，否则从 highlights 提取）
    var effectiveNoteLine: String {
        if let line = noteLine, !line.isEmpty { return line }
        if let highlights = highlights, let first = highlights.first {
            return first.text ?? ""
        }
        return ""
    }
    
    /// 获取有效的创建时间
    var effectiveCreateTime: Int64 {
        createTime ?? 0
    }
    
    /// 获取有效的更新时间
    var effectiveUpdateTime: Int64 {
        updateTime ?? createTime ?? 0
    }
    
    /// 判断是否为有效的电子书笔记（有实际内容）
    var isValidEbookNote: Bool {
        !effectiveNoteLine.isEmpty || (note != nil && !note!.isEmpty)
    }
    
    var id: String { effectiveId }
    
    private enum CodingKeys: String, CodingKey {
        // 标准格式
        case noteId = "note_id"
        case noteIdStr = "note_id_str"
        case noteIdHazy = "note_id_hazy"
        case uid
        case isFromMe = "is_from_me"
        case notesOwner = "notes_owner"
        case noteType = "note_type"
        case sourceType = "source_type"
        case note
        case noteTitle = "note_title"
        case noteLine = "note_line"
        case noteLineStyle = "note_line_style"
        case createTime = "create_time"
        case updateTime = "update_time"
        case tips
        case shareUrl = "share_url"
        case extra
        case notesCount = "notes_count"
        case canEdit = "can_edit"
        case isPermission = "is_permission"
        // 混合格式
        case originNoteIdHazy = "origin_note_id_hazy"
        case rootNoteId = "root_note_id"
        case rootNoteIdHazy = "root_note_id_hazy"
        case originContentType = "origin_content_type"
        case contentType = "content_type"
        case noteClass = "class"
        case highlights
        case rootHighlights = "root_highlights"
        case state
        case auditState = "audit_state"
        case lesson
        case ddurl
        case video
        case notesLikeCount = "notes_like_count"
    }
}

/// 高亮项目（混合格式中的 highlights 数组元素）
struct DedaoHighlightItem: Codable {
    let text: String?
    let startPos: Int?
    let endPos: Int?
    let color: Int?
    
    private enum CodingKeys: String, CodingKey {
        case text
        case startPos = "start_pos"
        case endPos = "end_pos"
        case color
    }
}

/// 课程信息
struct DedaoLesson: Codable {
    let ptype: Int?
    let pid: Int?
    let pidStr: String?
    
    private enum CodingKeys: String, CodingKey {
        case ptype, pid
        case pidStr = "pid_str"
    }
}

/// 得到 URL 信息
struct DedaoDdUrl: Codable {
    let needCheckBuy: Bool?
    let url1: String?
    let url2: String?
    let needVisitorPopLoginView: Bool?
}

/// 视频信息
struct DedaoVideo: Codable {
    let videoId: Int?
    let videoDuration: Int?
    let videoDurationLabel: String?
    let videoCover: String?
    let videoState: Int?
    let resource: String?
    
    private enum CodingKeys: String, CodingKey {
        case videoId = "video_id"
        case videoDuration = "video_duration"
        case videoDurationLabel = "video_duration_label"
        case videoCover = "video_cover"
        case videoState = "video_state"
        case resource
    }
}

/// 笔记扩展信息
struct DedaoNoteExtra: Codable {
    let title: String?          // 章节标题
    let sourceType: Int?
    let sourceTypeName: String?
    let bookId: Int?
    let bookName: String?
    let bookSection: String?    // 章节标识
    let bookStartPos: Int?
    let bookOffset: Int?
    let bookAuthor: String?
    
    private enum CodingKeys: String, CodingKey {
        case title
        case sourceType = "source_type"
        case sourceTypeName = "source_type_name"
        case bookId = "book_id"
        case bookName = "book_name"
        case bookSection = "book_section"
        case bookStartPos = "book_start_pos"
        case bookOffset = "book_offset"
        case bookAuthor = "book_author"
    }
}

/// 笔记拥有者
struct DedaoNotesOwner: Codable {
    let id: String?
    let uid: Int?
    let name: String?
    let avatar: String?
}

/// 笔记统计
struct DedaoNotesCount: Codable {
    let repostCount: Int?
    let commentCount: Int?
    let likeCount: Int?
    let wordCount: Int?
    
    private enum CodingKeys: String, CodingKey {
        case repostCount = "repost_count"
        case commentCount = "comment_count"
        case likeCount = "like_count"
        case wordCount = "word_count"
    }
}

/// 笔记列表响应
struct DedaoEbookNotesResponse: Codable {
    let list: [DedaoEbookNote]
}

// MARK: - 用户信息

/// 得到用户信息
struct DedaoUserInfo: Codable {
    let uid: Int
    let nickname: String
    let avatar: String
    let phone: String?
    let isVip: Bool?
    
    private enum CodingKeys: String, CodingKey {
        case uid, nickname, avatar, phone
        case isVip = "is_vip"
    }
}

// MARK: - UI 列表模型

/// 得到书籍列表项（用于 UI 展示）
struct DedaoBookListItem: Identifiable, Hashable {
    let bookId: String         // enid
    let title: String
    let author: String
    let cover: String
    var highlightCount: Int
    
    var id: String { bookId }
    
    /// 从 API 响应模型创建
    init(from ebook: DedaoEbook, highlightCount: Int = 0) {
        self.bookId = ebook.effectiveId
        self.title = ebook.title
        self.author = ebook.author ?? ""
        self.cover = ebook.icon ?? ""
        self.highlightCount = highlightCount
    }
    
    /// 直接初始化
    init(bookId: String, title: String, author: String, cover: String, highlightCount: Int) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.cover = cover
        self.highlightCount = highlightCount
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(bookId)
    }
    
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.bookId == rhs.bookId
    }
}

// MARK: - 扫码登录相关

/// 二维码响应
struct DedaoQRCodeResponse: Codable {
    let qrCodeString: String
    let qrCodeImage: String?   // Base64 图片（可选）
    let expire: Int
    
    private enum CodingKeys: String, CodingKey {
        case qrCodeString = "qrcode_string"
        case qrCodeImage = "qrcode_image"
        case expire
    }
}

/// 登录状态检查响应
struct DedaoCheckLoginResponse: Codable {
    let status: Int            // 0-等待扫码, 1-已扫码待确认, 2-登录成功, -1-二维码过期
    let msg: String
    let data: DedaoLoginData?
}

/// 登录数据
struct DedaoLoginData: Codable {
    let uid: Int?
    let token: String?
}

// MARK: - 错误定义

/// 得到 API 错误
enum DedaoAPIError: Error, LocalizedError {
    case notLoggedIn
    case sessionExpired
    case invalidResponse
    case serverError(code: Int, message: String)
    case networkError(Error)
    case rateLimited
    case needVerification    // 需要图形验证码
    case qrCodeExpired
    
    var errorDescription: String? {
        switch self {
        case .notLoggedIn:
            return String(localized: "dedao.error.notLoggedIn")
        case .sessionExpired:
            return String(localized: "dedao.error.sessionExpired")
        case .invalidResponse:
            return String(localized: "dedao.error.invalidResponse")
        case .serverError(let code, let message):
            return String(localized: "dedao.error.serverError \(code): \(message)")
        case .networkError(let error):
            return String(localized: "dedao.error.networkError \(error.localizedDescription)")
        case .rateLimited:
            return String(localized: "dedao.error.rateLimited")
        case .needVerification:
            return String(localized: "dedao.error.needVerification")
        case .qrCodeExpired:
            return String(localized: "dedao.error.qrCodeExpired")
        }
    }
}

