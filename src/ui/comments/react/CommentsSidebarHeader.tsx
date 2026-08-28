type CommentsSidebarHeaderProps = {
  title: string;
  showCollapseButton: boolean;
  collapseLabel: string;
  onCollapse: () => void;
};

export function CommentsSidebarHeader({
  title,
  showCollapseButton,
  collapseLabel,
  onCollapse,
}: CommentsSidebarHeaderProps) {
  return (
    <header className="webclipper-inpage-comments-panel__header">
      <h2 className="webclipper-inpage-comments-panel__header-title">{title}</h2>
      <div className="webclipper-inpage-comments-panel__header-actions">
        {showCollapseButton ? (
          <button
            type="button"
            className="webclipper-inpage-comments-panel__collapse webclipper-btn header-button"
            aria-label={collapseLabel}
            onClick={onCollapse}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6.25 3.25L9.5 6.5L6.25 9.75"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M9.3 6.5H3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  );
}
