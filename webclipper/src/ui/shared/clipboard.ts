export async function copyTextToClipboard(value: string): Promise<void> {
  const text = String(value ?? '');
  if (!text) throw new Error('copy failed');

  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return;
    }
  } catch (_e) {
    // fall through to best-effort fallback
  }

  const doc = globalThis.document;
  if (!doc) throw new Error('copy failed');

  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', 'true');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  doc.body?.appendChild(ta);

  try {
    ta.focus();
    ta.select();
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    if (!ok) throw new Error('copy failed');
  } finally {
    try {
      ta.remove();
    } catch (_e) {
      // ignore
    }
  }
}

