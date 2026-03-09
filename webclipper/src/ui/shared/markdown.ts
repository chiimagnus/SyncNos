import MarkdownIt from 'markdown-it';

export type MarkdownRendererOptions = {
  /**
   * If true, rendered links will open in a new tab.
   * Defaults to true to keep popup/app behavior consistent.
   */
  openLinksInNewTab?: boolean;
};

export function createMarkdownRenderer(options: MarkdownRendererOptions = {}) {
  const openLinksInNewTab = options.openLinksInNewTab ?? true;
  const inst = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    typographer: false,
  });

  try {
    inst.enable(['table']);
  } catch (_e) {
    // ignore
  }

  if (openLinksInNewTab) {
    const defaultRender =
      inst.renderer.rules.link_open ||
      ((tokens, idx, opts, _env, self) => {
        return self.renderToken(tokens, idx, opts);
      });

    inst.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      if (token) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noreferrer noopener');
      }
      return defaultRender(tokens, idx, opts, env, self);
    };
  }

  return inst;
}
