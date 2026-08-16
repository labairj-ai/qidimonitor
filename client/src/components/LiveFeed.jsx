import React, { useState, useEffect, useRef } from 'react';

export default function LiveFeed({ config }) {
  const [mode, setMode] = useState('stream'); // 'stream' | 'snapshot'
  const [snapshotSrc, setSnapshotSrc] = useState(null);
  const [snapping, setSnapping] = useState(false);
  const streamKey = useRef(0);

  const takeSnapshot = async () => {
    setSnapping(true);
    try {
      const r = await fetch('/api/printer/snapshot');
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      setSnapshotSrc(URL.createObjectURL(blob));
      setMode('snapshot');
    } catch (e) {
      alert(`Snapshot failed: ${e.message}`);
    } finally {
      setSnapping(false);
    }
  };

  const streamSrc = '/api/printer/stream';

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Camera Feed</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { streamKey.current++; setMode('stream'); }}>
            Live
          </button>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={takeSnapshot} disabled={snapping}>
            {snapping ? 'Capturing…' : 'Snapshot'}
          </button>
        </div>
      </div>

      <div style={{ background: '#000', borderRadius: 6, overflow: 'hidden', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!config?.printer_ip && !config?.camera_url ? (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Configure printer IP in Settings</span>
        ) : mode === 'stream' ? (
          <img
            key={streamKey.current}
            src={streamSrc}
            alt="Live feed"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={() => setMode('snapshot')}
          />
        ) : snapshotSrc ? (
          <img src={snapshotSrc} alt="Snapshot" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>No snapshot yet</span>
        )}
      </div>
    </div>
  );
}
