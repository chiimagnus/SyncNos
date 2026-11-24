import { t, type LocalePreference } from '@i18n';
import { SUPPORTED_AI_CHAT_SITES } from '@collectors/ai-chat-sites';
import { SettingsGroup } from './SettingsGroup';
import { SettingsFormRow, SettingsSwitchRow } from './SettingsFormRow';
import { buttonClassName, settingsControlWidthClassName, settingsTextInputClassName } from '@ui/settings/ui';
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
  userName: string;
  onChangeUserName: (next: string) => void;
  onSaveUserName: () => void;
  displayMode: InpageDisplayMode;
  onChangeDisplayMode: (next: InpageDisplayMode) => void;
  localePreference: LocalePreference;
  onChangeLocalePreference: (next: LocalePreference) => void;
  aiChatAutoSaveEnabled: boolean;
  onToggleAiChatAutoSaveEnabled: (next: boolean) => void;
  chatgptApiCaptureEnabled: boolean;
  onToggleChatgptApiCaptureEnabled: (next: boolean) => void;
  aiChatIncludeThinkingEnabled: boolean;
  onToggleAiChatIncludeThinkingEnabled: (next: boolean) => void;
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
    userName,
    onChangeUserName,
    onSaveUserName,
    displayMode,
    onChangeDisplayMode,
    localePreference,
    onChangeLocalePreference,
    aiChatAutoSaveEnabled,
    onToggleAiChatAutoSaveEnabled,
    chatgptApiCaptureEnabled,
    onToggleChatgptApiCaptureEnabled,
    aiChatIncludeThinkingEnabled,
    onToggleAiChatIncludeThinkingEnabled,
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

  const dollarMentionSites = SUPPORTED_AI_CHAT_SITES.filter((site) => site?.features?.dollarMention === true).map(
    (site) => site.name,
  );
  const dollarMentionSitesLabel = dollarMentionSites.join(' / ');

  return (
    <>
      <SettingsGroup title={t('settingsPersonalInterface')}>
        <SettingsFormRow label={t('aboutYouUserNameSectionTitle')} info={t('aboutYouUserNameHint')}>
          <input
            className={settingsTextInputClassName}
            aria-label={t('aboutYouUserNameSectionTitle')}
            value={userName}
            onChange={(event) => onChangeUserName(event.target.value)}
            onBlur={onSaveUserName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSaveUserName();
              }
            }}
            placeholder={t('settingsUsernamePlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </SettingsFormRow>
        <SettingsFormRow label={t('languageLabel')}>
          <SelectMenu<LocalePreference>
            value={localePreference}
            onChange={onChangeLocalePreference}
            disabled={busy}
            ariaLabel={t('languageLabel')}
            minWidth={160}
            className={settingsControlWidthClassName}
            buttonId="interface-locale"
            buttonClassName={[buttonTintClassName(), 'tw-w-full'].join(' ')}
            options={[
              { value: 'system', label: t('localeSystem') },
              { value: 'en', label: t('localeEnglish') },
              { value: 'zh', label: t('localeChinese') },
            ]}
          />
        </SettingsFormRow>
        <SettingsFormRow label={t('inpageButtonHeading')}>
          <SelectMenu<InpageDisplayMode>
            value={displayMode}
            onChange={onChangeDisplayMode}
            disabled={busy}
            ariaLabel={t('inpageDisplayModeLabel')}
            minWidth={160}
            className={settingsControlWidthClassName}
            buttonClassName={[buttonTintClassName(), 'tw-w-full'].join(' ')}
            options={[
              { value: 'supported', label: t('inpageDisplayModeSupported') },
              { value: 'all', label: t('inpageDisplayModeAll') },
              { value: 'off', label: t('inpageDisplayModeOff') },
            ]}
          />
        </SettingsFormRow>
      </SettingsGroup>
      <SettingsGroup title={t('settingsAiChats')}>
        <SettingsSwitchRow
          label={t('aiChatAutoSaveLabel')}
          checked={aiChatAutoSaveEnabled}
          disabled={busy}
          onChange={onToggleAiChatAutoSaveEnabled}
          description={t('settingsAutoSaveLimit')}
          info={t('settingsAutoSaveInfo')}
          docsPath="capture-ai-chats"
        />
        <SettingsSwitchRow
          label={t('aiChatThinkingIncludeLabel')}
          checked={aiChatIncludeThinkingEnabled}
          disabled={busy}
          onChange={onToggleAiChatIncludeThinkingEnabled}
          info={t('aiChatThinkingIncludeHint')}
        />
        <SettingsSwitchRow
          label={t('aiChatDollarMentionLabel')}
          checked={aiChatDollarMentionEnabled}
          disabled={busy}
          onChange={onToggleAiChatDollarMentionEnabled}
          info={[t('settingsMentionInfo'), dollarMentionSitesLabel].filter(Boolean).join(' ')}
          docsPath="dollar-mention"
        />
        <SettingsSwitchRow
          label={t('chatgptApiCaptureAdvancedLabel')}
          checked={chatgptApiCaptureEnabled}
          disabled={busy}
          onChange={onToggleChatgptApiCaptureEnabled}
          description={t('settingsManualCaptureOnly')}
          info={t('chatgptApiCaptureAdvancedHint')}
          docsPath="capture-ai-chats"
        />
      </SettingsGroup>
      <SettingsGroup title={t('settingsImageCaching')}>
        <SettingsSwitchRow
          label={t('aiChatCacheImagesLabel')}
          checked={aiChatCacheImagesEnabled}
          disabled={busy}
          onChange={onToggleAiChatCacheImagesEnabled}
          info={t('settingsImageCacheInfo')}
          badge={t('betaTag')}
        />
        <SettingsSwitchRow
          label={t('webArticleCacheImagesLabel')}
          checked={webArticleCacheImagesEnabled}
          disabled={busy}
          onChange={onToggleWebArticleCacheImagesEnabled}
          badge={t('betaTag')}
        />
        <SettingsFormRow label={t('antiHotlinkRulesLabel')} info={t('antiHotlinkRulesHint')}>
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
        </SettingsFormRow>
        {antiHotlinkAdvancedOpen ? (
          <div className="settings-expanded">
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
          </div>
        ) : null}
      </SettingsGroup>
    </>
  );
}
