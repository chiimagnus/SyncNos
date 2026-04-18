import { t } from '@i18n';
import { cardClassName } from '@ui/settings/ui';

function Mono(props: { children: string }) {
  return <span className="tw-font-mono tw-text-[0.92em]">{props.children}</span>;
}

export function AiChatsSection() {
  return (
    <div className="tw-grid tw-gap-4">
      <section className={cardClassName} aria-label={t('aiChatsSectionHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('aiChatsSectionHeading')}
        </h2>
        <div className="tw-mt-2.5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('aiChatsSectionIntro')}
        </div>
      </section>

      <section className={cardClassName} aria-label={t('aiChatsSectionSupportedHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('aiChatsSectionSupportedHeading')}
        </h2>
        <ul className="tw-mt-2.5 tw-list-disc tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>
            {t('aiChatsSectionSupportedListPrefix')}{' '}
            <Mono>ChatGPT</Mono> / <Mono>Claude</Mono> / <Mono>Gemini</Mono> / <Mono>AI Studio</Mono> /{' '}
            <Mono>DeepSeek</Mono> / <Mono>Kimi</Mono> / <Mono>豆包</Mono> / <Mono>元宝</Mono> / <Mono>Poe</Mono> /{' '}
            <Mono>Notion AI</Mono> / <Mono>Z.ai</Mono>
            {t('aiChatsSectionSupportedListSuffix')}
          </li>
          <li>{t('aiChatsSectionSupportedNote')}</li>
        </ul>
      </section>

      <section className={cardClassName} aria-label={t('aiChatsSectionHowToHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('aiChatsSectionHowToHeading')}
        </h2>
        <ol className="tw-mt-2.5 tw-list-decimal tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>{t('aiChatsSectionHowToStep1')}</li>
          <li>
            {t('aiChatsSectionHowToStep2Prefix')} <Mono>{t('fetchAiChat')}</Mono>
            {t('aiChatsSectionHowToStep2Suffix')}
          </li>
          <li>
            {t('aiChatsSectionHowToStep3Prefix')} <Mono>{t('contextMenuSaveCurrentAiChat')}</Mono>
            {t('aiChatsSectionHowToStep3Suffix')}
          </li>
          <li>{t('aiChatsSectionHowToStep4')}</li>
        </ol>
      </section>

      <section className={cardClassName} aria-label={t('aiChatsSectionTroubleshootingHeading')}>
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('aiChatsSectionTroubleshootingHeading')}
        </h2>
        <ul className="tw-mt-2.5 tw-list-disc tw-pl-5 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          <li>{t('aiChatsSectionTroubleshootingNoVisibleConversation')}</li>
          <li>
            {t('aiChatsSectionTroubleshootingAutoSavePrefix')} <Mono>{t('aiChatAutoSaveLabel')}</Mono>
            {t('aiChatsSectionTroubleshootingAutoSaveSuffix')}
          </li>
        </ul>
      </section>
    </div>
  );
}

