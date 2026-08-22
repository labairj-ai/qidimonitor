import React, { useState, useEffect, useRef } from 'react';

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function fmtElapsed(s) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Phase messages keyed by elapsed seconds threshold
const PHASES = [
  { after:  0, label: 'Parsing model geometry…' },
  { after:  4, label: 'Generating support structures…' },
  { after: 12, label: 'Slicing layers…' },
  { after: 30, label: 'Computing infill patterns…' },
  { after: 50, label: 'Generating G-code…' },
  { after: 75, label: 'Finalizing G-code…' },
];

function SlicingProgress({ filename, material, quality, uploading }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const phase = uploading
    ? 'Uploading G-code to printer…'
    : [...PHASES].reverse().find(p => elapsed >= p.after)?.label ?? PHASES[0].label;

  return (
    <div style={{ marginTop: 12 }}>
      {/* Shimmer bar */}
      <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', marginBottom: 10 }}>
        <div style={{
          height: '100%',
          borderRadius: 4,
          background: 'linear-gradient(90deg, transparent 0%, var(--accent) 40%, var(--ok) 60%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.6s linear infinite',
          width: '100%',
        }} />
      </div>

      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      {/* Phase + timer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{phase}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{fmtElapsed(elapsed)}</span>
      </div>

      {/* Context */}
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{filename}</span>
        {' '}&nbsp;·&nbsp; {material} &nbsp;·&nbsp; {quality}
      </div>
    </div>
  );
}

export default function Slicer({ onFileUploaded }) {
  const [options, setOptions] = useState(null);
  const [material, setMaterial] = useState('PLA');
  const [quality, setQuality] = useState('Standard (0.20mm)');
  const [file, setFile] = useState(null);
  const [slicing, setSlicing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef();

  useEffect(() => {
    fetch('/api/slicer/options').then(r => r.json()).then(data => {
      setOptions(data);
      setMaterial(data.defaults.material);
      setQuality(data.defaults.quality);
    }).catch(() => {});
  }, []);

  const handleFile = (f) => {
    if (!f) return;
    if (!/\.stl$/i.test(f.name)) { setError('Only .stl files are supported'); return; }
    setFile(f);
    setResult(null);
    setError(null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const slice = async () => {
    if (!file) return;
    setSlicing(true);
    setUploading(false);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);
    form.append('material', material);
    form.append('quality', quality);

    // Use XHR so we can hook the upload→processing transition
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onload = () => setUploading(true); // data sent; now server is slicing+uploading
      xhr.onload = () => {
        setSlicing(false);
        setUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            setResult(data);
            onFileUploaded?.();
          } catch {
            setError('Invalid response from server');
          }
        } else {
          try { setError(JSON.parse(xhr.responseText).error || xhr.responseText); }
          catch { setError(xhr.responseText || `Error ${xhr.status}`); }
        }
        resolve();
      };
      xhr.onerror = () => { setSlicing(false); setUploading(false); setError('Network error'); resolve(); };
      xhr.open('POST', '/api/slicer/slice');
      xhr.send(form);
    });
  };

  const reset = () => { setFile(null); setResult(null); setError(null); };

  const selectStyle = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '7px 10px', color: 'var(--text)', fontSize: 13,
    cursor: 'pointer', flex: 1,
  };

  const busy = slicing || uploading;

  return (
    <div className="card">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Slice STL</div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : file ? 'var(--ok)' : 'var(--border)'}`,
          borderRadius: 8, padding: '20px 16px', textAlign: 'center',
          cursor: busy ? 'default' : 'pointer',
          background: dragOver ? 'rgba(74,158,255,0.05)' : file ? 'rgba(80,200,120,0.04)' : 'transparent',
          marginBottom: 14, transition: 'all 0.15s',
        }}
      >
        <input ref={fileInputRef} type="file" accept=".stl" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
        {file ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{file.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {fmtSize(file.size)}{!busy && ' · click to change'}
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Drop STL file here or click to select</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>.stl</div>
          </>
        )}
      </div>

      {/* Material + Quality */}
      {options && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Material</div>
            <select value={material} onChange={e => setMaterial(e.target.value)} style={selectStyle} disabled={busy}>
              {options.materials.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Quality</div>
            <select value={quality} onChange={e => setQuality(e.target.value)} style={selectStyle} disabled={busy}>
              {options.qualities.map(q => <option key={q}>{q}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Slice button */}
      {!result && (
        <button
          onClick={slice}
          disabled={!file || busy}
          style={{
            width: '100%', padding: '9px 0', fontWeight: 700, fontSize: 13,
            background: file && !busy ? 'var(--accent)' : 'var(--surface2)',
            color: file && !busy ? '#fff' : 'var(--muted)',
            border: 'none', borderRadius: 6, cursor: file && !busy ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          {busy ? 'Slicing…' : 'Slice & Upload to Printer'}
        </button>
      )}

      {/* Live progress */}
      {busy && (
        <SlicingProgress
          filename={file?.name}
          material={material}
          quality={quality}
          uploading={uploading}
        />
      )}

      {/* Error */}
      {error && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,80,80,0.08)', border: '1px solid var(--crit)', borderRadius: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--crit)', fontWeight: 600, marginBottom: 2 }}>Slicing failed</div>
          <div style={{ fontSize: 11, color: 'var(--crit)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</div>
        </div>
      )}

      {/* Success */}
      {result && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(80,200,120,0.08)', border: '1px solid var(--ok)', borderRadius: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ok)', marginBottom: 6 }}>✓ Sliced & uploaded to printer</div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
            <div><span style={{ color: 'var(--muted)' }}>File: </span>{result.filename}</div>
            <div><span style={{ color: 'var(--muted)' }}>Size: </span>{fmtSize(result.size)}</div>
            <div><span style={{ color: 'var(--muted)' }}>Material: </span>{result.material} · {result.quality}</div>
          </div>
          <button
            onClick={reset}
            style={{ marginTop: 10, padding: '6px 14px', fontSize: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--muted)', cursor: 'pointer' }}
          >
            Slice another file
          </button>
        </div>
      )}
    </div>
  );
}
