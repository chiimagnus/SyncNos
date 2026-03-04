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
    <div className="viewScroll" aria-label="About content">
      <section className="toolbar aboutHero" aria-label="About SyncNos WebClipper">
        <img className="aboutLogo" src={getURL('icons/icon-48.png' as any)} alt="" />
        <div className="aboutInfo">
          <div className="aboutName">SyncNos WebClipper</div>
          <div className="sub" id="aboutVersion">
            {version ? `Version ${version}` : 'Version'}
          </div>
        </div>
        <div className="aboutLinks" aria-label="Links">
          <button id="btnAboutMacApp" className="btn" type="button" onClick={() => openUrl('https://apps.apple.com/app/syncnos/id6755133888').catch(() => {})}>
            Mac App
          </button>
          <button id="btnAboutSource" className="btn" type="button" onClick={() => openUrl('https://github.com/chiimagnus/SyncNos').catch(() => {})}>
            Source Code
          </button>
          <button id="btnAboutChangelog" className="btn" type="button" onClick={() => openUrl('https://chiimagnus.notion.site/syncnos-changelog').catch(() => {})}>
            Changelog
          </button>
        </div>
      </section>

      <section className="toolbar" aria-label="Author">
        <img className="aboutAvatar" src={getURL('icons/author-avatar.png' as any)} alt="Chii Magnus avatar" />
        <div className="aboutAuthor">
          <div className="aboutAuthorName">𝓒𝓱𝓲𝓲 𝓜𝓪𝓰𝓷𝓾𝓼</div>
          <div className="sub">Time Machine Creator~</div>
        </div>
        <div className="spacer" />
        <button
          id="btnAboutMail"
          className="btn"
          type="button"
          onClick={() => openUrl('mailto:chii_magnus@outlook.com?subject=%5BSyncNos%20WebClipper%5D%20Feedback').catch(() => {})}
        >
          Mail
        </button>
        <button id="btnAboutGitHub" className="btn" type="button" onClick={() => openUrl('https://github.com/chiimagnus').catch(() => {})}>
          GitHub
        </button>
      </section>

      <section className="toolbar aboutDonate" aria-label="Donate QR code">
        <img className="aboutDonateImage" src={getURL('icons/buymeacoffee1.jpg' as any)} alt="Chii Magnus donate QR code" />
      </section>
    </div>
  );
}
