export const DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER = '.';

export function normalizeAttachmentFolder(input: unknown): string {
  if (input != null && typeof input !== 'string') throw new Error('Obsidian attachment folder must be a string.');
  const raw = String(input ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!raw || raw === '.') return DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER;
  if (raw.startsWith('/')) throw new Error('Obsidian attachment folder must be relative to the note.');

  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length && segments[segments.length - 1] !== '..') segments.pop();
      else segments.push('..');
      continue;
    }
    if (/[<>:"|?*\p{Cc}]/u.test(segment)) throw new Error('Obsidian attachment folder contains invalid characters.');
    segments.push(segment);
  }
  return segments.join('/') || DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER;
}

export function resolveAttachmentTarget(noteFilePath: string, folder: string, attachmentName: string) {
  const noteDirectory = String(noteFilePath ?? '')
    .trim()
    .split('/')
    .slice(0, -1)
    .filter(Boolean);
  const relativeFolder = normalizeAttachmentFolder(folder);
  const targetDirectory = [...noteDirectory];
  for (const segment of relativeFolder.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (!targetDirectory.length) throw new Error('Obsidian attachment folder escapes the vault.');
      targetDirectory.pop();
    } else {
      targetDirectory.push(segment);
    }
  }
  const relativePath = relativeFolder === '.' ? attachmentName : `${relativeFolder}/${attachmentName}`;
  return {
    filePath: [...targetDirectory, attachmentName].join('/'),
    markdownTarget:
      relativeFolder === '.'
        ? attachmentName
        : relativePath
            .split('/')
            .map((segment) =>
              segment === '..'
                ? '..'
                : encodeURIComponent(segment).replace(
                    /[!'()*]/g,
                    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
                  ),
            )
            .join('/'),
  };
}
