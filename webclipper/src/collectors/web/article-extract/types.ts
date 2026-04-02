export type ExtractedWebArticle = {
  ok: true;
  title: string;
  author: string;
  publishedAt: string;
  excerpt: string;
  contentHTML: string;
  contentMarkdown: string;
  textContent: string;
  warningFlags: string[];
};
