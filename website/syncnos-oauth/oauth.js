(function () {
  var page = document.body.getAttribute('data-oauth-page');

  function query(selector) {
    return document.querySelector(selector);
  }

  function setStatus(kind, title, subtitle) {
    var icon = query('[data-status-icon]');
    var titleNode = query('[data-status-title]');
    var subtitleNode = query('[data-status-subtitle]');
    if (icon) {
      icon.className = 'oauth-status-icon oauth-status-icon-' + kind;
      icon.textContent = kind === 'loading' ? '' : kind === 'success' ? '✓' : '!';
    }
    if (titleNode) titleNode.textContent = title;
    if (subtitleNode) subtitleNode.textContent = subtitle;
  }

  function tryCloseCurrentPage() {
    window.close();
    window.open('', '_self');
    window.close();
  }

  function renderCallback() {
    var params = new URLSearchParams(location.search);
    var code = params.get('code') || '';
    var state = params.get('state') || '';
    var error = params.get('error') || '';
    var errorDescription = params.get('error_description') || '';
    var isWebClipper = state.indexOf('webclipper_') === 0;
    var isHealthIOS = state.indexOf('syncnos_health_ios_') === 0;

    if (isWebClipper) {
      var closeActions = query('[data-close-actions]');
      if (closeActions) closeActions.hidden = false;
      if (error) {
        setStatus('error', 'WebClipper 授权失败', errorDescription ? error + ': ' + errorDescription : error);
      } else if (code) {
        setStatus('success', 'WebClipper 授权已回传', '页面将自动关闭；若未关闭，请手动关闭并返回 WebClipper。');
        window.setTimeout(tryCloseCurrentPage, 1200);
      } else {
        setStatus('error', 'WebClipper 回调参数缺失', '请返回扩展重新发起 Connect。');
      }
      return;
    }

    if (isHealthIOS) {
      if (!error && !code) {
        setStatus('error', '回调参数缺失', '未收到 code/state 或 error；请返回应用重新发起授权。');
        return;
      }

      setStatus('loading', '正在重定向到 SyncNos...', '请稍候，正在尝试打开 SyncNos 应用并完成 OAuth 授权流程。');
      var callbackParams = new URLSearchParams();
      if (error) {
        callbackParams.set('error', error);
        if (errorDescription) callbackParams.set('error_description', errorDescription);
      } else {
        callbackParams.set('code', code);
        callbackParams.set('state', state);
      }
      window.setTimeout(function () {
        location.href = 'syncnos-health-ios://oauth/callback?' + callbackParams.toString();
      }, 250);
      window.setTimeout(function () {
        var fallback = query('[data-app-fallback]');
        if (fallback) fallback.hidden = false;
      }, 2000);
      return;
    }

    setStatus('error', '无法识别的回调请求', '缺少 state 或 state 前缀不受支持；请返回发起授权的应用重新尝试。');
  }

  function renderTest() {
    var codeInput = query('[data-test-code]');
    var errorInput = query('[data-test-error]');
    var errorDescriptionInput = query('[data-test-error-description]');

    function openCallback(state, extra) {
      var target = new URL('../callback/', location.href);
      var params = new URLSearchParams(extra || {});
      if (state) params.set('state', state);
      target.search = params.toString();
      location.href = target.href;
    }

    query('[data-test-webclipper]')?.addEventListener('click', function () {
      openCallback('webclipper_test_state', { code: codeInput?.value || 'test_code_12345' });
    });
    query('[data-test-ios]')?.addEventListener('click', function () {
      openCallback('syncnos_health_ios_test_state', { code: codeInput?.value || 'test_code_12345' });
    });
    query('[data-test-error-button]')?.addEventListener('click', function () {
      openCallback('webclipper_test_state', {
        error: errorInput?.value || 'access_denied',
        error_description: errorDescriptionInput?.value || '',
      });
    });
  }

  query('[data-close-page]')?.addEventListener('click', tryCloseCurrentPage);
  if (page === 'callback') renderCallback();
  if (page === 'test') renderTest();
})();
