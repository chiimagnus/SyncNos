import { useMemo, useRef } from 'react';

import { t } from '@i18n';
import type { ChatWithAiPlatform } from '@services/integrations/chatwith/chatwith-settings';
import {
  buttonClassName,
  cardClassName,
  checkboxClassName,
  dangerButtonClassName,
  textInputClassName,
} from '@ui/settings/ui';
import { SettingsFormRow } from '@ui/settings/sections/SettingsFormRow';

const textareaClassName =
  'tw-min-h-[140px] tw-w-full tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2.5 tw-py-2 tw-text-sm tw-text-[var(--text-primary)] focus-visible:tw-border-[var(--focus-ring)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]';

function makePlatformId(): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `custom-${Date.now()}-${rand}`;
}

export function ChatWithAiSection(props: {
  busy: boolean;
  promptTemplate: string;
  onChangePromptTemplate: (v: string) => void;
  maxChars: string;
  onChangeMaxChars: (v: string) => void;
  platforms: ChatWithAiPlatform[];
  onChangePlatforms: (next: ChatWithAiPlatform[]) => void;
  onSave: () => void;
  onResetPlatforms: () => void;
}) {
  const {
    busy,
    promptTemplate,
    onChangePromptTemplate,
    maxChars,
    onChangeMaxChars,
    platforms,
    onChangePlatforms,
    onSave,
    onResetPlatforms,
  } = props;

  const rows = useMemo(() => (Array.isArray(platforms) ? platforms : []), [platforms]);
  const rootRef = useRef<HTMLElement | null>(null);

  const updatePlatform = (id: string, patch: Partial<ChatWithAiPlatform>) => {
    const next = rows.map((p) => {
      if (!p || p.id !== id) return p;
      return { ...p, ...patch, id: p.id };
    });
    onChangePlatforms(next);
  };

  const removePlatform = (id: string) => {
    const next = rows.filter((p) => p && p.id !== id);
    onChangePlatforms(next);
  };

  const addPlatform = () => {
    const next = rows.concat([
      { id: makePlatformId(), name: t('chatWithPlatformNamePlaceholder'), url: 'https://', enabled: true },
    ]);
    onChangePlatforms(next);
  };

  return (
    <section
      ref={rootRef as any}
      className={cardClassName}
      aria-label={t('chatWithSectionTitle')}
      onBlurCapture={(e) => {
        const root = rootRef.current;
        if (!root) return;
        const related = (e as any)?.relatedTarget as Node | null;
        if (related && root.contains(related)) return;
        onSave();
      }}
    >
      <div className="tw-flex tw-items-center tw-gap-2">
        <h2 className="tw-m-0 tw-min-w-0 tw-flex-1 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('chatWithSectionTitle')}
        </h2>
      </div>
      <div className="tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
        {t('chatWithSectionSubtitle')}
      </div>

      <div className="tw-mt-3 tw-grid tw-gap-2">
        <SettingsFormRow label={t('chatWithPromptTemplateLabel')} align="start">
          <div className="tw-grid tw-gap-2">
            <textarea
              id="chatWithPromptTemplate"
              className={textareaClassName}
              disabled={busy}
              value={promptTemplate}
              onChange={(e) => onChangePromptTemplate(e.target.value)}
              aria-label={t('chatWithPromptTemplateAria')}
            />
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
              {t('chatWithPromptTemplateHint')}
            </div>
          </div>
        </SettingsFormRow>

        <SettingsFormRow label={t('chatWithMaxCharsLabel')} align="start">
          <div className="tw-flex tw-items-center tw-gap-2">
            <input
              id="chatWithMaxChars"
              value={maxChars}
              onChange={(e) => onChangeMaxChars(e.target.value)}
              disabled={busy}
              type="number"
              inputMode="numeric"
              min={500}
              step={500}
              placeholder="28000"
              aria-label={t('chatWithMaxCharsAria')}
              className={`${textInputClassName} tw-w-[140px]`}
            />
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
              {t('chatWithMaxCharsHint')}
            </div>
          </div>
        </SettingsFormRow>

        <SettingsFormRow label={t('chatWithPlatformsLabel')} align="start">
          <div className="tw-grid tw-gap-2">
            {rows.length ? (
              <div className="tw-grid tw-gap-2">
                {rows.map((p) => (
                  <div key={p.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                    <label className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={!!p.enabled}
                        disabled={busy}
                        onChange={(e) => updatePlatform(p.id, { enabled: !!e.target.checked })}
                        className={checkboxClassName}
                      />
                      {t('chatWithPlatformsEnabled')}
                    </label>
                    <input
                      value={String(p.name || '')}
                      disabled={busy}
                      onChange={(e) => updatePlatform(p.id, { name: e.target.value })}
                      aria-label={`${t('chatWithPlatformNameAriaPrefix')} ${p.id}`}
                      className={`${textInputClassName} tw-w-[180px]`}
                      placeholder={t('chatWithPlatformNamePlaceholder')}
                    />
                    <input
                      value={String(p.url || '')}
                      disabled={busy}
                      onChange={(e) => updatePlatform(p.id, { url: e.target.value })}
                      aria-label={`${t('chatWithPlatformUrlAriaPrefix')} ${p.id}`}
                      className={`${textInputClassName} tw-min-w-[240px] tw-flex-1`}
                      placeholder={t('chatWithPlatformUrlPlaceholder')}
                    />
                    <button
                      type="button"
                      className={dangerButtonClassName}
                      disabled={busy}
                      onClick={() => removePlatform(p.id)}
                      aria-label={`${t('chatWithDeletePlatformAriaPrefix')} ${p.id}`}
                    >
                      {t('chatWithDeletePlatform')}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
                {t('chatWithNoPlatforms')}
              </div>
            )}

            <div className="tw-flex tw-items-center tw-gap-2">
              <button type="button" className={buttonClassName} disabled={busy} onClick={addPlatform}>
                {t('chatWithAddPlatform')}
              </button>
              <button
                type="button"
                className={buttonClassName}
                disabled={busy}
                onClick={onResetPlatforms}
                title={t('chatWithResetDefaultsTitle')}
              >
                {t('chatWithResetButton')}
              </button>
            </div>
          </div>
        </SettingsFormRow>
      </div>
    </section>
  );
}
