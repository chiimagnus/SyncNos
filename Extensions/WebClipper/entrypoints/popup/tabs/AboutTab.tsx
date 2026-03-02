export default function AboutTab() {
  const version = (() => {
    try {
      return browser.runtime.getManifest().version || '';
    } catch (_e) {
      return '';
    }
  })();

  const openUrl = async (url: string) => {
    await browser.tabs.create({ url });
  };

  return (
    <section className="tw-h-full tw-min-h-0 tw-flex tw-flex-col tw-gap-3">
      <section className="tw-rounded-2xl tw-border tw-border-[rgba(217,89,38,0.14)] tw-bg-[var(--panel)] tw-p-3 tw-shadow-[var(--shadow)]">
        <div className="tw-flex tw-items-center tw-gap-3">
          <img
            className="tw-w-11 tw-h-11 tw-rounded-xl tw-bg-[var(--panel-strong)] tw-shadow-[0_0_0_2px_rgba(217,89,38,0.12)]"
            src={browser.runtime.getURL('icons/icon-48.png' as any)}
            alt=""
          />
          <div className="tw-min-w-0">
            <div className="tw-font-extrabold tw-text-[16px] tw-leading-tight">SyncNos WebClipper</div>
            <div className="tw-text-[12px] tw-text-[var(--muted)]">Version {version || '—'}</div>
          </div>
        </div>

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
          <button
            className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
            onClick={() => openUrl('https://github.com/chiimagnus/SyncNos').catch(() => {})}
            type="button"
          >
            Source Code
          </button>
          <button
            className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
            onClick={() =>
              openUrl('https://github.com/chiimagnus/SyncNos/blob/main/Extensions/WebClipper/CHANGELOG.md').catch(() => {})
            }
            type="button"
          >
            Changelog
          </button>
        </div>
      </section>

      <section className="tw-rounded-2xl tw-border tw-border-[rgba(217,89,38,0.14)] tw-bg-[var(--panel)] tw-p-3">
        <div className="tw-flex tw-items-center tw-gap-3">
          <img
            className="tw-w-10 tw-h-10 tw-rounded-xl tw-object-cover tw-bg-[var(--panel-strong)]"
            src={browser.runtime.getURL('icons/author-avatar.png' as any)}
            alt="Author avatar"
          />
          <div className="tw-min-w-0">
            <div className="tw-font-bold">𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼</div>
            <div className="tw-text-[12px] tw-text-[var(--muted)]">Time Machine Creator~</div>
          </div>
          <div className="tw-flex-1" />
          <button
            className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
            onClick={() => openUrl('mailto:chii.magnus@outlook.com').catch(() => {})}
            type="button"
          >
            Mail
          </button>
          <button
            className="tw-h-8 tw-px-3 tw-rounded-lg tw-border tw-border-[rgba(217,89,38,0.18)] tw-bg-white/55 hover:tw-bg-white/75 tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]"
            onClick={() => openUrl('https://github.com/chiimagnus').catch(() => {})}
            type="button"
          >
            GitHub
          </button>
        </div>
      </section>

      <section className="tw-rounded-2xl tw-border tw-border-[rgba(217,89,38,0.14)] tw-bg-[var(--panel)] tw-p-3 tw-flex-1 tw-min-h-0 tw-overflow-hidden">
        <div className="tw-text-[12px] tw-font-semibold tw-text-[var(--muted)]">Donate</div>
        <div className="tw-mt-2 tw-rounded-xl tw-overflow-hidden tw-border tw-border-[rgba(217,89,38,0.14)] tw-bg-white/40">
          <img
            src={browser.runtime.getURL('icons/buymeacoffee1.jpg' as any)}
            alt="Donate QR code"
            className="tw-w-full"
          />
        </div>
      </section>
    </section>
  );
}
