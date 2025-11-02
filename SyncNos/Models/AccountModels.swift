import Foundation

// MARK: - Auth Tokens
struct AuthTokens: Codable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String?
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
    }
}

// MARK: - Login Method
struct LoginMethod: Codable, Identifiable, Equatable {
    var id: String { providerName + ":" + providerKey }
    let providerName: String
    let providerKey: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case providerName = "provider_name"
        case providerKey = "provider_key"
        case createdAt = "created_at"
    }
}

// MARK: - Account Profile
struct AccountProfile: Codable, Equatable {
    let userId: Int
    let email: String?
    let displayName: String?
    let avatarUrl: String?
    let membershipTier: String?
    let membershipExpiresAt: String?
    let createdAt: String?
    let updatedAt: String?
    let loginMethods: [LoginMethod]

    enum CodingKeys: String, CodingKey {
        case userId = "id"
        case email
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case membershipTier = "membership_tier"
        case membershipExpiresAt = "membership_expires_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case loginMethods = "login_methods"
    }
}
