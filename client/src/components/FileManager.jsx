import React, { useState, useEffect, useRef, useCallback } from 'react';

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function fmtTime(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function MetaBadge({ children, color }) {
  return (
    <span style={{
      fontSize: 11, padding: '1px 6px', borderRadius: 3,
      background: color || 'var(--surface2)', color: 'var(--muted)', fontWeight: 600,
    }}>
      {children}
    </span>
  );
}

export default function FileManager() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { name, pct, loaded, total, phase }
  const [starting, setStarting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef();

  const loadFiles = useCallback(async () => {
    try {
      const r = await fetch('/api/files');
      if (!r.ok) throw new Error(await r.text());
      setFiles(await r.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const uploadFile = (file) => {
    if (!file) return;
    setUploading(true);
    setUploadProgress({ name: file.name, pct: 0, loaded: 0, total: file.size, phase: 'uploading' });

    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress({ name: file.name, pct: Math.round(e.loaded / e.total * 100), loaded: e.loaded, total: e.total, phase: 'uploading' });
      }
    };

    xhr.upload.onload = () => {
      setUploadProgress(prev => ({ ...prev, pct: 100, phase: 'processing' }));
    };

    xhr.onload = async () => {
      setUploading(false);
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        await loadFiles();
      } else {
        alert(`Upload failed: ${xhr.responseText}`);
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setUploadProgress(null);
      alert('Upload failed: network error');
    };

    xhr.open('POST', '/api/files/upload');
    xhr.send(form);
  };

  const startPrint = async (filename) => {
    if (!confirm(`Start printing "${filename}"?`)) return;
    setStarting(filename);
    try {
      const r = await fetch('/api/files/print/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      alert(`Failed to start print: ${e.message}`);
    } finally {
      setStarting(null);
    }
  };

  const deleteFile = async (filename) => {
    if (!confirm(`Delete "${filename}"?`)) return;
    setDeleting(filename);
    try {
      const r = await fetch('/api/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!r.ok) throw new Error(await r.text());
      setFiles(prev => prev.filter(f => f.path !== filename));
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setDeleting(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const filtered = files.filter(f =>
    f.path.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8,
          padding: '24px 20px',
          textAlign: 'center',
          cursor: uploading ? 'default' : 'pointer',
          background: dragOver ? 'rgba(74,158,255,0.05)' : 'var(--surface)',
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".gcode,.gco,.g"
          style={{ display: 'none' }}
          onChange={e => uploadFile(e.target.files[0])}
        />
        {uploading && uploadProgress ? (
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {uploadProgress.name}
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
                {uploadProgress.phase === 'processing' ? 'Processing…' : `${uploadProgress.pct}%`}
              </span>
            </div>
            <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${uploadProgress.pct}%`,
                background: uploadProgress.phase === 'processing' ? 'var(--ok)' : 'var(--accent)',
                borderRadius: 4,
                transition: 'width 0.15s ease',
              }} />
            </div>
            {uploadProgress.phase === 'uploading' && (
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                {fmtSize(uploadProgress.loaded)} / {fmtSize(uploadProgress.total)}
              </p>
            )}
            {uploadProgress.phase === 'processing' && (
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                Saving to printer…
              </p>
            )}
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--muted)', margin: '0 0 4px', fontSize: 14 }}>
              Drop G-code file here or click to upload
            </p>
            <p style={{ color: 'var(--muted)', margin: 0, fontSize: 12 }}>.gcode · .gco · .g</p>
          </>
        )}
      </div>

      {/* Search + refresh */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search files…"
          style={{
            flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13,
          }}
        />
        <button
          className="btn-ghost"
          style={{ padding: '6px 12px', fontSize: 12 }}
          onClick={loadFiles}
          disabled={loading}
        >
          {loading ? '…' : 'Refresh'}
        </button>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{files.length} files</span>
      </div>

      {error && <p style={{ color: 'var(--crit)', fontSize: 13 }}>Error: {error}</p>}

      {/* File list */}
      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading files…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No files found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(f => {
            const name = f.path.replace(/\.gcode$/i, '');
            const meta = f.meta;
            const isStarting = starting === f.path;
            const isDeleting = deleting === f.path;
            return (
              <div key={f.path} className="card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, wordBreak: 'break-word' }}>
                      {name}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: meta ? 6 : 0 }}>
                      <MetaBadge>{fmtSize(f.size)}</MetaBadge>
                      <MetaBadge>{fmtDate(f.modified)}</MetaBadge>
                      {meta?.filament_type && <MetaBadge color="rgba(74,158,255,0.15)">{meta.filament_type}</MetaBadge>}
                      {meta?.estimated_time && <MetaBadge>⏱ {fmtTime(meta.estimated_time)}</MetaBadge>}
                      {meta?.layer_height && <MetaBadge>↕ {meta.layer_height}mm</MetaBadge>}
                      {meta?.object_height && <MetaBadge>↑ {meta.object_height}mm tall</MetaBadge>}
                      {meta?.filament_total && <MetaBadge>🧵 {(meta.filament_total / 1000).toFixed(1)}m</MetaBadge>}
                    </div>
                    {meta && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {meta.first_layer_extr_temp && `Nozzle ${meta.first_layer_extr_temp}°C`}
                        {meta.first_layer_bed_temp && ` · Bed ${meta.first_layer_bed_temp}°C`}
                        {meta.slicer && ` · ${meta.slicer} ${meta.slicer_version || ''}`}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => startPrint(f.path)}
                      disabled={isStarting || isDeleting}
                      style={{
                        background: 'var(--ok)', color: '#fff', border: 'none',
                        borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600,
                        cursor: isStarting ? 'default' : 'pointer', opacity: isStarting ? 0.7 : 1,
                      }}
                    >
                      {isStarting ? '…' : '▶ Print'}
                    </button>
                    <button
                      onClick={() => deleteFile(f.path)}
                      disabled={isStarting || isDeleting}
                      style={{
                        background: 'none', color: 'var(--crit)', border: '1px solid var(--crit)',
                        borderRadius: 5, padding: '5px 10px', fontSize: 12, fontWeight: 600,
                        cursor: isDeleting ? 'default' : 'pointer', opacity: isDeleting ? 0.5 : 1,
                      }}
                    >
                      {isDeleting ? '…' : '✕'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
