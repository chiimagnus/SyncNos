import { t } from '@i18n';
import { SettingsDocsLink } from '@ui/settings/SettingsDocsLink';
import { cardClassName, checkboxClassName } from '@ui/settings/ui';

function Mono(props: { children: string }) {
  return <span className="tw-font-mono tw-text-[0.92em]">{props.children}</span>;
}

export function AiChatsSection(props: {
  busy: boolean;
  chatgptApiCaptureEnabled: boolean;
  onToggleChatgptApiCaptureEnabled: (next: boolean) => void;
}) {
  const { busy, chatgptApiCaptureEnabled, onToggleChatgptApiCaptureEnabled } = props;
  return (
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('aiChatsSectionSupportedHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('aiChatsSectionSupportedHeading')}
        </h2>
        <ul className="tw-mt-2.5 tw-list-disc tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>
            {t('aiChatsSectionSupportedListPrefix')} <Mono>ChatGPT</Mono> / <Mono>Gemini</Mono> / <Mono>AI Studio</Mono>{' '}
            / <Mono>DeepSeek</Mono> / <Mono>Kimi</Mono> / <Mono>豆包</Mono> / <Mono>元宝</Mono> / <Mono>Poe</Mono> /{' '}
            <Mono>Notion AI</Mono> / <Mono>Z.ai</Mono>
            {t('aiChatsSectionSupportedListSuffix')}
          </li>
        </ul>
      </section>

      <section className={cardClassName} aria-label={t('chatgptApiCaptureAdvancedHeading')}>
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
          <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
            {t('chatgptApiCaptureAdvancedHeading')}
          </h2>
          <SettingsDocsLink path="capture-ai-chats" />
        </div>
        <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={chatgptApiCaptureEnabled}
            disabled={busy}
            onChange={(event) => onToggleChatgptApiCaptureEnabled(event.target.checked)}
            className={checkboxClassName}
            aria-label={t('chatgptApiCaptureAdvancedLabel')}
          />
          {t('chatgptApiCaptureAdvancedLabel')}
        </label>
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('chatgptApiCaptureAdvancedHint')}
        </div>
      </section>
    </div>
  );
}
