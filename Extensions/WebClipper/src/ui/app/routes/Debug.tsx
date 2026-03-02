import { send } from '../../../platform/runtime/runtime';
import { CORE_MESSAGE_TYPES } from '../../../platform/messaging/message-contracts';

export default function Debug() {
  const ping = async () => {
    try {
      const res = await send('__WXT_PING__');
      alert(JSON.stringify(res));
    } catch (e) {
      alert(String(e));
    }
  };

  const seedConversation = async () => {
    try {
      const now = Date.now();
      const key = `debug_${now}`;
      const upsertRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
        payload: {
          sourceType: 'chat',
          source: 'debug',
          conversationKey: key,
          title: `Debug Conversation ${new Date(now).toLocaleString()}`,
          url: '',
          lastCapturedAt: now,
        },
      });

      const conversationId = Number((upsertRes as any)?.data?.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        alert(`Upsert did not return a valid id: ${JSON.stringify(upsertRes)}`);
        return;
      }

      const messages = [
        {
          messageKey: `${key}_m1`,
          role: 'user',
          contentText: 'Hello from Debug seed.',
          contentMarkdown: 'Hello from **Debug seed**.',
          sequence: 1,
          updatedAt: now,
        },
        {
          messageKey: `${key}_m2`,
          role: 'assistant',
          contentText: 'Seeded successfully.',
          contentMarkdown: 'Seeded successfully.',
          sequence: 2,
          updatedAt: now,
        },
      ];

      const syncRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
        conversationId,
        messages,
      });

      alert(`Seeded conversation#${conversationId}\n${JSON.stringify(syncRes)}`);
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <section>
      <h1 style={{ margin: 0 }}>Debug</h1>
      <p style={{ opacity: 0.75 }}>Temporary tools for migration verification.</p>
      <button onClick={ping} style={{ marginTop: 8 }} type="button">
        Ping background
      </button>
      <button onClick={seedConversation} style={{ marginLeft: 8, marginTop: 8 }} type="button">
        Seed sample conversation
      </button>
    </section>
  );
}
