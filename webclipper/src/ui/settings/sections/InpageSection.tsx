import { t } from '@i18n';
import { SUPPORTED_AI_CHAT_SITES } from '@collectors/ai-chat-sites';
import { buttonClassName, cardClassName, checkboxClassName } from '@ui/settings/ui';
import { buttonTintClassName } from '@ui/shared/button-styles';
import { SelectMenu } from '@ui/shared/SelectMenu';
import type { MarkdownReadingProfileId } from '@services/protocols/markdown-reading-profiles';
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
  markdownReadingProfile: MarkdownReadingProfileId;
  onChangeMarkdownReadingProfile: (next: MarkdownReadingProfileId) => void;
  aiChatAutoSaveEnabled: boolean;
  onToggleAiChatAutoSaveEnabled: (next: boolean) => void;
  aiChatCacheImagesEnabled: boolean;
  onToggleAiChatCacheImagesEnabled: (next: boolean) => void;
  webArticleCacheImagesEnabled: boolean;
  onToggleWebArticleCacheImagesEnabled: (next: boolean) => void;
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
    markdownReadingProfile,
    onChangeMarkdownReadingProfile,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    aiChatCacheImagesEnabled,
    onToggleAiChatCacheImagesEnabled,
    webArticleCacheImagesEnabled,
    onToggleWebArticleCacheImagesEnabled,
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

  const profileSummaryKey: Record<MarkdownReadingProfileId, Parameters<typeof t>[0]> = {
    medium: 'markdownReadingProfileMediumDesc',
    notion: 'markdownReadingProfileNotionDesc',
    book: 'markdownReadingProfileBookDesc',
  };

  const dollarMentionSites = SUPPORTED_AI_CHAT_SITES.filter((site) => site?.features?.dollarMention === true).map(
    (site) => site.name,
  );
  const dollarMentionSitesLabel = dollarMentionSites.join(' / ');

  return (
    <div className="tw-grid tw-gap-4">
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

      <section className={cardClassName} aria-label={t('readingHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('readingHeading')}</h2>
        <div className="tw-mt-2.5 tw-grid tw-gap-1.5">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <label className="tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('markdownReadingProfileLabel')}
            </label>
            <SelectMenu<MarkdownReadingProfileId>
              value={markdownReadingProfile}
              onChange={onChangeMarkdownReadingProfile}
              disabled={busy}
              ariaLabel={t('markdownReadingProfileLabel')}
              minWidth={180}
              buttonClassName={[buttonTintClassName(), 'tw-min-w-[180px]'].join(' ')}
              options={[
                { value: 'medium', label: t('markdownReadingProfileMediumLabel') },
                { value: 'notion', label: t('markdownReadingProfileNotionLabel') },
                { value: 'book', label: t('markdownReadingProfileBookLabel') },
              ]}
            />
          </div>
          <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
            {t('markdownReadingProfileHint')}
          </div>
          <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-80">
            {t(profileSummaryKey[markdownReadingProfile])}
          </div>
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
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('aiChatCacheImagesHint')}
        </div>

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
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('webArticleCacheImagesHint')}
        </div>

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

        <div className="tw-mt-2.5 tw-grid tw-gap-2">
          {SUPPORTED_AI_CHAT_SITES.map((site) => {
            const hosts = Array.isArray(site.hosts) ? site.hosts.filter(Boolean) : [];
            const hostLabel = hosts.length ? hosts.join(' / ') : site.id;
            return (
              <div
                key={site.id}
                className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-3 tw-py-2"
              >
                <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">{site.name}</div>
                <div className="tw-truncate tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                  {hostLabel}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
