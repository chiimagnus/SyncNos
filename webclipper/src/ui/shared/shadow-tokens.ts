import tokensCssRaw from '../styles/tokens.css?raw';

function toHostTokensCss(css: string) {
  // `tokens.css` uses `:root` selectors; in Shadow DOM we want `:host`.
  return css.replaceAll(':root', ':host');
}

export const SHADOW_HOST_TOKENS_CSS = toHostTokensCss(String(tokensCssRaw || ''));

