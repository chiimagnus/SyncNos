import { getManifest, getURL } from '../../../src/platform/runtime/runtime';
import { tabsCreate } from '../../../src/platform/webext/tabs';

export default function AboutTab() {
  const version = (() => {
    try {
      const manifest = getManifest();
      return String(manifest?.version || '');
    } catch (_e) {
      return '';
    }
  })();

  const openUrl = async (url: string) => {
    await tabsCreate({ url });
  };

  return (
    <div className="route-scroll tw-h-full tw-min-h-0 tw-overflow-auto tw-overflow-x-hidden tw-p-3" aria-label="About content">
      <section className="tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3" aria-label="About SyncNos WebClipper">
        <div className="tw-flex tw-items-center tw-gap-3">
          <img className="tw-size-10 tw-rounded-2xl tw-object-contain" src={getURL('icons/icon-48.png' as any)} alt="" draggable={false} />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-text-base tw-font-black tw-text-[var(--text)]">SyncNos WebClipper</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--muted)]" id="aboutVersion">
              {version ? `Version ${version}` : 'Version'}
            </div>
          </div>
        </div>

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2" aria-label="Links">
          <button
            id="btnAboutMacApp"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)]"
            type="button"
            onClick={() => openUrl('https://apps.apple.com/app/syncnos/id6755133888').catch(() => {})}
          >
            Mac App
          </button>
          <button
            id="btnAboutSource"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)]"
            type="button"
            onClick={() => openUrl('https://github.com/chiimagnus/SyncNos').catch(() => {})}
          >
            Source Code
          </button>
          <button
            id="btnAboutChangelog"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)]"
            type="button"
            onClick={() => openUrl('https://chiimagnus.notion.site/syncnos-changelog').catch(() => {})}
          >
            Changelog
          </button>
        </div>
      </section>

      <section className="tw-mt-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3" aria-label="Author">
        <div className="tw-flex tw-items-center tw-gap-3">
          <img className="tw-size-10 tw-rounded-2xl tw-object-cover" src={getURL('icons/author-avatar.png' as any)} alt="Chii Magnus avatar" draggable={false} />
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-text-sm tw-font-black tw-text-[var(--text)]">𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼</div>
            <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--muted)]">Time Machine Creator~</div>
          </div>
        </div>

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
          <button
            id="btnAboutMail"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)]"
            type="button"
            onClick={() =>
              openUrl('mailto:chii_magnus@outlook.com?subject=%5BSyncNos%20WebClipper%5D%20Feedback').catch(() => {})
            }
          >
            Mail
          </button>
          <button
            id="btnAboutGitHub"
            className="tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)]"
            type="button"
            onClick={() => openUrl('https://github.com/chiimagnus').catch(() => {})}
          >
            GitHub
          </button>
        </div>
      </section>

      <section className="tw-mt-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3" aria-label="Donate QR code">
        <img className="tw-w-full tw-rounded-2xl tw-object-cover" src={getURL('icons/buymeacoffee1.jpg' as any)} alt="Chii Magnus donate QR code" draggable={false} />
      </section>
    </div>
  );
}
