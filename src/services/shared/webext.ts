export { openOrFocusExtensionAppTab } from '@platform/webext/extension-app';
export { tabsCreate } from '@platform/webext/tabs';

export function downloadBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
