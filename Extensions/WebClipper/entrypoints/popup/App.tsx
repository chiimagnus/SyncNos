import '../../src/ui/styles/tailwind.css';
import '../../src/ui/styles/tokens.css';
import '../../src/ui/styles/flash-ok.css';
import '../../src/ui/styles/popup.css';

import { useEffect, useMemo, useRef } from 'react';

import legacyPopupHtml from '../../src/ui/popup/popup.html?raw';
import { initLegacyPopupScripts } from './legacy-init';

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const legacyBodyHtml = useMemo(() => {
    try {
      const doc = new DOMParser().parseFromString(legacyPopupHtml, 'text/html');
      doc.querySelectorAll('script').forEach((el) => el.remove());

      doc.querySelectorAll('img[src^="../../../icons/"]').forEach((img) => {
        const src = img.getAttribute('src') || '';
        img.setAttribute('src', src.replace('../../../icons/', 'icons/'));
      });

      return doc.body?.innerHTML || '';
    } catch (_e) {
      return '';
    }
  }, []);

  useEffect(() => {
    const root = mountRef.current;
    if (!root) return;

    try {
      const headerTitle = root.querySelector('.header .title');
      if (headerTitle && !root.querySelector('#wxtOpenAppBtn')) {
        const openAppBtn = document.createElement('button');
        openAppBtn.id = 'wxtOpenAppBtn';
        openAppBtn.type = 'button';
        openAppBtn.textContent = 'Open App';
        openAppBtn.className =
          'tw-ml-2 tw-h-[22px] tw-px-2 tw-rounded-md tw-border tw-border-[#f4b89e] tw-bg-white/50 hover:tw-bg-white/70 tw-text-[11px] tw-leading-none tw-font-semibold tw-text-[#b85e3a]';
        openAppBtn.addEventListener('click', async () => {
          try {
            const url = browser.runtime.getURL('/app.html#/');
            await browser.tabs.create({ url });
            window.close();
          } catch (_e) {
            // ignore
          }
        });
        headerTitle.appendChild(openAppBtn);
      }

      root.querySelectorAll('img[src^="icons/"]').forEach((img) => {
        const src = img.getAttribute('src') || '';
        try {
          img.setAttribute('src', browser.runtime.getURL(src as any));
        } catch (_e) {
          // ignore
        }
      });
    } catch (_e) {
      // ignore
    }

    initLegacyPopupScripts().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      try {
        alert((e && (e as any).message) || 'Popup init failed.');
      } catch (_err) {
        // ignore
      }
    });
  }, []);

  return <div ref={mountRef} dangerouslySetInnerHTML={{ __html: legacyBodyHtml }} />;
}
