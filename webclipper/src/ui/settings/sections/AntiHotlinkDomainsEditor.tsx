import { useMemo, useRef } from 'react';

import { t } from '@i18n';
import { buttonClassName, dangerButtonClassName, textInputClassName } from '@ui/settings/ui';

export type AntiHotlinkRuleEditorRow = {
  domain: string;
  referer: string;
};

export type AntiHotlinkRuleEditorError = {
  domain?: string;
  referer?: string;
};

export function AntiHotlinkDomainsEditor(props: {
  id: string;
  busy: boolean;
  rules: AntiHotlinkRuleEditorRow[];
  errors: AntiHotlinkRuleEditorError[];
  onChangeRule: (index: number, patch: Partial<AntiHotlinkRuleEditorRow>) => void;
  onAddRule: () => void;
  onRemoveRule: (index: number) => void;
  onApplyRules: () => void;
  onResetRules: () => void;
}) {
  const { id, busy, rules, errors, onChangeRule, onAddRule, onRemoveRule, onApplyRules, onResetRules } = props;
  const rows = useMemo(() => (Array.isArray(rules) ? rules : []), [rules]);
  const rowErrors = useMemo(() => (Array.isArray(errors) ? errors : []), [errors]);
  const rootRef = useRef<HTMLElement | null>(null);

  return (
    <section
      id={id}
      ref={rootRef as any}
      className="tw-mt-3 tw-grid tw-gap-2 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-3"
      aria-label={t('antiHotlinkRulesLabel')}
      onBlurCapture={(e) => {
        const root = rootRef.current;
        if (!root) return;
        const related = (e as any)?.relatedTarget as Node | null;
        if (related && root.contains(related)) return;
        onApplyRules();
      }}
    >
      <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
        {t('antiHotlinkRulesHint')}
      </div>

      {rows.length ? (
        <div className="tw-grid tw-gap-2">
          {rows.map((row, index) => {
            const domainError = String(rowErrors[index]?.domain || '');
            const refererError = String(rowErrors[index]?.referer || '');
            const hasError = !!domainError || !!refererError;
            return (
              <div
                key={index}
                className={`tw-grid tw-gap-1.5 tw-rounded-xl tw-border tw-bg-[var(--bg-card)] tw-p-2 ${
                  hasError ? 'tw-border-red-400/70' : 'tw-border-[var(--border)]'
                }`}
              >
                <label className="tw-grid tw-gap-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                  <span>{t('antiHotlinkDomainLabel')}</span>
                  <input
                    value={String(row?.domain || '')}
                    disabled={busy}
                    onChange={(e) => onChangeRule(index, { domain: e.target.value })}
                    placeholder={t('antiHotlinkDomainPlaceholder')}
                    aria-label={`${t('antiHotlinkDomainLabel')} ${index + 1}`}
                    className={textInputClassName}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </label>
                {domainError ? <div className="tw-text-xs tw-font-semibold tw-text-red-500">{domainError}</div> : null}

                <label className="tw-grid tw-gap-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                  <span>{t('antiHotlinkRefererLabel')}</span>
                  <input
                    value={String(row?.referer || '')}
                    disabled={busy}
                    onChange={(e) => onChangeRule(index, { referer: e.target.value })}
                    placeholder={t('antiHotlinkRefererPlaceholder')}
                    aria-label={`${t('antiHotlinkRefererLabel')} ${index + 1}`}
                    className={textInputClassName}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </label>
                {refererError ? (
                  <div className="tw-text-xs tw-font-semibold tw-text-red-500">{refererError}</div>
                ) : null}

                <div className="tw-flex tw-justify-end">
                  <button
                    type="button"
                    className={dangerButtonClassName}
                    disabled={busy}
                    onClick={() => onRemoveRule(index)}
                    aria-label={`${t('antiHotlinkDeleteRule')} ${index + 1}`}
                  >
                    {t('antiHotlinkDeleteRule')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('antiHotlinkNoRules')}
        </div>
      )}

      <div className="tw-flex tw-flex-wrap tw-gap-2">
        <button type="button" className={buttonClassName} disabled={busy} onClick={onAddRule}>
          {t('antiHotlinkAddRule')}
        </button>
        <button type="button" className={buttonClassName} disabled={busy} onClick={onApplyRules}>
          {t('antiHotlinkApply')}
        </button>
        <button type="button" className={buttonClassName} disabled={busy} onClick={onResetRules}>
          {t('reset')}
        </button>
      </div>
    </section>
  );
}
