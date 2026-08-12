export const LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD = 'x'.repeat(513 * 1024);

export function createLocalDataMigrationFixture() {
  const blobBytes = Uint8Array.from({ length: 2 * 256 * 1024 + 3 }, (_, index) => index % 251);
  const base64Bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  const viewBytes = Uint8Array.from([6, 7, 8, 9]);
  const percentBytes = new TextEncoder().encode('你好😀');
  const chatConversationId = 10;
  const articleConversationId = 11;
  const rootCommentId = 50;

  return {
    assets: {
      blobBytes,
      base64Bytes,
      percentBytes,
      viewBytes,
    },
    rows: {
      articleComments: [
        {
          id: rootCommentId,
          conversationId: chatConversationId,
          canonicalUrl: 'https://example.com/article#fragment',
          authorName: 'Chii',
          quoteText: 'quote',
          commentText: 'root',
          locator: null,
          createdAt: 1,
          updatedAt: 2,
          unknownCommentField: { keep: true },
        },
        {
          id: 51,
          parentId: rootCommentId,
          conversationId: chatConversationId,
          canonicalUrl: 'https://example.com/article',
          quoteText: '',
          commentText: 'reply',
          locator: null,
          createdAt: 3,
          updatedAt: 4,
        },
      ],
      conversations: [
        {
          id: chatConversationId,
          source: 'chatgpt',
          conversationKey: 'conversation-a',
          sourceType: 'chat',
          title: '你好😀',
          unknownConversationField: { nested: true, large: LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD },
        },
        {
          id: articleConversationId,
          source: 'web',
          conversationKey: 'article:https://example.com/a',
          sourceType: 'article',
          title: 'Article',
        },
      ],
      imageCache: [
        {
          id: 40,
          conversationId: chatConversationId,
          url: 'https://example.com/blob.png',
          blob: new Blob([blobBytes], { type: 'image/png' }),
          contentType: 'image/png',
          byteSize: blobBytes.byteLength,
          unknownImageField: { keep: true },
        },
        {
          id: 41,
          conversationId: chatConversationId,
          url: 'https://example.com/base64.png',
          dataUrl: 'data:image/png;base64,AQI\nDBAU',
          contentType: 'image/png',
        },
        {
          id: 42,
          conversationId: chatConversationId,
          url: 'https://example.com/view.png',
          blob: Uint8Array.from([0, ...viewBytes, 0]).subarray(1, viewBytes.byteLength + 1),
          contentType: 'image/png',
        },
        {
          id: 43,
          conversationId: chatConversationId,
          url: 'https://example.com/percent.png',
          dataUrl: 'data:image/png,%E4%BD%A0%E5%A5%BD%F0%9F%98%80',
          contentType: 'image/png',
          unknownImageField: { nested: LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD },
        },
        {
          id: 44,
          conversationId: chatConversationId,
          url: 'https://example.com/buffer.png',
          blob: base64Bytes.buffer.slice(0),
          contentType: 'image/png',
        },
      ],
      messages: [
        {
          id: 20,
          conversationId: chatConversationId,
          messageKey: 'message-one',
          contentText: '你好😀',
          opaque: { large: LOCAL_DATA_MIGRATION_LARGE_UNKNOWN_PAYLOAD },
        },
        {
          id: 21,
          conversationId: chatConversationId,
          messageKey: 'message-two',
          contentText: 'second',
        },
      ],
      syncMappings: [
        {
          id: 30,
          source: 'chatgpt',
          conversationKey: 'conversation-a',
          notionPageId: 'page-1',
          opaqueMappingField: ['keep'],
        },
      ],
    },
  };
}
