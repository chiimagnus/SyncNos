import { describe, expect, it } from 'vitest';
import { normalizeAttachmentFolder, resolveAttachmentTarget } from '@services/sync/obsidian/obsidian-attachment-path';

describe('obsidian-attachment-path', () => {
  it.each([
    ['', '.'],
    ['.', '.'],
    ['./images', 'images'],
    ['images/nested/../photos', 'images/photos'],
    ['images/..', '.'],
    ['images\\subfolder', 'images/subfolder'],
    ['中文/图片', '中文/图片'],
    ['images//icons/', 'images/icons'],
  ])('normalizes an attachment folder %s to %s', (input, expected) => {
    expect(normalizeAttachmentFolder(input)).toBe(expected);
  });

  it.each([
    ['Chats/note.md', '.', 'picture.png', 'Chats/picture.png', 'picture.png'],
    ['Chats/note.md', '.', '中文(1).png', 'Chats/中文(1).png', '%E4%B8%AD%E6%96%87%281%29.png'],
    ['Chats/note.md', 'images', 'picture.png', 'images/picture.png', '../images/picture.png'],
    ['Notes/Deep/note.md', 'images', 'picture.png', 'images/picture.png', '../../images/picture.png'],
    ['Notes/Deep/note.md', 'Notes/Deep/images', 'picture.png', 'Notes/Deep/images/picture.png', 'images/picture.png'],
    ['Notes/Deep/note.md', 'Notes/shared', 'picture.png', 'Notes/shared/picture.png', '../shared/picture.png'],
    ['note.md', 'images', 'picture.png', 'images/picture.png', 'images/picture.png'],
    [
      'Notes/Deep/note.md',
      'Shared assets',
      '图 (1).png',
      'Shared assets/图 (1).png',
      '../../Shared%20assets/%E5%9B%BE%20%281%29.png',
    ],
  ])('resolves %s + %s inside the vault', (note, folder, image, expectedPath, expectedLink) => {
    expect(resolveAttachmentTarget(note, folder, image)).toEqual({
      filePath: expectedPath,
      markdownTarget: expectedLink,
    });
  });

  it.each([
    '/absolute',
    'C:\\images',
    '\\\\server\\images',
    'images/invalid?name',
    'images/line\nfeed',
    '../images',
    'images/../../outside',
    123,
  ])('rejects invalid attachment folder %s', (input) => {
    expect(() => normalizeAttachmentFolder(input)).toThrow();
  });

  it('rejects paths that would escape the vault before any write', () => {
    expect(() => resolveAttachmentTarget('Chats/note.md', '../../outside', 'a.png')).toThrow('escapes the vault');
    expect(() => resolveAttachmentTarget('note.md', '../outside', 'a.png')).toThrow('escapes the vault');
  });
});
