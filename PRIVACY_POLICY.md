# 隐私协议

最后更新日期：2025年9月13日

感谢您选择使用SyncBookNotes（以下简称"本应用"）。本隐私协议旨在向您说明本应用如何收集、使用、存储和保护您的个人信息，以及您享有的相关权利。请您在使用本应用前仔细阅读并理解本协议。

## 1. 信息收集与使用

### 1.1 Apple Books数据访问
本应用会访问您设备上的Apple Books数据库，以读取您的读书笔记和高亮信息。具体包括：
- 书籍标题和作者信息
- 高亮文本内容
- 您添加的注释
- 高亮和注释的创建时间及修改时间
- 高亮的颜色标记

### 1.2 数据处理方式
- 本应用仅以只读方式访问Apple Books数据库，不会修改、删除或添加任何数据
- 所有数据处理均在您的本地设备上进行，不会上传至任何服务器
- 本应用不会收集您的阅读习惯、偏好设置或其他个人使用数据
- 本应用严格遵循数据最小化原则，仅收集和处理提供服务所必需的数据

### 1.3 Notion同步数据
当您选择将数据同步到Notion时，本应用会将您的读书笔记和高亮信息发送到Notion服务器。这些数据包括：
- 书籍信息（标题、作者）
- 高亮文本和您的注释
- 相关的时间戳信息

为避免在Notion中创建重复内容，本应用采用以下机制：
- 为每个高亮分配唯一UUID标识符
- 在同步前检查目标页面是否已存在相同UUID的内容
- 仅添加新的或修改的内容

### 1.4 配置信息存储
本应用会在您的设备上本地存储以下配置信息：
- Notion API密钥
- Notion页面ID
- 同步数据库ID

## 2. 数据传输与存储

### 2.1 本地处理
除非您主动选择同步到Notion，否则所有数据都仅在您的本地设备上处理，不会传输到任何外部服务器。

### 2.2 Notion同步
当您启用Notion同步功能时：
- 数据会通过安全的HTTPS协议传输到Notion服务器
- 数据存储和处理遵循Notion的隐私政策和服务条款
- 您可以通过Notion的界面管理、编辑或删除已同步的数据

## 3. 安全措施

### 3.1 沙盒机制
本应用遵循macOS沙盒安全机制，在entitlements文件中声明了以下权限：
- 网络客户端访问权限：用于与Notion API通信
- 用户选择文件的只读访问权限：用于访问Apple Books数据库
- 下载目录的只读访问权限：用于访问可能存储在下载目录的数据库文件
- 应用范围书签权限：用于安全访问用户授权的数据库文件

### 3.2 安全范围书签
为访问Apple Books数据库，本应用使用安全范围书签技术：
- 需要您明确授权访问数据库文件
- 书签数据加密存储在应用设置中
- 只在需要时临时获取访问权限

### 3.3 配置信息保护
- Notion API密钥和其他配置信息存储在应用沙盒内的用户默认设置中
- 建议用户在使用完毕后及时清除配置信息，以确保账户安全

### 3.4 数据传输安全
本应用采用以下安全措施保护数据传输：
- 使用HTTPS协议与Notion API通信
- Notion API密钥存储在应用沙盒内的用户默认设置中
- 所有网络请求使用现代TLS加密

## 4. 您的权利

### 4.1 数据控制权
- 您可以随时在应用设置中禁用Notion同步功能
- 您可以随时更改或删除存储的Notion配置信息

### 4.2 数据删除权
- 您可以在Notion中直接删除已同步的数据
- 删除应用会同时删除所有本地配置信息

### 4.3 访问权限控制
- 您可以随时在系统设置中撤销本应用对Apple Books数据库的访问权限

### 4.4 配置信息清除
您可以通过以下方式清除本地配置信息：
- 在应用设置中手动删除Notion配置信息
- 卸载应用将自动删除所有本地配置信息
- 用户可以随时在系统设置中撤销应用对Apple Books数据库的访问权限

## 5. 数据保留政策

### 5.1 本地数据
- 本应用不会在您的设备上持久化存储Apple Books的原始数据
- 应用仅在运行时临时读取和处理数据，关闭后不保留任何缓存

### 5.2 配置信息
- Notion配置信息会保留在您的设备上，直到您主动删除应用或清除配置

### 5.3 同步数据
- 已同步到Notion的数据由Notion负责存储和管理，保留政策遵循Notion的服务条款

## 6. 协议变更

我们可能会不时更新本隐私协议。如有重大变更，我们将在应用更新时通知您。

## 7. 联系我们

如果您对本隐私协议有任何疑问或建议，请通过以下方式联系我们：
- 项目GitHub页面提交Issue：https://github.com/chiimagnus/SyncNos/issues

