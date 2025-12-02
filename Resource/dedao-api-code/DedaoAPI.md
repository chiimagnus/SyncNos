# 得到 API 完整文档

> 本文档整合了 `dedao-gui` 和 `dedao-dl` 两个开源项目的所有 API 接口，提供完整的得到平台 API 参考。

## 目录

- [基础配置](#基础配置)
- [认证机制](#认证机制)
- [API 分类](#api-分类)
  - [1. 登录认证 API](#1-登录认证-api)
  - [2. 用户信息 API](#2-用户信息-api)
  - [3. 首页与推荐 API](#3-首页与推荐-api)
  - [4. 课程 API](#4-课程-api)
  - [5. 文章 API](#5-文章-api)
  - [6. 电子书 API](#6-电子书-api)
  - [7. 电子书笔记 API](#7-电子书笔记-api)
  - [8. 每天听本书 API](#8-每天听本书-api)
  - [9. 音视频媒体 API](#9-音视频媒体-api)
  - [10. 知识城邦 API](#10-知识城邦-api)
  - [11. 学习圈 API](#11-学习圈-api)
  - [12. 直播 API](#12-直播-api)
  - [13. 其他 API](#13-其他-api)
- [数据模型](#数据模型)
- [错误处理](#错误处理)
- [反爬虫机制](#反爬虫机制)

---

## 基础配置

### API 基础地址

```
https://www.dedao.cn
```

### 请求头

```http
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Content-Type: application/json
```

### 通用响应格式

```json
{
    "h": {
        "c": 0,        // 状态码，0 表示成功
        "e": "",       // 错误信息
        "s": 0,
        "t": 1234567890,
        "apm": ""
    },
    "c": {
        // 响应数据
    }
}
```

---

## 认证机制

### Cookie 认证

得到 API 使用 Cookie 进行认证，登录成功后需要保存以下 Cookie：

| Cookie 名称 | 说明 |
|------------|------|
| `GAT` | 全局访问令牌 |
| `ISID` | 会话ID |
| `iget` | iget标识 |
| `token` | 用户令牌 |
| `csrfToken` | CSRF令牌（需要在请求头中作为 `Xi-Csrf-Token` 发送） |
| `_guard_device_id` | 设备ID |
| `_sid` | 会话ID |
| `acw_tc` | 阿里云WAF |
| `aliyungf_tc` | 阿里云防火墙 |

### CSRF Token

部分 API 需要在请求头中携带 CSRF Token：

```http
Xi-Csrf-Token: <csrfToken>
Xi-DT: web
```

---

## API 分类

### 1. 登录认证 API

#### 1.1 获取登录 Access Token

**请求**
```http
POST /loginapi/getAccessToken
```

**请求头**
```http
Xi-Csrf-Token: <csrfToken>
Xi-DT: web
```

**响应**
```json
{
    "accessToken": "xxx"
}
```

---

#### 1.2 获取登录二维码

**请求**
```http
GET /oauth/api/embedded/qrcode
```

**请求头**
```http
X-Oauth-Access-Token: <accessToken>
```

**响应**
```json
{
    "qrCodeString": "xxx",      // 二维码内容
    "qrCodeImage": "base64...", // 二维码图片 base64
    "expire": 300               // 过期时间（秒）
}
```

---

#### 1.3 轮询扫码登录结果

**请求**
```http
POST /oauth/api/embedded/qrcode/check_login
```

**请求头**
```http
X-Oauth-Access-Token: <accessToken>
```

**请求体**
```json
{
    "keepLogin": true,
    "pname": "igetoauthpc",
    "qrCode": "<qrCodeString>",
    "scene": "registerlogin"
}
```

**响应**
```json
{
    "status": 1,           // 0-等待扫码, 1-已扫码待确认, 2-登录成功, -1-二维码过期
    "msg": "",
    "data": {
        "uid": 123456,
        "token": "xxx"
    }
}
```

---

### 2. 用户信息 API

#### 2.1 获取用户信息

**请求**
```http
GET /api/pc/user/info
```

**响应**
```json
{
    "c": {
        "uid": 123456,
        "nickname": "用户昵称",
        "avatar": "https://...",
        "phone": "138****1234",
        "email": "",
        "is_vip": true,
        "vip_end_time": 1735689600
    }
}
```

---

#### 2.2 创建 Token

**请求**
```http
GET /ddph/v2/token/create
```

**响应**
```json
{
    "c": {
        "token": "xxx",
        "expire": 3600
    }
}
```

---

#### 2.3 获取电子书 VIP 信息

**请求**
```http
POST /api/pc/ebook2/v1/vip/info
```

**响应**
```json
{
    "c": {
        "uid": 123456,
        "nickname": "用户昵称",
        "is_vip": true,
        "begin_time": 1704067200,
        "end_time": 1735689600,
        "month_count": 12,
        "total_count": 100,
        "save_price": "999.00"
    }
}
```

---

#### 2.4 获取听书 VIP 信息

**请求**
```http
POST /pc/odob/v2/vipuser/vip_card_info
```

**响应**
```json
{
    "c": {
        "is_vip": true,
        "vip_type": 1,
        "expire_time": 1735689600
    }
}
```

---

### 3. 首页与推荐 API

#### 3.1 首页课程分类列表

**请求**
```http
POST /api/hades/v1/index/detail
```

**响应**
```json
{
    "c": {
        "list": [
            {
                "name": "课程",
                "category": "bauhinia",
                "count": 64
            },
            {
                "name": "听书书架",
                "category": "odob",
                "count": 1407
            },
            {
                "name": "电子书架",
                "category": "ebook",
                "count": 210
            },
            {
                "name": "锦囊",
                "category": "compass",
                "count": 15
            }
        ]
    }
}
```

**分类常量**
```
bauhinia - 课程
odob     - 听书
ebook    - 电子书
compass  - 锦囊
all      - 全部
```

---

#### 3.2 热门搜索

**请求**
```http
POST /api/search/pc/hot
```

**响应**
```json
{
    "c": {
        "hot_words": ["关键词1", "关键词2", "..."]
    }
}
```

---

#### 3.3 首页导航标签列表

**请求**
```http
POST /pc/sunflower/v1/label/list
```

**请求体**
```json
{
    "n_type": 4   // 2-电子书, 4-精选课程
}
```

**响应**
```json
{
    "c": {
        "list": [
            {
                "enid": "xxx",
                "name": "标签名称",
                "icon": "https://..."
            }
        ]
    }
}
```

---

#### 3.4 首页标签内容

**请求**
```http
POST /pc/sunflower/v1/label/content
```

**请求体**
```json
{
    "enid": "<label_enid>",
    "n_type": 4,
    "page": 1,
    "page_size": 20
}
```

---

#### 3.5 免费专区列表

**请求**
```http
GET /pc/sunflower/v1/resource/list
```

---

#### 3.6 算法筛选列表

**请求**
```http
POST /pc/label/v2/algo/pc/filter/list
```

---

#### 3.7 算法产品列表

**请求**
```http
POST /pc/label/v2/algo/pc/product/list
```

---

### 4. 课程 API

#### 4.1 课程列表

**请求**
```http
POST /api/hades/v2/product/list
```

**请求体**
```json
{
    "category": "bauhinia",
    "display_group": true,
    "filter": "all",
    "group_id": 0,
    "order": "study",
    "filter_complete": 0,
    "page": 1,
    "page_size": 18,
    "sort_type": "desc"
}
```

**参数说明**
| 参数 | 类型 | 说明 |
|------|------|------|
| category | string | 分类：bauhinia/odob/ebook/compass/all |
| order | string | 排序：study（学习时间）/newest（最新） |
| page | int | 页码 |
| page_size | int | 每页数量 |

**响应**
```json
{
    "c": {
        "list": [
            {
                "id": 51,
                "enid": "xxx",
                "title": "课程名称",
                "author": "作者",
                "icon": "https://...",
                "progress": 100,
                "price": "199.00",
                "type": 13,
                "class_type": 1,
                "course_num": 60,
                "publish_num": 60
            }
        ],
        "total": 64,
        "page": 1,
        "page_size": 18
    }
}
```

---

#### 4.2 课程分组列表（dedao-dl 独有）

**请求**
```http
POST /api/hades/v2/product/group/list
```

**请求体**
```json
{
    "category": "bauhinia",
    "display_group": false,
    "filter": "group",
    "group_id": 12345,
    "order": "study",
    "filter_complete": 0,
    "page": 1,
    "page_size": 18,
    "sort_type": "desc"
}
```

---

#### 4.3 课程详情

**请求**
```http
POST /pc/bauhinia/pc/class/info
```

**请求体**
```json
{
    "detail_id": "<course_id>",
    "is_login": 1
}
```

**响应**
```json
{
    "c": {
        "class_info": {
            "id": 51,
            "enid": "xxx",
            "name": "课程名称",
            "author": "作者",
            "intro": "课程介绍",
            "article_count": 60,
            "publish_num": 60,
            "price": "199.00",
            "has_audio": true
        },
        "chapter_list": [
            {
                "id": 1040,
                "name": "章节名称",
                "article_count": 3,
                "update_time": 1557072751
            }
        ]
    }
}
```

---

#### 4.4 名家讲书课程详情

**请求**
```http
POST /pc/sunflower/v1/depot/outside/detail
```

**请求体**
```json
{
    "product_enid": "<enid>",
    "product_type": 1013
}
```

---

### 5. 文章 API

#### 5.1 文章列表

**请求**
```http
POST /api/pc/bauhinia/pc/class/purchase/article_list
```

**请求体**
```json
{
    "chapter_id": "",
    "count": 30,
    "detail_id": "<course_id>",
    "include_edge": false,
    "is_unlearn": false,
    "max_id": 0,
    "max_order_num": 0,
    "reverse": false,
    "since_id": 0,
    "since_order_num": 0,
    "unlearn_switch": false
}
```

**响应**
```json
{
    "c": {
        "list": [
            {
                "id": 86033,
                "enid": "xxx",
                "title": "文章标题",
                "summary": "摘要",
                "publish_time": 1557072259,
                "audio_alias_ids": ["xxx"],
                "video_status": 0,
                "is_read": true
            }
        ]
    }
}
```

---

#### 5.2 文章 Token

**请求**
```http
POST /pc/bauhinia/pc/article/info
```

**请求体**
```json
{
    "detail_id": "<article_id>"
}
```

或（听书文章）
```json
{
    "audio_alias_id": "<alias_id>"
}
```

---

#### 5.3 文章详情

**请求**
```http
GET /pc/ddarticle/v1/article/get/v2?token=<token>&appid=<appid>&is_new=1
```

**响应**
```json
{
    "c": {
        "id": 86033,
        "title": "文章标题",
        "content": "[{\"type\":\"header\",\"text\":\"...\"},...]",
        "audio": {
            "alias_id": "xxx",
            "mp3_play_url": "https://...",
            "duration": 600
        }
    }
}
```

---

#### 5.4 文章重点

**请求**
```http
GET /pc/ddarticle/v1/article/get/v2?article_id_hazy=<enid>&product_type=<type>
```

---

#### 5.5 文章评论列表

**请求**
```http
POST /pc/ledgers/notes/article_comment_list
```

**请求体**
```json
{
    "detail_enid": "<article_enid>",
    "note_type": 2,
    "only_replied": false,
    "page": 1,
    "page_count": 20,
    "sort_by": "like",
    "source_type": 65
}
```

**参数说明**
| 参数 | 说明 |
|------|------|
| sort_by | like-最热, create-最新 |

---

### 6. 电子书 API

#### 6.1 电子书详情

**请求**
```http
GET /pc/ebook2/v1/pc/detail?id=<enid>
```

**响应**
```json
{
    "c": {
        "id": 12345,
        "enid": "xxx",
        "title": "书名",
        "cover": "https://...",
        "price": "29.99",
        "book_author": "作者",
        "book_intro": "简介",
        "publish_time": "2024-01-01",
        "is_buy": true,
        "is_vip_book": 1,
        "catalog_list": [
            {
                "level": 1,
                "text": "第一章",
                "href": "#chapter_1",
                "playOrder": 1
            }
        ],
        "douban_score": "8.5",
        "press": {
            "name": "出版社名称",
            "brief": "简介"
        }
    }
}
```

---

#### 6.2 电子书阅读 Token

**请求**
```http
POST /api/pc/ebook2/v1/pc/read/token
```

**请求体**
```json
{
    "id": "<enid>"
}
```

**响应**
```json
{
    "c": {
        "token": "xxx"
    }
}
```

---

#### 6.3 电子书信息（目录等）

**请求**
```http
GET /ebk_web/v1/get_book_info?token=<token>
```

**响应**
```json
{
    "bookInfo": {
        "block": [[...]],
        "orders": [
            {
                "chapterId": "xxx",
                "pathInEpub": "xxx"
            }
        ],
        "toc": [
            {
                "href": "xxx",
                "level": 1,
                "playOrder": 1,
                "offset": 0,
                "text": "章节名"
            }
        ],
        "pages": [
            {
                "cid": "xxx",
                "end_offset": 1000,
                "page_num": 1,
                "start_offset": 0
            }
        ]
    }
}
```

---

#### 6.4 获取电子书页面内容

**请求**
```http
POST /ebk_web_go/v2/get_pages
```

**请求体**
```json
{
    "chapter_id": "<chapter_id>",
    "count": 50,
    "index": 0,
    "offset": 0,
    "orientation": 0,
    "config": {
        "density": 1,
        "direction": 0,
        "font_name": "pingfang",
        "font_scale": 1,
        "font_size": 16,
        "height": 200000,
        "line_height": "2em",
        "margin_bottom": 20,
        "margin_left": 20,
        "margin_right": 20,
        "margin_top": 0,
        "paragraph_space": "1em",
        "platform": 1,
        "width": 60000
    },
    "token": "<read_token>"
}
```

**响应**
```json
{
    "is_end": false,
    "pages": [
        {
            "begin_offset": 0,
            "end_offset": 1000,
            "is_first": true,
            "is_last": false,
            "svg": "<base64_encrypted_svg>",
            "view_heigh_to_chapter_top": 0
        }
    ]
}
```

> **注意**: `svg` 字段是 AES 加密的 Base64 字符串，需要解密后才能使用。

**SVG 解密方法**
```go
key := []byte("3e4r06tjkpjcevlbslr3d96gdb5ahbmo")
iv := []byte("6fd89a1b3a7f48fb")
// 使用 AES-CBC 解密
```

---

#### 6.5 电子书评论列表

**请求**
```http
POST /pc/ebook2/v1/comment/list
```

**请求体**
```json
{
    "book_enid": "<enid>",
    "sort": "hot",
    "page": 1,
    "count": 20
}
```

---

#### 6.6 加入电子书架

**请求**
```http
POST /api/pc/ebook2/v1/bookshelf/add
```

**请求体**
```json
{
    "ids": ["<enid1>", "<enid2>"]
}
```

---

#### 6.7 移出电子书架

**请求**
```http
POST /api/pc/hades/v1/product/remove
```

**请求体**
```json
{
    "ids": ["<enid1>", "<enid2>"]
}
```

---

### 7. 电子书笔记 API ⭐

> 这是 dedao-dl 独有的 API，dedao-gui 未实现。

#### 7.1 获取电子书笔记列表

**请求**
```http
POST /api/pc/ledgers/ebook/list
```

**请求体**
```json
{
    "book_enid": "<电子书加密ID>"
}
```

**响应**
```json
{
    "c": {
        "list": [
            {
                "note_id": 123456789,
                "note_id_str": "123456789",
                "note_id_hazy": "xxx",
                "uid": 12345,
                "is_from_me": 1,
                "notes_owner": {
                    "id": "xxx",
                    "uid": 12345,
                    "name": "用户名",
                    "avatar": "https://..."
                },
                "note_type": 1,
                "source_type": 2,
                "note": "用户写的备注内容",
                "note_title": "笔记标题",
                "note_line": "用户划线的文本内容",
                "note_line_style": "underline",
                "create_time": 1705312800,
                "update_time": 1705312800,
                "tips": "",
                "share_url": "https://...",
                "extra": {
                    "title": "章节标题",
                    "source_type": 2,
                    "source_type_name": "电子书",
                    "book_id": 12345,
                    "book_name": "书名",
                    "book_section": "Chapter_1",
                    "book_start_pos": 1000,
                    "book_offset": 100,
                    "book_author": "作者"
                },
                "notes_count": {
                    "repost_count": 0,
                    "comment_count": 5,
                    "like_count": 10,
                    "word_count": 50
                },
                "can_edit": true,
                "is_permission": true
            }
        ]
    }
}
```

**笔记数据字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| note_id | int64 | 笔记唯一ID |
| note_line | string | **划线内容**（用户在书中标记的文本）⭐ |
| note | string | **笔记内容**（用户写的备注） |
| note_title | string | 笔记标题 |
| create_time | int64 | 创建时间戳 |
| extra.book_section | string | 所属章节标识 |
| extra.book_start_pos | int | 在书中的起始位置 |
| extra.book_offset | int | 偏移量 |
| notes_count.like_count | int | 点赞数 |
| notes_count.comment_count | int | 评论数 |
| share_url | string | 分享链接 |
| tips | string | 提示信息（非空表示不公开） |

---

### 8. 每天听本书 API

#### 8.1 听书详情

**请求**
```http
GET /pc/odob/pc/audio/detail?id=<topic_id>
```

---

#### 8.2 听书音频信息

**请求**
```http
POST /pc/odob/pc/audio/detail/alias
```

**请求体**
```json
{
    "alias_id": "<alias_id>"
}
```

**响应**
```json
{
    "c": {
        "alias_id": "xxx",
        "title": "书名",
        "mp3_play_url": "https://...",
        "duration": 1800,
        "summary": "简介",
        "icon": "https://...",
        "size": 28800000
    }
}
```

---

#### 8.3 加入听书书架

**请求**
```http
POST /pc/odob/v2/bookrack/pc/add
```

**请求体**
```json
{
    "enids": ["<enid1>", "<enid2>"]
}
```

---

#### 8.4 名家讲书合集详情（dedao-dl 独有）

**请求**
```http
POST /pc/sunflower/v1/depot/vip-user/topic-pkg/odob/details
```

**请求体**
```json
{
    "enid": "<enid>"
}
```

---

### 9. 音视频媒体 API

#### 9.1 批量获取音频详情

**请求**
```http
POST /pc/bauhinia/v1/audio/mutiget_by_alias
```

**请求体**
```json
{
    "ids": "<alias_id1>,<alias_id2>",
    "get_extra_data": 1
}
```

---

#### 9.2 火山引擎媒体信息

**请求**
```http
POST /media_gate/gate/api/v1/volc
```

**请求体**
```json
{
    "media_id": "<media_id>",
    "security_token": "<token>"
}
```

---

#### 9.3 火山引擎播放信息

**请求**
```http
GET https://vod.volcengineapi.com/?Action=GetPlayInfo&Version=2020-08-01&...
```

---

### 10. 知识城邦 API

#### 10.1 话题列表

**请求**
```http
POST /pc/ledgers/topic/all
```

**请求体**
```json
{
    "page_id": 1,
    "limit": 20
}
```

---

#### 10.2 话题详情

**请求**
```http
POST /pc/ledgers/topic/detail
```

**请求体**
```json
{
    "incr_view_count": true,
    "topic_id_hazy": "<topic_id>"
}
```

---

#### 10.3 话题笔记列表

**请求**
```http
POST /pc/ledgers/topic/notes/list
```

**请求体**
```json
{
    "count": 40,
    "is_elected": true,
    "page_id": 0,
    "version": 2,
    "topic_id_hazy": "<topic_id>"
}
```

**参数说明**
| 参数 | 说明 |
|------|------|
| is_elected | true-精选笔记, false-全部笔记 |

---

#### 10.4 笔记时间线

**请求**
```http
POST /pc/ledgers/notes/friends_timeline
```

**请求体**
```json
{
    "max_id": "<max_id>"
}
```

---

### 11. 学习圈 API（dedao-dl 独有）

#### 11.1 学习圈频道信息

**请求**
```http
POST /sphere/v1/app/channel/info
```

**请求体**
```json
{
    "channel_id": 12345
}
```

---

#### 11.2 学习圈首页分类

**请求**
```http
POST /pc/sphere/v1/app/topic/homepage/v2
```

**请求体**
```json
{
    "channel_id": 12345
}
```

---

#### 11.3 学习圈VIP信息

**请求**
```http
POST /sphere/v1/app/vip/info?channel_id=12345
```

---

### 12. 直播 API（dedao-gui 独有）

#### 12.1 直播标签列表

**请求**
```http
POST /api/pc/ddlive/v2/pc/home/live/tablist
```

---

#### 12.2 直播列表

**请求**
```http
POST /api/pc/ddlive/v2/pc/home/live/list
```

**请求体**
```json
{
    "live_type": 0,
    "page": 1,
    "limit": 20
}
```

---

#### 12.3 直播检查

**请求**
```http
POST /api/pc/ddlive/v2/pc/live/check
```

**请求体**
```json
{
    "alias_id": "<alias_id>",
    "invite_code": ""
}
```

---

#### 12.4 直播基础信息

**请求**
```http
POST /pc/ddlive/v2/pc/live/base
```

**请求体**
```json
{
    "alias_id": "<alias_id>"
}
```

---

### 13. 其他 API

#### 13.1 学习时间上报

**请求**
```http
POST /prime/v1/producer/time/report
```

---

## 数据模型

### 课程 (Course)

```typescript
interface Course {
    id: number;              // 课程ID
    enid: string;            // 加密ID
    type: number;            // 类型: 13-单本, 1013-名家讲书合集
    class_type: number;
    class_id: number;
    title: string;           // 标题
    intro: string;           // 介绍
    author: string;          // 作者
    icon: string;            // 图标
    progress: number;        // 学习进度 (0-100)
    duration: number;        // 时长（秒）
    course_num: number;      // 课程数量
    publish_num: number;     // 已发布数量
    price: string;           // 价格
    audio_detail: Audio;     // 音频详情
}
```

### 文章 (Article)

```typescript
interface Article {
    id: number;
    enid: string;
    class_enid: string;
    title: string;
    summary: string;
    publish_time: number;
    dd_article_id: number;
    dd_article_token: string;
    audio_alias_ids: string[];
    video_status: number;    // 1-有视频
    is_read: boolean;
    order_num: number;
}
```

### 电子书 (Ebook)

```typescript
interface EbookDetail {
    id: number;
    enid: string;
    title: string;
    cover: string;
    price: string;
    book_author: string;
    book_intro: string;
    publish_time: string;
    catalog_list: Catalog[];
    is_buy: boolean;
    is_vip_book: number;
    douban_score: string;
    press: {
        name: string;
        brief: string;
    };
}

interface Catalog {
    level: number;
    text: string;
    href: string;
    playOrder: number;
}
```

### 电子书笔记 (EbookNote)

```typescript
interface EbookNote {
    note_id: number;
    note_id_str: string;
    note_id_hazy: string;
    uid: number;
    is_from_me: number;
    notes_owner: NotesOwner;
    note_type: number;
    source_type: number;
    note: string;            // 用户写的备注
    note_title: string;
    note_line: string;       // 划线内容
    note_line_style: string;
    create_time: number;
    update_time: number;
    tips: string;
    share_url: string;
    extra: NoteExtra;
    notes_count: NotesCount;
    can_edit: boolean;
    is_permission: boolean;
}

interface NoteExtra {
    title: string;
    source_type: number;
    source_type_name: string;
    book_id: number;
    book_name: string;
    book_section: string;    // 章节标识
    book_start_pos: number;
    book_offset: number;
    book_author: string;
}

interface NotesCount {
    repost_count: number;
    comment_count: number;
    like_count: number;
    word_count: number;
}
```

### 音频 (Audio)

```typescript
interface Audio {
    alias_id: string;
    title: string;
    mp3_play_url: string;
    duration: number;
    summary: string;
    icon: string;
    size: number;
    token: string;
    drm_version: number;
}
```

---

## 错误处理

### 常见错误码

| 状态码 | 说明 |
|--------|------|
| 0 | 成功 |
| 401 | 未登录或登录过期 |
| 403 | 无权限访问 |
| 429 | 请求过于频繁 |
| 496 | 需要图形验证码验证 |

### 错误响应示例

```json
{
    "h": {
        "c": 401,
        "e": "用户未登录",
        "s": 0,
        "t": 1234567890
    },
    "c": null
}
```

---

## 反爬虫机制

### 触发条件

1. 请求频率过高
2. 短时间内大量下载
3. 异常的请求模式

### 规避策略

```go
const (
    maxRetries             = 3              // 最大重试次数
    initialBackoff         = 3 * time.Second
    cooldownTime           = 60             // 冷却时间（秒）
    maxConsecutiveFailures = 3              // 最大连续失败次数
    tokenBucketSize        = 5              // 令牌桶大小
    tokenRefillRate        = 0.5            // 令牌产生速率（个/秒）
)
```

### 建议

1. 使用令牌桶算法控制请求速率
2. 检测 403/429 响应后自动进入冷却期
3. 使用指数退避重试策略
4. 缓存已获取的数据（如电子书页面）
5. 如遇 496 错误，需要登录网页版进行图形验证码验证

---

## 附录：API 来源对照表

| API | dedao-gui | dedao-dl |
|-----|:---------:|:--------:|
| 登录认证 | ✅ | ✅ |
| 用户信息 | ✅ | ✅ |
| 课程列表 | ✅ | ✅ |
| 课程分组列表 | ❌ | ✅ |
| 课程详情 | ✅ | ✅ |
| 文章列表 | ✅ | ✅ |
| 文章详情 | ✅ | ✅ |
| 文章评论 | ✅ | ✅ |
| 电子书详情 | ✅ | ✅ |
| 电子书页面 | ✅ | ✅ |
| 电子书评论 | ✅ | ❌ |
| **电子书笔记** | ❌ | ✅ |
| 电子书架操作 | ✅ | ❌ |
| 听书详情 | ✅ | ✅ |
| 听书合集详情 | ❌ | ✅ |
| 听书书架操作 | ✅ | ❌ |
| 音频批量获取 | ✅ | ✅ |
| 火山引擎媒体 | ✅ | ❌ |
| 知识城邦话题 | ✅ | ✅ |
| 笔记时间线 | ✅ | ❌ |
| 学习圈 | ❌ | ✅ |
| 直播 | ✅ | ❌ |
| 热门搜索 | ✅ | ❌ |
| 首页推荐 | ✅ | ❌ |
| 学习时间上报 | ✅ | ❌ |

---

*文档更新时间：2024年12月*
*整理自 dedao-gui 和 dedao-dl 开源项目*

