import { cardClassName, cardStyle, checkboxClassName } from '../ui';

export function InpageSection(props: { busy: boolean; supportedOnly: boolean | null; onToggleSupportedOnly: (next: boolean) => void }) {
  const { busy, supportedOnly, onToggleSupportedOnly } = props;
  return (
    <section style={cardStyle as any} className={cardClassName} aria-label="Inpage Button">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">Inpage Button</h2>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }} className="tw-text-sm tw-font-semibold tw-text-[var(--muted)]">
        <input
          type="checkbox"
          checked={!!supportedOnly}
          disabled={busy || supportedOnly == null}
          onChange={(e) => onToggleSupportedOnly(!!e.target.checked)}
          className={checkboxClassName}
        />
        仅在支持站点显示 Inpage 按钮
      </label>
      <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>Applies immediately to existing tabs.</div>
    </section>
  );
}