---

本隐私协议的解释权归SyncNos开发团队所有。

---

# Privacy Policy

Last Updated Date: September 13, 2025

Thank you for choosing to use SyncBookNotes (hereinafter referred to as "the Application"). This Privacy Policy is intended to inform you how the Application collects, uses, stores, and protects your personal information, as well as the rights you are entitled to. Please read and understand this agreement carefully before using the Application.

## 1. Information Collection and Use

### 1.1 Apple Books Data Access
The Application will access the Apple Books database on your device to read your book notes and highlight information. Specifically including:
- Book titles and author information
- Highlighted text content
- Annotations you have added
- Creation and modification times of highlights and annotations
- Color markers of highlights

### 1.2 Data Processing Method
- The Application accesses the Apple Books database in read-only mode only, without modifying, deleting, or adding any data
- All data processing is performed locally on your device and will not be uploaded to any server
- The Application does not collect your reading habits, preference settings, or other personal usage data
- The Application strictly follows the principle of data minimization, collecting and processing only the data necessary to provide the service

### 1.3 Notion Synchronization Data
When you choose to synchronize data to Notion, the Application will send your book notes and highlight information to Notion servers. This data includes:
- Book information (title, author)
- Highlighted text and your annotations
- Related timestamp information

To avoid creating duplicate content in Notion, the Application adopts the following mechanisms:
- Assign a unique UUID identifier to each highlight
- Check if content with the same UUID already exists on the target page before synchronization
- Only add new or modified content

### 1.4 Configuration Information Storage
The Application will locally store the following configuration information on your device:
- Notion API key
- Notion page ID
- Sync database ID

## 2. Data Transmission and Storage

### 2.1 Local Processing
Unless you actively choose to synchronize to Notion, all data is processed only on your local device and will not be transmitted to any external server.

### 2.2 Notion Synchronization
When you enable the Notion synchronization feature:
- Data will be transmitted to Notion servers through secure HTTPS protocol
- Data storage and processing follow Notion's privacy policy and terms of service
- You can manage, edit, or delete synchronized data through Notion's interface

## 3. Security Measures

### 3.1 Sandbox Mechanism
The Application follows the macOS sandbox security mechanism, declaring the following permissions in the entitlements file:
- Network client access permission: for communicating with the Notion API
- Read-only access permission to user-selected files: for accessing the Apple Books database
- Read-only access permission to the Downloads directory: for accessing database files that may be stored in the Downloads directory
- Application-scoped bookmark permission: for securely accessing user-authorized database files

### 3.2 Security-Scoped Bookmarks
To access the Apple Books database, the Application uses security-scoped bookmark technology:
- Requires your explicit authorization to access the database file
- Bookmark data is encrypted and stored in application settings
- Access permissions are temporarily obtained only when needed

### 3.3 Configuration Information Protection
- Notion API keys and other configuration information are stored in user defaults within the application sandbox
- Users are advised to clear configuration information in a timely manner after use to ensure account security

### 3.4 Data Transmission Security
The Application adopts the following security measures to protect data transmission:
- Uses HTTPS protocol to communicate with the Notion API
- Notion API keys are stored in user defaults within the application sandbox
- All network requests use modern TLS encryption

## 4. Your Rights

### 4.1 Data Control Rights
- You can disable the Notion synchronization feature at any time in the application settings
- You can change or delete stored Notion configuration information at any time

### 4.2 Data Deletion Rights
- You can directly delete synchronized data in Notion
- Deleting the application will simultaneously delete all local configuration information

### 4.3 Access Permission Control
- You can revoke the Application's access permission to the Apple Books database at any time in System Settings

### 4.4 Configuration Information Clearance
You can clear local configuration information through the following methods:
- Manually delete Notion configuration information in application settings
- Uninstalling the application will automatically delete all local configuration information
- Users can revoke the application's access permission to the Apple Books database at any time in System Settings

## 5. Data Retention Policy

### 5.1 Local Data
- The Application will not persistently store the original Apple Books data on your device
- The Application only temporarily reads and processes data during runtime and does not retain any cache after closing

### 5.2 Configuration Information
- Notion configuration information will be retained on your device until you actively delete the application or clear the configuration

### 5.3 Synchronized Data
- Data synchronized to Notion is stored and managed by Notion, and retention policies follow Notion's terms of service

## 6. Policy Changes

We may update this Privacy Policy from time to time. In the event of significant changes, we will notify you when updating the application.

## 7. Contact Us

If you have any questions or suggestions regarding this Privacy Policy, please contact us through the following methods:
- Submit an Issue on the project GitHub page: https://github.com/chiimagnus/SyncNos/issues

The right of interpretation of this Privacy Policy belongs to the SyncBookNotes development team.