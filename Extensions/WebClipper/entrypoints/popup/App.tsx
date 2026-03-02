import './App.css';

export default function App() {
  const openApp = async () => {
    const url = browser.runtime.getURL('app.html#/');
    await browser.tabs.create({ url });
    window.close();
  };

  return (
    <div className="container">
      <h1>SyncNos WebClipper</h1>
      <button className="primaryButton" onClick={openApp} type="button">
        Open App
      </button>
    </div>
  );
}
