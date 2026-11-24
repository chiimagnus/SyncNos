import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createSecureOAuthState } from '@services/sync/oauth-guard';

const html = readFileSync(resolve('website/syncnos-oauth/callback/index.html'), 'utf8');
const script = readFileSync(resolve('website/syncnos-oauth/oauth.js'), 'utf8');

function renderCallback(params: Record<string, string>) {
  const url = 'https://chiimagnus.github.io/SyncNos/syncnos-oauth/callback/?' + new URLSearchParams(params);
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const close = vi.spyOn(dom.window, 'close');
  const timeout = vi.spyOn(dom.window, 'setTimeout');
  dom.window.eval(script);
  const title = dom.window.document.querySelector('[data-status-title]')?.textContent;
  const icon = dom.window.document.querySelector('[data-status-icon]')?.className;
  return { dom, title, icon, close, timeout };
}

describe('website OAuth callback', () => {
  it('recognizes the actual random state emitted by both extension providers without claiming token exchange success or closing early', () => {
    const result = renderCallback({ code: 'test-code', state: createSecureOAuthState() });
    expect(result.title).toBe('SyncNos 已收到授权回调');
    expect(result.icon).toContain('oauth-status-icon-loading');
    expect(result.close).not.toHaveBeenCalled();
    expect(result.timeout).not.toHaveBeenCalled();
    result.dom.window.close();
  });

  it.each([
    [{ error: 'access_denied', state: createSecureOAuthState() }, 'WebClipper 授权失败'],
    [{ state: createSecureOAuthState() }, 'WebClipper 回调参数缺失'],
    [{ code: 'test-code' }, '无法识别的回调请求'],
    [{ code: 'test-code', state: 'unknown' }, '无法识别的回调请求'],
  ])('reports invalid or denied callbacks without closing the tab', (params, title) => {
    const result = renderCallback(params as Record<string, string>);
    expect(result.title).toBe(title);
    expect(result.close).not.toHaveBeenCalled();
    expect(result.timeout).not.toHaveBeenCalled();
    result.dom.window.close();
  });

  it('keeps the existing iOS callback routing separate', () => {
    const result = renderCallback({ code: 'test-code', state: 'syncnos_health_ios_test_state' });
    expect(result.title).toBe('正在重定向到 SyncNos...');
    expect(result.timeout).toHaveBeenCalledTimes(2);
    result.dom.window.close();
  });
});
