import type { ArticleCommentLocator } from '@services/comments/domain/comment-locator';
import type { CommentSidebarPanelApi } from '@services/comments/sidebar/comment-sidebar-contract';

export type ThreadedCommentsPanelApi = CommentSidebarPanelApi & {
  refreshLocatorRoots: () => void;
};

export type CommentLocatorSurfaceRoots = {
  sourceRoot: Element;
  scrollRoot: Element;
};

export type MountOptions = {
  surface: 'app-wide' | 'app-narrow' | 'inpage';
  getLocatorSurfaceRoots?: () => CommentLocatorSurfaceRoots | null;
  getLocatorRoots?: (locator: ArticleCommentLocator) => readonly Element[];
};
