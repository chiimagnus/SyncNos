// Deprecated: inpage visibility is decided on page load by the content script
// reading `inpage_supported_only`. Users may need to refresh existing tabs.
import { storageGet } from '../platform/storage/local';

const STORAGE_KEY = 'inpage_supported_only';
function readSetting(): Promise<boolean> {
  return storageGet([STORAGE_KEY])
    .then((res) => (res as any)?.[STORAGE_KEY] === true)
    .catch(() => false);
}

async function applyVisibilitySetting({ reason }: { reason?: string } = {}) {
  const supportedOnly = await readSetting();
  return { ok: true, supportedOnly, reason: reason || 'apply' };
}

function start() {
  // no-op
}

const backgroundInpageWebVisibilityApi = {
  STORAGE_KEY,
  applyVisibilitySetting,
  start,
};

export default backgroundInpageWebVisibilityApi;
