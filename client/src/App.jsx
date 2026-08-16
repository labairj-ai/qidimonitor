import React, { useState, useEffect, useCallback } from 'react';
import LiveFeed from './components/LiveFeed.jsx';
import DiagnosePanel from './components/DiagnosePanel.jsx';
import PrintStatus from './components/PrintStatus.jsx';
import AutoMonitor from './components/AutoMonitor.jsx';
import History from './components/History.jsx';
import Settings from './components/Settings.jsx';

const TABS = ['Monitor', 'History', 'Settings'];

export default function App() {
  const [tab, setTab] = useState('Monitor');
  const [config, setConfig] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const loadConfig = useCallback(async () => {
    const r = await fetch('/api/config');
    if (r.ok) setConfig(await r.json());
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const printerReady = config?.printer_ip || config?.camera_url;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>QIDI Monitor</span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>X-Plus 3</span>
        {config && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: printerReady ? 'var(--ok)' : 'var(--warn)' }}>
            {printerReady ? `● ${config.printer_ip || 'camera configured'}` : '● Not configured'}
          </span>
        )}
      </header>

      {/* Tabs */}
      <nav style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', padding: '0 20px' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              color: tab === t ? 'var(--accent)' : 'var(--muted)',
              padding: '10px 16px',
              fontWeight: tab === t ? 700 : 400,
              fontSize: 14,
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ flex: 1, padding: 20, maxWidth: 960, margin: '0 auto', width: '100%' }}>
        {tab === 'Monitor' && (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <LiveFeed config={config} />
              <PrintStatus config={config} />
              <AutoMonitor config={config} onConfigChange={loadConfig} />
            </div>
            <DiagnosePanel config={config} onResult={setLastResult} latestResult={lastResult} />
          </div>
        )}
        {tab === 'History' && <History />}
        {tab === 'Settings' && <Settings config={config} onSave={loadConfig} />}
      </main>
    </div>
  );
}
