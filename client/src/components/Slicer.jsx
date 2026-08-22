import React, { useState, useEffect, useRef } from 'react';

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

export default function Slicer({ onFileUploaded }) {
  const [options, setOptions] = useState(null);
  const [material, setMaterial] = useState('PLA');
  const [quality, setQuality] = useState('Standard (0.20mm)');
  const [file, setFile] = useState(null);
  const [slicing, setSlicing] = useState(false);
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
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);
    form.append('material', material);
    form.append('quality', quality);

    try {
      const r = await fetch('/api/slicer/slice', { method: 'POST', body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Slicer error ${r.status}`);
      setResult(data);
      onFileUploaded?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSlicing(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setError(null); };

  const selectStyle = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '7px 10px', color: 'var(--text)', fontSize: 13,
    cursor: 'pointer', flex: 1,
  };

  return (
    <div className="card">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Slice STL</div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !slicing && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : file ? 'var(--ok)' : 'var(--border)'}`,
          borderRadius: 8, padding: '20px 16px', textAlign: 'center',
          cursor: slicing ? 'default' : 'pointer',
          background: dragOver ? 'rgba(74,158,255,0.05)' : file ? 'rgba(80,200,120,0.04)' : 'transparent',
          marginBottom: 14, transition: 'all 0.15s',
        }}
      >
        <input ref={fileInputRef} type="file" accept=".stl" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
        {file ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              {file.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {fmtSize(file.size)} · click to change
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
            <select value={material} onChange={e => setMaterial(e.target.value)} style={selectStyle} disabled={slicing}>
              {options.materials.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Quality</div>
            <select value={quality} onChange={e => setQuality(e.target.value)} style={selectStyle} disabled={slicing}>
              {options.qualities.map(q => <option key={q}>{q}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Slice button */}
      {!result && (
        <button
          onClick={slice}
          disabled={!file || slicing}
          style={{
            width: '100%', padding: '9px 0', fontWeight: 700, fontSize: 13,
            background: file && !slicing ? 'var(--accent)' : 'var(--surface2)',
            color: file && !slicing ? '#fff' : 'var(--muted)',
            border: 'none', borderRadius: 6, cursor: file && !slicing ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          {slicing ? (
            <span>⚙ Slicing with OrcaSlicer… <span style={{ fontWeight: 400, fontSize: 12 }}>(may take 30–60s)</span></span>
          ) : (
            'Slice & Upload to Printer'
          )}
        </button>
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
