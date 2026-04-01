export async function writeTextToClipboard(value: string): Promise<boolean> {
  const text = String(value ?? '');
  if (!text) return false;

  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_e) {
    // ignore and fall back
  }

  try {
    // Best-effort fallback for older runtimes.
    const doc = globalThis.document;
    if (!doc) return false;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    doc.body?.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    ta.remove();
    return Boolean(ok);
  } catch (_e) {
    return false;
  }
}
