import { t } from '../../../i18n';
import { buttonClassName, cardClassName, textInputClassName } from '../ui';
import { SettingsFormRow } from './SettingsFormRow';

export function NotionAISection(props: {
  busy: boolean;
  modelIndex: string;
  onChangeModelIndex: (v: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const { busy, modelIndex, onChangeModelIndex, onSave, onReset } = props;
  return (
    <section className={cardClassName} aria-label={t('notionAI')}>
      <div className="tw-flex tw-items-center tw-gap-2">
        <h2 className="tw-m-0 tw-min-w-0 tw-flex-1 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('notionAI')}</h2>
      </div>

      <div className="tw-mt-3 tw-grid tw-gap-2">
        <div aria-label={t('modelIndex')}>
          <SettingsFormRow label={t('modelIndex')}>
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
                aria-label={t('modelIndex')}
                className={`${textInputClassName} tw-w-[120px]`}
              />
              <button id="btnNotionAiModelSave" className={buttonClassName} onClick={onSave} disabled={busy} type="button">
                {t('save')}
              </button>
              <button
                id="btnNotionAiModelReset"
                className={buttonClassName}
                onClick={onReset}
                disabled={busy}
                type="button"
                title={t('reset')}
              >
                {t('reset')}
              </button>
            </div>
          </SettingsFormRow>
        </div>

        <div aria-label={t('note')}>
          <SettingsFormRow label={t('note')} align="start">
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('notionAiModelNote')}
            </div>
          </SettingsFormRow>
        </div>
      </div>
    </section>
  );
}
