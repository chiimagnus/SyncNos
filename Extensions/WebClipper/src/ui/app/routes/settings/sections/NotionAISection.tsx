import { buttonClassName, cardClassName, textInputClassName } from '../ui';

export function NotionAISection(props: {
  busy: boolean;
  modelIndex: string;
  onChangeModelIndex: (v: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const { busy, modelIndex, onChangeModelIndex, onSave, onReset } = props;
  return (
    <section className={cardClassName} aria-label="Notion AI settings">
      <div className="tw-flex tw-items-center tw-gap-2">
        <h2 className="tw-m-0 tw-min-w-0 tw-flex-1 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Notion AI</h2>
      </div>

      <div className="tw-mt-3 tw-grid tw-gap-2">
        <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-center tw-gap-3" aria-label="Preferred model index">
          <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Model Index</div>
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <input
              id="notionAiModelIndex"
              value={modelIndex}
              onChange={(e) => onChangeModelIndex(e.target.value)}
              disabled={busy}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="3"
              aria-label="Notion AI preferred model index"
              className={`${textInputClassName} tw-w-[120px]`}
            />
            <button id="btnNotionAiModelSave" className={buttonClassName} onClick={onSave} disabled={busy} type="button">
              Save
            </button>
            <button
              id="btnNotionAiModelReset"
              className={buttonClassName}
              onClick={onReset}
              disabled={busy}
              type="button"
              title="Reset to default"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="tw-grid tw-grid-cols-[110px_1fr] tw-items-start tw-gap-3" aria-label="Notion AI model note">
          <div className="tw-text-xs tw-font-bold tw-text-[var(--muted)]">Note</div>
          <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)]">
            Applies only when Notion AI model is set to Auto. Menu order may change in Notion.
          </div>
        </div>
      </div>
    </section>
  );
}
