import { useMemo } from 'react';

import type { ChatWithAiPlatform } from '../../../integrations/chat-with-settings';
import { buttonClassName, cardClassName, textInputClassName } from '../ui';
import { SettingsFormRow } from './SettingsFormRow';

const textareaClassName =
  'tw-min-h-[140px] tw-w-full tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-py-2 tw-text-sm tw-text-[var(--text)]';

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
  onReset: () => void;
}) {
  const { busy, promptTemplate, onChangePromptTemplate, maxChars, onChangeMaxChars, platforms, onChangePlatforms, onSave, onReset } = props;

  const rows = useMemo(() => (Array.isArray(platforms) ? platforms : []), [platforms]);

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
    const next = rows.concat([{ id: makePlatformId(), name: 'New Platform', url: 'https://', enabled: true }]);
    onChangePlatforms(next);
  };

  return (
    <section className={cardClassName} aria-label="Chat with AI">
      <div className="tw-flex tw-items-center tw-gap-2">
        <h2 className="tw-m-0 tw-min-w-0 tw-flex-1 tw-text-base tw-font-extrabold tw-text-[var(--text)]">
          Chat with AI
        </h2>
        <button className={buttonClassName} onClick={onSave} disabled={busy} type="button">
          Save
        </button>
        <button className={buttonClassName} onClick={onReset} disabled={busy} type="button" title="Reset to defaults">
          Reset
        </button>
      </div>

      <div className="tw-mt-3 tw-grid tw-gap-2">
        <SettingsFormRow label="Prompt template" align="start">
          <div className="tw-grid tw-gap-2">
            <textarea
              id="chatWithPromptTemplate"
              className={textareaClassName}
              disabled={busy}
              value={promptTemplate}
              onChange={(e) => onChangePromptTemplate(e.target.value)}
              aria-label="Prompt template"
            />
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">
              Variables: <span className="tw-font-mono">article_content</span>, <span className="tw-font-mono">article_title</span>, <span className="tw-font-mono">article_url</span>, <span className="tw-font-mono">conversation_markdown</span>. Prefer <span className="tw-font-mono">{'{{article_content}}'}</span> style placeholders.
            </div>
          </div>
        </SettingsFormRow>

        <SettingsFormRow label="Max chars" align="start">
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
              aria-label="Max chars"
              className={`${textInputClassName} tw-w-[140px]`}
            />
            <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">
              Long content will be truncated before copying.
            </div>
          </div>
        </SettingsFormRow>

        <SettingsFormRow label="Platforms" align="start">
          <div className="tw-grid tw-gap-2">
            {rows.length ? (
              <div className="tw-grid tw-gap-2">
                {rows.map((p) => (
                  <div key={p.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                    <label className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--muted)]">
                      <input
                        type="checkbox"
                        checked={!!p.enabled}
                        disabled={busy}
                        onChange={(e) => updatePlatform(p.id, { enabled: !!e.target.checked })}
                        className="tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]"
                      />
                      Enabled
                    </label>
                    <input
                      value={String(p.name || '')}
                      disabled={busy}
                      onChange={(e) => updatePlatform(p.id, { name: e.target.value })}
                      aria-label={`Platform name ${p.id}`}
                      className={`${textInputClassName} tw-w-[180px]`}
                      placeholder="ChatGPT"
                    />
                    <input
                      value={String(p.url || '')}
                      disabled={busy}
                      onChange={(e) => updatePlatform(p.id, { url: e.target.value })}
                      aria-label={`Platform url ${p.id}`}
                      className={`${textInputClassName} tw-min-w-[240px] tw-flex-1`}
                      placeholder="https://chatgpt.com/"
                    />
                    <button
                      type="button"
                      className={buttonClassName}
                      disabled={busy}
                      onClick={() => removePlatform(p.id)}
                      aria-label={`Delete platform ${p.id}`}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">No platforms configured.</div>
            )}

            <div className="tw-flex tw-items-center tw-gap-2">
              <button type="button" className={buttonClassName} disabled={busy} onClick={addPlatform}>
                Add platform
              </button>
            </div>
          </div>
        </SettingsFormRow>
      </div>
    </section>
  );
}
