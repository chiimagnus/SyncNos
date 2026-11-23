export const DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER = '.';

export function normalizeAttachmentFolder(input: unknown): string {
  if (input != null && typeof input !== 'string') throw new Error('Obsidian attachment folder must be a string.');
  const raw = String(input ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!raw || raw === '.') return DEFAULT_OBSIDIAN_ATTACHMENT_FOLDER;
  if (raw.startsWith('/')) throw new Error('Obsidian attachment folder must be relative to the vault root.');

  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) throw new Error('Obsidian attachment folder escapes the vault.');
      segments.pop();
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
  const configuredFolder = normalizeAttachmentFolder(folder);
  const targetDirectory = configuredFolder === '.' ? noteDirectory : configuredFolder.split('/');
  let common = 0;
  while (common < noteDirectory.length && noteDirectory[common] === targetDirectory[common]) common += 1;
  const relativePath = [
    ...Array(noteDirectory.length - common).fill('..'),
    ...targetDirectory.slice(common),
    attachmentName,
  ];
  return {
    filePath: [...targetDirectory, attachmentName].join('/'),
    markdownTarget: relativePath
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
