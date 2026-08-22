import React, { useState, useEffect, useRef } from 'react';

// Parse an MJPEG stream by looking for JPEG SOI (FF D8) / EOI (FF D9) markers.
// Calls onFrame(Uint8Array) for each complete JPEG frame.
async function consumeMjpeg(signal, onFrame) {
  const res = await fetch('/api/printer/stream', { signal });
  const reader = res.body.getReader();

  let buf = new Uint8Array(0);

  const append = (a, b) => {
    const c = new Uint8Array(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf = append(buf, value);

    // Extract all complete JPEG frames from the buffer
    while (true) {
      // Find SOI marker (FF D8)
      let start = -1;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i + 1] === 0xD8) { start = i; break; }
      }
      if (start < 0) { buf = new Uint8Array(0); break; }

      // Find EOI marker (FF D9) after SOI
      let end = -1;
      for (let i = start + 2; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i + 1] === 0xD9) { end = i + 2; break; }
      }
      if (end < 0) break; // frame not complete yet — wait for more data

      onFrame(buf.slice(start, end));
      buf = buf.slice(end);
    }

    // Safety valve: if buffer grows > 2MB without a complete frame, reset
    if (buf.length > 2 * 1024 * 1024) buf = new Uint8Array(0);
  }
}

export default function LiveFeed({ config }) {
  const [src, setSrc] = useState(null);
  const [mode, setMode] = useState('live');  // 'live' | 'snapshot'
  const [snapping, setSnapping] = useState(false);
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'live' | 'error'
  const prevSrcRef = useRef(null);

  useEffect(() => {
    if (mode !== 'live' || (!config?.printer_ip && !config?.camera_url)) return;

    setStatus('connecting');
    const controller = new AbortController();
    let retryTimer = null;
    let delay = 1000;

    const connect = async () => {
      try {
        await consumeMjpeg(controller.signal, (jpegBytes) => {
          const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          setSrc(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          setStatus('live');
          delay = 1000; // reset backoff on successful frame
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus('error');
        retryTimer = setTimeout(() => {
          delay = Math.min(delay * 2, 10000);
          connect();
        }, delay);
      }
    };

    connect();
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [mode, config?.printer_ip, config?.camera_url]);

  // Clean up blob URL on unmount
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, []);

  const takeSnapshot = async () => {
    setSnapping(true);
    try {
      const r = await fetch('/api/printer/snapshot');
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      setSrc(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setMode('snapshot');
    } catch (e) {
      alert(`Snapshot failed: ${e.message}`);
    } finally {
      setSnapping(false);
    }
  };

  const goLive = () => { setSrc(null); setMode('live'); };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Camera Feed</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {mode === 'live' && status === 'live' && (
            <span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 600 }}>● LIVE</span>
          )}
          {mode === 'live' && status === 'connecting' && (
            <span style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 600 }}>● connecting</span>
          )}
          {mode === 'live' && status === 'error' && (
            <span style={{ fontSize: 11, color: 'var(--crit)', fontWeight: 600 }}>● reconnecting</span>
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
            {status === 'error' ? 'Camera unreachable — retrying…' : 'Connecting to camera…'}
          </span>
        )}
      </div>
    </div>
  );
}
