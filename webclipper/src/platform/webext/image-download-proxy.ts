/**
 * 通用防盗链图片下载服务
 *
 * - 基于域名映射的自动 Referer 注入（DNR API）
 * - Firefox 兼容（DNR 不可用时降级为普通 fetch）
 * - 未来添加新网站只需在 ANTI_HOTLINK_REFERER_MAP 中加一行
 *
 * > 性能说明：当前设计每次请求注册/清理独立规则。
 * > 如果一篇文章有 N 张防盗链图片，会执行 N 次注册/清理。
 * > 由于 updateSessionRules 是异步的，性能影响可接受。
 * > 未来可优化为"一次注册域名规则，所有图片共享"。
 */

// ============================================================================
// 配置表：防盗链网站的 Referer 映射
// ============================================================================

/**
 * 防盗链网站的 Referer 映射
 * Key: CDN 域名（exact match）
 * Value: 需要注入的 Referer
 *
 * 未来添加新网站只需在此加一行
 */
export const ANTI_HOTLINK_REFERER_MAP: Record<string, string> = {
  'cdnfile.sspai.com': 'https://sspai.com/',
  // 未来可扩展：
  // 'mmbiz.qpic.cn': 'https://mp.weixin.qq.com/',  // 微信公众号
  // 'picx.zhimg.com': 'https://www.zhihu.com/',    // 知乎
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查 URL 是否需要防盗链处理，返回对应的 Referer
 */
function getAntiHotlinkReferer(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return ANTI_HOTLINK_REFERER_MAP[hostname] || null;
  } catch {
    return null;
  }
}

/**
 * Feature-detect DNR 支持
 */
function isDnrSupported(): boolean {
  return !!(
    (globalThis as any).chrome?.declarativeNetRequest?.updateSessionRules
  );
}

/**
 * Content-Type 解析（与 image-inline.ts 保持一致）
 */
function parseContentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split(';')[0]!.trim().toLowerCase();
}

// ============================================================================
// DNR 规则注册/清理
// ============================================================================

/**
 * 注册临时 DNR 规则注入 Referer
 *
 * ⚠️ 重要：Chrome DNR 的 urlFilter 使用 filter list syntax：
 * - urlFilter: 'https://example.com/' 匹配 URL 中包含该子串的所有请求
 * - urlFilter: '|https://example.com/' 匹配以该字符串开头的 URL
 * - 我们使用 | 前缀匹配域名开头（包括 query string）
 */
async function registerRefererRule(ruleId: number, url: string, referer: string): Promise<void> {
  const chrome = (globalThis as any).chrome ?? (globalThis as any).browser;
  const isChrome = chrome?.runtime?.id != null;

  // 提取域名用于 urlFilter
  let domainPrefix: string;
  try {
    const { origin } = new URL(url);
    domainPrefix = `|${origin}/`;  // 例如: '|https://cdnfile.sspai.com/'
  } catch {
    domainPrefix = `|${url}`;  // fallback: 使用完整 URL
  }

  const condition = {
    urlFilter: domainPrefix,  // ⚠️ filter list syntax: 匹配该域名下所有 URL
    resourceTypes: ['xmlhttprequest'],
  } as any;

  // initiatorDomains 仅 Chrome 120+ 支持，Firefox 不支持
  // ⚠️ 必须确保 chrome.runtime.id 存在才设置
  if (isChrome && chrome.runtime?.id) {
    condition.initiatorDomains = [chrome.runtime.id];
  }

  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
      id: ruleId,  // ⚠️ 必须是正整数！
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{
          header: 'Referer',
          operation: 'set',
          value: referer,
        }],
      },
      condition,
    }],
  });
}

async function removeRefererRule(ruleId: number): Promise<void> {
  const chrome = (globalThis as any).chrome ?? (globalThis as any).browser;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
  });
}

// ============================================================================
// 下载逻辑
// ============================================================================

/**
 * 普通下载（公共逻辑）
 */
async function downloadWithPlainFetch(url: string, maxBytes: number): Promise<
  | { ok: true; blob: Blob; byteSize: number; contentType: string }
  | { ok: false; reason: 'http' | 'non_image' | 'empty' | 'too_large' | 'fetch' }
> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, reason: 'http' } as const;

    const contentType = parseContentType(res.headers.get('content-type') || '');
    if (!contentType.startsWith('image/')) {
      return { ok: false, reason: 'non_image' } as const;
    }

    const blob = await res.blob();
    const byteSize = blob.size || 0;
    if (!byteSize) return { ok: false, reason: 'empty' } as const;
    if (byteSize > maxBytes) return { ok: false, reason: 'too_large' } as const;

    return { ok: true, blob, byteSize, contentType } as const;
  } catch (_e) {
    return { ok: false, reason: 'fetch' } as const;
  }
}

/**
 * 智能下载图片，自动处理防盗链 Referer
 *
 * - 如果 URL 匹配防盗链规则，自动注入正确的 Referer
 * - Firefox 降级为普通 fetch（可能失败，但不会崩溃）
 *
 * @example
 * const result = await downloadImageSmart({
 *   url: 'https://cdnfile.sspai.com/xxx.jpg',
 *   maxBytes: 2_000_000,
 * });
 */
export async function downloadImageSmart(input: {
  url: string;
  maxBytes?: number;
}): Promise<
  | { ok: true; blob: Blob; byteSize: number; contentType: string }
  | { ok: false; reason: 'invalid_input' | 'http' | 'non_image' | 'empty' | 'too_large' | 'fetch' }
> {
  const safeUrl = String(input.url || '').trim();
  const maxBytes = Number(input.maxBytes) || 2_000_000;

  if (!safeUrl) {
    return { ok: false, reason: 'invalid_input' } as const;
  }

  // 检查是否需要防盗链处理
  const referer = getAntiHotlinkReferer(safeUrl);

  // 不需要防盗链处理，直接普通下载
  if (!referer) {
    return downloadWithPlainFetch(safeUrl, maxBytes);
  }

  // 需要防盗链处理
  // Firefox 降级：DNR 不可用时使用普通 fetch
  if (!isDnrSupported()) {
    console.warn('[image-download-proxy] DNR not supported (Firefox?), falling back to plain fetch', {
      url: safeUrl,
      expectedReferer: referer,
    });
    return downloadWithPlainFetch(safeUrl, maxBytes);
  }

  // 注册临时 DNR 规则注入 Referer
  // ⚠️ ruleId 必须是正整数
  const ruleId = Math.floor(Math.random() * 1000000) + 1;

  try {
    await registerRefererRule(ruleId, safeUrl, referer);
    return await downloadWithPlainFetch(safeUrl, maxBytes);
  } finally {
    // 无论成功/失败都清理规则
    removeRefererRule(ruleId).catch((e) => {
      console.warn('[image-download-proxy] cleanup rule failed', { ruleId, error: String(e) });
    });
  }
}
