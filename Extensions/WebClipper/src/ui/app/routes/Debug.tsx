import { send } from '../../../platform/runtime/runtime';

export default function Debug() {
  const ping = async () => {
    try {
      const res = await send('__WXT_PING__');
      alert(JSON.stringify(res));
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
    </section>
  );
}
