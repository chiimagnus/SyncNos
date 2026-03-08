import type { DetailHeaderAction } from './detail-header-actions';

export type DetailHeaderActionBarProps = {
  actions: DetailHeaderAction[];
  buttonClassName: string;
  className?: string;
};

export function DetailHeaderActionBar({ actions, buttonClassName, className }: DetailHeaderActionBarProps) {
  if (!actions.length) return null;

  return (
    <div className={className || 'tw-flex tw-items-center tw-gap-2'}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          title={action.label}
          onClick={() => {
            action.onTrigger().catch(() => {});
          }}
          className={buttonClassName}
          aria-label={action.label}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
