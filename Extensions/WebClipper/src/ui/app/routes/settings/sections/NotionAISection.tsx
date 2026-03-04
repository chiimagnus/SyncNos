import { buttonClassName, buttonStyle, cardClassName, cardStyle, textInputClassName } from '../ui';

export function NotionAISection(props: {
  busy: boolean;
  modelIndex: string;
  onChangeModelIndex: (v: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const { busy, modelIndex, onChangeModelIndex, onSave, onReset } = props;
  return (
    <section style={cardStyle as any} className={cardClassName} aria-label="Notion AI">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Notion AI</h2>
      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={modelIndex}
          onChange={(e) => onChangeModelIndex(e.target.value)}
          disabled={busy}
          inputMode="numeric"
          placeholder="3"
          style={{ width: 120 }}
          className={textInputClassName}
        />
        <button className={buttonClassName} style={buttonStyle as any} onClick={onSave} disabled={busy}>
          Save
        </button>
        <button className={buttonClassName} style={buttonStyle as any} onClick={onReset} disabled={busy}>
          Reset
        </button>
      </div>
      <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>Applies only when Notion AI model is set to Auto. Menu order may change in Notion.</div>
    </section>
  );
}

