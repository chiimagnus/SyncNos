import { getCurrentLocale, t, type Locale } from '@i18n';

export type SettingsDocsPath =
  | 'capture-ai-chats'
  | 'dollar-mention'
  | 'cli'
  | 'sync/notion'
  | 'sync/feishu'
  | 'sync/obsidian'
  | 'sync/github';

export function buildSettingsDocsUrl(path: SettingsDocsPath, locale: Locale): string {
  const prefix =
    locale === 'zh' ? 'https://chiimagnus.github.io/SyncNos/docs' : 'https://chiimagnus.github.io/SyncNos/docs/en';
  return `${prefix}/${path}/`;
}

export function SettingsDocsLink(props: { path: SettingsDocsPath }) {
  const href = buildSettingsDocsUrl(props.path, getCurrentLocale());
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="tw-inline-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs tw-font-bold tw-text-[var(--accent)] hover:tw-underline focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]"
    >
      <span>{t('settingsDocsLink')}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}
