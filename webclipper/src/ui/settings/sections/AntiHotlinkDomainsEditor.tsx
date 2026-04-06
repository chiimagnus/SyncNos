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
      className="tw-mt-3 tw-grid tw-gap-3 tw-pl-4 tw-border-l-2 tw-border-[var(--border)]"
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
        <div className="tw-grid tw-gap-3">
          {rows.map((row, index) => {
            const domainError = String(rowErrors[index]?.domain || '');
            const refererError = String(rowErrors[index]?.referer || '');
            const hasError = !!domainError || !!refererError;
            return (
              <div
                key={index}
                className={`tw-grid tw-gap-2 tw-border-b tw-pb-3 last:tw-border-b-0 last:tw-pb-0 ${
                  hasError ? 'tw-border-red-400/70' : 'tw-border-[var(--border)]'
                }`}
              >
                <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
                  <label className="tw-flex tw-min-w-[260px] tw-flex-[1.1] tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                    <span className="tw-shrink-0 tw-w-12">{t('antiHotlinkDomainLabel')}</span>
                    <input
                      value={String(row?.domain || '')}
                      disabled={busy}
                      onChange={(e) => onChangeRule(index, { domain: e.target.value })}
                      placeholder={t('antiHotlinkDomainPlaceholder')}
                      aria-label={`${t('antiHotlinkDomainLabel')} ${index + 1}`}
                      className={`${textInputClassName} tw-min-w-0 tw-flex-1`}
                      spellCheck={false}
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </label>

                  <label className="tw-flex tw-min-w-[340px] tw-flex-[1.6] tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                    <span className="tw-shrink-0 tw-w-16">{t('antiHotlinkRefererLabel')}</span>
                    <input
                      value={String(row?.referer || '')}
                      disabled={busy}
                      onChange={(e) => onChangeRule(index, { referer: e.target.value })}
                      placeholder={t('antiHotlinkRefererPlaceholder')}
                      aria-label={`${t('antiHotlinkRefererLabel')} ${index + 1}`}
                      className={`${textInputClassName} tw-min-w-0 tw-flex-1`}
                      spellCheck={false}
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </label>

                  <button
                    type="button"
                    className={`${dangerButtonClassName} tw-self-stretch`}
                    disabled={busy}
                    onClick={() => onRemoveRule(index)}
                    aria-label={`${t('antiHotlinkDeleteRule')} ${index + 1}`}
                  >
                    {t('antiHotlinkDeleteRule')}
                  </button>
                </div>

                <div className="tw-grid tw-gap-1 tw-pl-14">
                  {domainError ? <div className="tw-text-xs tw-font-semibold tw-text-red-500">{domainError}</div> : null}
                  {refererError ? <div className="tw-text-xs tw-font-semibold tw-text-red-500">{refererError}</div> : null}
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
