import { t, type LocalePreference } from '@i18n';
import { SUPPORTED_AI_CHAT_SITES } from '@collectors/ai-chat-sites';
import { buttonClassName, cardClassName, checkboxClassName } from '@ui/settings/ui';
import { buttonTintClassName } from '@ui/shared/button-styles';
import { SelectMenu } from '@ui/shared/SelectMenu';
import {
  AntiHotlinkDomainsEditor,
  type AntiHotlinkRuleEditorError,
  type AntiHotlinkRuleEditorRow,
} from '@ui/settings/sections/AntiHotlinkDomainsEditor';

type InpageDisplayMode = 'supported' | 'all' | 'off';

export function InpageSection(props: {
  busy: boolean;
  displayMode: InpageDisplayMode;
  onChangeDisplayMode: (next: InpageDisplayMode) => void;
  localePreference: LocalePreference;
  onChangeLocalePreference: (next: LocalePreference) => void;
  aiChatAutoSaveEnabled: boolean;
  onToggleAiChatAutoSaveEnabled: (next: boolean) => void;
  aiChatCacheImagesEnabled: boolean;
  onToggleAiChatCacheImagesEnabled: (next: boolean) => void;
  webArticleCacheImagesEnabled: boolean;
  onToggleWebArticleCacheImagesEnabled: (next: boolean) => void;
  xiaohongshuCommentsCaptureEnabled: boolean;
  onToggleXiaohongshuCommentsCaptureEnabled: (next: boolean) => void;
  antiHotlinkAdvancedOpen: boolean;
  onToggleAntiHotlinkAdvancedOpen: () => void;
  antiHotlinkRules: AntiHotlinkRuleEditorRow[];
  antiHotlinkRuleErrors: AntiHotlinkRuleEditorError[];
  onChangeAntiHotlinkRule: (index: number, patch: Partial<AntiHotlinkRuleEditorRow>) => void;
  onAddAntiHotlinkRule: () => void;
  onRemoveAntiHotlinkRule: (index: number) => void;
  onApplyAntiHotlinkRules: () => void;
  onResetAntiHotlinkRules: () => void;
  aiChatDollarMentionEnabled: boolean;
  onToggleAiChatDollarMentionEnabled: (next: boolean) => void;
}) {
  const {
    busy,
    displayMode,
    onChangeDisplayMode,
    localePreference,
    onChangeLocalePreference,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,
    webArticleCacheImagesEnabled,
    onToggleWebArticleCacheImagesEnabled,
    xiaohongshuCommentsCaptureEnabled,
    onToggleXiaohongshuCommentsCaptureEnabled,
    antiHotlinkAdvancedOpen,
    onToggleAntiHotlinkAdvancedOpen,
    antiHotlinkRules,
    antiHotlinkRuleErrors,
    onChangeAntiHotlinkRule,
    onAddAntiHotlinkRule,
    onRemoveAntiHotlinkRule,
    onApplyAntiHotlinkRules,
    onResetAntiHotlinkRules,
    aiChatDollarMentionEnabled,
    onToggleAiChatDollarMentionEnabled,
  } = props;

  const dollarMentionSites = SUPPORTED_AI_CHAT_SITES.filter((site) => site?.features?.dollarMention === true).map(
    (site) => site.name,
  );
  const dollarMentionSitesLabel = dollarMentionSites.join(' / ');

  return (
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('languageHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('languageHeading')}</h2>
        <div className="tw-mt-2.5">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <span className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">{t('languageLabel')}</span>
            <SelectMenu<LocalePreference>
              value={localePreference}
              onChange={onChangeLocalePreference}
              disabled={busy}
              ariaLabel={t('languageLabel')}
              minWidth={180}
              buttonId="interface-locale"
              buttonClassName={[buttonTintClassName(), 'tw-min-w-[180px]'].join(' ')}
              options={[
                { value: 'system', label: t('localeSystem') },
                { value: 'en', label: t('localeEnglish') },
                { value: 'zh', label: t('localeChinese') },
              ]}
            />
          </div>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('inpageButtonHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('inpageButtonHeading')}
        </h2>
        <div className="tw-mt-2.5 tw-grid tw-gap-1.5">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <label className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('inpageDisplayModeLabel')}
            </label>
            <SelectMenu<InpageDisplayMode>
              value={displayMode}
              onChange={onChangeDisplayMode}
              disabled={busy}
              ariaLabel={t('inpageDisplayModeLabel')}
              minWidth={180}
              buttonClassName={[buttonTintClassName(), 'tw-min-w-[180px]'].join(' ')}
              options={[
                { value: 'supported', label: t('inpageDisplayModeSupported') },
                { value: 'all', label: t('inpageDisplayModeAll') },
                { value: 'off', label: t('inpageDisplayModeOff') },
              ]}
            />
          </div>
          <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('inpageDisplayModeHint')}
          </div>
        </div>
      </section>

      <section className={cardClassName} aria-label={t('xiaohongshuCommentsHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('xiaohongshuCommentsHeading')}
        </h2>
        <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={xiaohongshuCommentsCaptureEnabled}
            disabled={busy}
            onChange={(e) => onToggleXiaohongshuCommentsCaptureEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          {t('xiaohongshuCommentsLabel')}
        </label>
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('xiaohongshuCommentsHint')}
        </div>
      </section>

      <section className={cardClassName} aria-label={t('aiChatDollarMentionHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('aiChatDollarMentionHeading')}
        </h2>
        <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={aiChatDollarMentionEnabled}
            disabled={busy}
            onChange={(e) => onToggleAiChatDollarMentionEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          {t('aiChatDollarMentionLabel')}
        </label>
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('aiChatDollarMentionHint')}
        </div>
        {!!dollarMentionSitesLabel && (
          <div className="tw-mt-2 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-80">
            {dollarMentionSitesLabel}
          </div>
        )}
      </section>

      <section className={cardClassName} aria-label={t('aiChatAutoSaveHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('aiChatAutoSaveHeading')}
        </h2>
        <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={aiChatAutoSaveEnabled}
            disabled={busy}
            onChange={(e) => onToggleAiChatAutoSaveEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          {t('aiChatAutoSaveLabel')}
        </label>
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('aiChatAutoSaveHint')}
        </div>

        <label className="tw-mt-3 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={aiChatCacheImagesEnabled}
            disabled={busy}
            onChange={(e) => onToggleAiChatCacheImagesEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          <span className="tw-inline-flex tw-items-center tw-gap-2">
            <span>{t('aiChatCacheImagesLabel')}</span>
            <span className="tw-inline-flex tw-items-center tw-rounded-md tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-font-black tw-tracking-wide tw-text-[var(--text-secondary)]">
              {t('betaTag')}
            </span>
          </span>
        </label>
        <label className="tw-mt-3 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={webArticleCacheImagesEnabled}
            disabled={busy}
            onChange={(e) => onToggleWebArticleCacheImagesEnabled(!!e.target.checked)}
            className={checkboxClassName}
          />
          <span className="tw-inline-flex tw-items-center tw-gap-2">
            <span>{t('webArticleCacheImagesLabel')}</span>
            <span className="tw-inline-flex tw-items-center tw-rounded-md tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-1.5 tw-py-0.5 tw-text-[10px] tw-font-black tw-tracking-wide tw-text-[var(--text-secondary)]">
              {t('betaTag')}
            </span>
          </span>
        </label>
        <div className="tw-mt-3">
          <button
            type="button"
            className={buttonClassName}
            onClick={onToggleAntiHotlinkAdvancedOpen}
            disabled={busy}
            aria-expanded={antiHotlinkAdvancedOpen}
            aria-controls="anti-hotlink-domains-editor"
          >
            {antiHotlinkAdvancedOpen ? t('advancedHide') : t('advancedShow')}
          </button>
        </div>
        {antiHotlinkAdvancedOpen ? (
          <AntiHotlinkDomainsEditor
            id="anti-hotlink-domains-editor"
            busy={busy}
            rules={antiHotlinkRules}
            errors={antiHotlinkRuleErrors}
            onChangeRule={onChangeAntiHotlinkRule}
            onAddRule={onAddAntiHotlinkRule}
            onRemoveRule={onRemoveAntiHotlinkRule}
            onApplyRules={onApplyAntiHotlinkRules}
            onResetRules={onResetAntiHotlinkRules}
          />
        ) : null}

      </section>
    </div>
  );
}
