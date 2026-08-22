import React, { useState, useEffect, useRef } from 'react';

export default function LiveFeed({ config }) {
  const [mode, setMode] = useState('live'); // 'live' | 'snapshot'
  const [src, setSrc] = useState(null);
  const [snapping, setSnapping] = useState(false);
  const activeRef = useRef(false);
  const prevBlobRef = useRef(null);

  // Live mode: poll snapshot every 500ms
  useEffect(() => {
    if (mode !== 'live' || (!config?.printer_ip && !config?.camera_url)) return;

    activeRef.current = true;

    const fetchFrame = async () => {
      if (!activeRef.current) return;
      try {
        const r = await fetch('/api/printer/snapshot');
        if (r.ok && activeRef.current) {
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          setSrc(prev => {
            if (prev && prev !== url) URL.revokeObjectURL(prev);
            return url;
          });
        }
      } catch {
        // printer unreachable — just stop updating
      }
      if (activeRef.current) setTimeout(fetchFrame, 100);
    };

    fetchFrame();
    return () => {
      activeRef.current = false;
    };
  }, [mode, config?.printer_ip, config?.camera_url]);

  const takeSnapshot = async () => {
    setSnapping(true);
    try {
      const r = await fetch('/api/printer/snapshot');
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      setSrc(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setMode('snapshot');
    } catch (e) {
      alert(`Snapshot failed: ${e.message}`);
    } finally {
      setSnapping(false);
    }
  };

  const goLive = () => {
    setSrc(null);
    setMode('live');
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Camera Feed</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {mode === 'live' && (
            <span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 600 }}>● LIVE</span>
          )}
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={goLive} disabled={mode === 'live'}>
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
        ) : src ? (
          <img
            src={src}
            alt={mode === 'live' ? 'Live feed' : 'Snapshot'}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {mode === 'live' ? 'Connecting to camera…' : 'No snapshot yet'}
          </span>
        )}
      </div>
    </div>
  );
}
