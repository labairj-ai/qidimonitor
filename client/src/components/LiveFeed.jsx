import { usePrinterApi } from '../printerApi.jsx';
import React, { useState, useEffect, useRef } from 'react';

const FRAME_TIMEOUT_MS = 4000; // reconnect if no frame in 4s

async function consumeMjpeg(apiFetch, signal, onFrame) {
  const res = await apiFetch('/api/printer/stream', { signal });
  if (!res.ok) throw new Error(`Stream ${res.status}`);
  const reader = res.body.getReader();

  let buf = new Uint8Array(0);

  const append = (a, b) => {
    const c = new Uint8Array(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
  };

  // Watchdog: abort if no frame arrives within FRAME_TIMEOUT_MS
  let watchdog = null;
  const resetWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => reader.cancel(), FRAME_TIMEOUT_MS);
  };
  resetWatchdog();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resetWatchdog();
      buf = append(buf, value);

      // Extract all complete JPEG frames from the buffer
      while (true) {
        let start = -1;
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i] === 0xFF && buf[i + 1] === 0xD8) { start = i; break; }
        }
        if (start < 0) { buf = new Uint8Array(0); break; }

        let end = -1;
        for (let i = start + 2; i < buf.length - 1; i++) {
          if (buf[i] === 0xFF && buf[i + 1] === 0xD9) { end = i + 2; break; }
        }
        if (end < 0) break;

        onFrame(buf.slice(start, end));
        buf = buf.slice(end);
      }

      if (buf.length > 2 * 1024 * 1024) buf = new Uint8Array(0);
    }
  } finally {
    clearTimeout(watchdog);
  }
}

export default function LiveFeed({ config }) {
  const { apiFetch } = usePrinterApi();
  const [src, setSrc] = useState(null);
  const [mode, setMode] = useState('live');  // 'live' | 'snapshot'
  const [snapping, setSnapping] = useState(false);
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'live' | 'error'
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cardRef = useRef(null);
  const viewRef = useRef(null);
  const dragStart = useRef(null);
  const prevSrcRef = useRef(null);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Clamp pan whenever zoom changes
  useEffect(() => {
    if (zoom === 1) { setPan({ x: 0, y: 0 }); return; }
    const el = viewRef.current;
    if (!el) return;
    const maxX = (el.clientWidth * (zoom - 1)) / 2;
    const maxY = (el.clientHeight * (zoom - 1)) / 2;
    setPan(p => ({
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    }));
  }, [zoom]);

  // Pointer capture keeps mouse, pen, and touch drags attached to the view.
  const stopDrag = (e) => {
    if (dragStart.current?.pointerId !== e.pointerId) return;
    dragStart.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onPointerDown = (e) => {
    if (zoom <= 1 || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pointerId:e.pointerId, x:e.clientX, y:e.clientY, panX:pan.x, panY:pan.y };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== e.pointerId || zoom <= 1) return;
    const el = viewRef.current;
    if (!el) return;
    const maxX = el.clientWidth * (zoom - 1) / 2;
    const maxY = el.clientHeight * (zoom - 1) / 2;
    setPan({
      x:Math.max(-maxX,Math.min(maxX,start.panX + e.clientX - start.x)),
      y:Math.max(-maxY,Math.min(maxY,start.panY + e.clientY - start.y)),
    });
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      cardRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    if (mode !== 'live' || (!config?.camera_stream_url && !(config?.model === 'qidi' && config?.printer_ip))) return;

    setStatus('connecting');
    const controller = new AbortController();
    let retryTimer = null;
    let delay = 1000;

    const connect = async () => {
      try {
        await consumeMjpeg(apiFetch, controller.signal, (jpegBytes) => {
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
      }
      // Stream ended for any reason (watchdog cancel, server close, network error).
      // Reconnect unless this component is being unmounted (controller aborted).
      if (!controller.signal.aborted) {
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
  }, [mode, config?.printer_ip, config?.camera_url, config?.camera_stream_url, apiFetch]);

  // Clean up blob URL on unmount
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, []);

  const takeSnapshot = async () => {
    setSnapping(true);
    try {
      const r = await apiFetch('/api/printer/snapshot');
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

  const cardStyle = isFullscreen
    ? { background: '#000', display: 'flex', flexDirection: 'column', height: '100vh', padding: 12, boxSizing: 'border-box', borderRadius: 0 }
    : {};

  return (
    <div className="card" ref={cardRef} style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: isFullscreen ? '#fff' : undefined }}>Camera Feed</span>
        <div className="camera-controls" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: '100%' }}>
          {mode === 'live' && status === 'live' && (
            <span style={{ fontSize: 11, color: 'var(--ok)', fontWeight: 600 }}>● LIVE</span>
          )}
          {mode === 'live' && status === 'connecting' && (
            <span style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 600 }}>● connecting</span>
          )}
          {mode === 'live' && status === 'error' && (
            <span style={{ fontSize: 11, color: 'var(--crit)', fontWeight: 600 }}>● reconnecting</span>
          )}

          {/* Zoom controls */}
          <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setZoom(z => Math.max(1, +(z - 0.25).toFixed(2)))} disabled={zoom <= 1}>−</button>
          <span style={{ fontSize: 11, minWidth: 28, textAlign: 'center', color: isFullscreen ? '#ccc' : undefined }}>{zoom.toFixed(2)}×</span>
          <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
          {zoom !== 1 && (
            <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>reset</button>
          )}

          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={goLive} disabled={mode === 'live'}>
            Live
          </button>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={takeSnapshot} disabled={snapping}>
            {snapping ? 'Capturing…' : 'Snapshot'}
          </button>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? '⤡' : '⤢'}
          </button>
        </div>
      </div>

      <div
        ref={viewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
        style={{
          background: '#000',
          borderRadius: isFullscreen ? 0 : 6,
          overflow: 'hidden',
          aspectRatio: isFullscreen ? undefined : '4/3',
          flex: isFullscreen ? 1 : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
          userSelect: 'none',
          touchAction: zoom > 1 ? 'none' : 'pan-y pinch-zoom',
        }}
      >
        {!src && !config?.camera_stream_url && !(config?.model === 'qidi' && config?.printer_ip) ? (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Configure this printer’s camera in Settings</span>
        ) : src ? (
          <img
            src={src}
            alt={mode === 'live' ? 'Live feed' : 'Snapshot'}
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}
          />
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {status === 'error' ? 'Camera unreachable — retrying…' : 'Connecting to camera…'}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, color: isFullscreen ? '#ccc' : 'var(--muted)', marginTop: 8, flexShrink: 0 }}>
        {zoom > 1 ? 'Drag the image to pan — use one finger on mobile. Reset returns to the full view.' : 'Tap + to zoom, then drag the image to pan. On mobile, use one finger.'}
      </p>
    </div>
  );
}
