import React, { useState, useEffect, useRef } from 'react';
import STLViewer from './STLViewer.jsx';

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function fmtElapsed(s) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const PHASES = [
  { after:  0, label: 'Parsing model geometry…' },
  { after:  4, label: 'Generating support structures…' },
  { after: 12, label: 'Slicing layers…' },
  { after: 30, label: 'Computing infill patterns…' },
  { after: 50, label: 'Generating G-code…' },
  { after: 75, label: 'Finalizing G-code…' },
];

function SlicingProgress({ uploading }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const phase = uploading
    ? 'Uploading G-code to printer…'
    : [...PHASES].reverse().find(p => elapsed >= p.after)?.label ?? PHASES[0].label;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ height: 5, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{
          height: '100%', borderRadius: 4, width: '100%',
          background: 'linear-gradient(90deg, transparent 0%, var(--accent) 40%, var(--ok) 60%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.6s linear infinite',
        }} />
      </div>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{phase}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{fmtElapsed(elapsed)}</span>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{children}</div>;
}

const selectStyle = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '7px 10px', color: 'var(--text)', fontSize: 13, cursor: 'pointer',
};

export default function Slicer({ onFileUploaded }) {
  const [options, setOptions] = useState(null);

  // Core settings
  const [material, setMaterial] = useState('PLA');
  const [quality, setQuality] = useState('Standard (0.20mm)');

  // Print options
  const [supports, setSupports] = useState('none');          // none | normal | tree
  const [supportBuildPlateOnly, setSupportBuildPlateOnly] = useState(false);
  const [brim, setBrim] = useState('no_brim');               // no_brim | outer_only | outer_and_inner
  const [brimWidth, setBrimWidth] = useState(5);
  const [infillDensity, setInfillDensity] = useState(15);
  const [infillPattern, setInfillPattern] = useState('grid');

  // State
  const [file, setFile] = useState(null);
  const [slicing, setSlicing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef();

  useEffect(() => {
    fetch('/api/slicer/options').then(r => r.json()).then(d => {
      setOptions(d);
      setMaterial(d.defaults.material);
      setQuality(d.defaults.quality);
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
    form.append('supports', supports);
    form.append('supportBuildPlateOnly', supportBuildPlateOnly ? '1' : '0');
    form.append('brim', brim);
    form.append('brimWidth', String(brimWidth));
    form.append('infillDensity', String(infillDensity));
    form.append('infillPattern', infillPattern);

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onload = () => setUploading(true);
      xhr.onload = () => {
        setSlicing(false);
        setUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try { setResult(JSON.parse(xhr.responseText)); onFileUploaded?.(); }
          catch { setError('Invalid server response'); }
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
          borderRadius: 8, padding: file ? '12px 16px' : '20px 16px', textAlign: 'center',
          cursor: busy ? 'default' : 'pointer',
          background: dragOver ? 'rgba(74,158,255,0.05)' : file ? 'rgba(80,200,120,0.04)' : 'transparent',
          marginBottom: file ? 10 : 14, transition: 'all 0.15s',
        }}
      >
        <input ref={fileInputRef} type="file" accept=".stl" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
        {file ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textAlign: 'left' }}>{file.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, textAlign: 'left' }}>{fmtSize(file.size)}{!busy && ' · click to change'}</div>
            </div>
            {!busy && <span style={{ fontSize: 12, color: 'var(--muted)' }}>↻</span>}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Drop STL file here or click to select</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>.stl</div>
          </>
        )}
      </div>

      {/* 3D preview */}
      {file && !busy && !result && <STLViewer file={file} />}

      {/* Settings grid */}
      {options && !result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px', marginBottom: 14 }}>

          {/* Material */}
          <div>
            <Label>Material</Label>
            <select value={material} onChange={e => setMaterial(e.target.value)} style={selectStyle} disabled={busy}>
              {options.materials.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>

          {/* Quality */}
          <div>
            <Label>Quality</Label>
            <select value={quality} onChange={e => setQuality(e.target.value)} style={selectStyle} disabled={busy}>
              {options.qualities.map(q => <option key={q}>{q}</option>)}
            </select>
          </div>

          {/* Supports */}
          <div>
            <Label>Supports</Label>
            <select value={supports} onChange={e => setSupports(e.target.value)} style={selectStyle} disabled={busy}>
              <option value="none">None</option>
              <option value="normal">Normal</option>
              <option value="tree">Tree (recommended)</option>
            </select>
          </div>

          {/* Brim */}
          <div>
            <Label>Brim</Label>
            <select value={brim} onChange={e => setBrim(e.target.value)} style={selectStyle} disabled={busy}>
              <option value="no_brim">None</option>
              <option value="outer_only">Outer only</option>
              <option value="outer_and_inner">Outer + inner</option>
              <option value="auto_brim">Auto</option>
            </select>
          </div>

          {/* Brim width (only when brim is on) */}
          {brim !== 'no_brim' && (
            <div>
              <Label>Brim width (mm)</Label>
              <input
                type="number" min="2" max="20" step="1"
                value={brimWidth} onChange={e => setBrimWidth(Number(e.target.value))}
                disabled={busy}
                style={{ ...selectStyle, width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          )}

          {/* Support build-plate only (only when supports enabled) */}
          {supports !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" id="bpo" checked={supportBuildPlateOnly}
                onChange={e => setSupportBuildPlateOnly(e.target.checked)} disabled={busy} />
              <label htmlFor="bpo" style={{ fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>Build plate only</label>
            </div>
          )}

          {/* Infill density */}
          <div style={{ gridColumn: '1 / -1' }}>
            <Label>Infill density — {infillDensity}%</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="range" min="0" max="100" step="5"
                value={infillDensity} onChange={e => setInfillDensity(Number(e.target.value))}
                disabled={busy}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 36, textAlign: 'right' }}>{infillDensity}%</span>
            </div>
          </div>

          {/* Infill pattern */}
          <div style={{ gridColumn: '1 / -1' }}>
            <Label>Infill pattern</Label>
            <select value={infillPattern} onChange={e => setInfillPattern(e.target.value)} style={selectStyle} disabled={busy}>
              <option value="grid">Grid</option>
              <option value="line">Lines</option>
              <option value="gyroid">Gyroid</option>
              <option value="honeycomb">Honeycomb</option>
              <option value="triangle">Triangle</option>
              <option value="cubic">Cubic</option>
              <option value="rectilinear">Rectilinear</option>
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
            width: '100%', padding: '10px 0', fontWeight: 700, fontSize: 13,
            background: file && !busy ? 'var(--accent)' : 'var(--surface2)',
            color: file && !busy ? '#fff' : 'var(--muted)',
            border: 'none', borderRadius: 6, cursor: file && !busy ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          {busy ? 'Slicing…' : 'Slice & Upload to Printer'}
        </button>
      )}

      {busy && <SlicingProgress uploading={uploading} />}

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
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>
            <div><span style={{ color: 'var(--muted)' }}>File: </span>{result.filename}</div>
            <div><span style={{ color: 'var(--muted)' }}>Size: </span>{fmtSize(result.size)}</div>
            <div><span style={{ color: 'var(--muted)' }}>Material: </span>{result.material} · {result.quality}</div>
            <div><span style={{ color: 'var(--muted)' }}>Infill: </span>{result.infillDensity}% {result.infillPattern}</div>
            {result.supports !== 'none' && <div><span style={{ color: 'var(--muted)' }}>Supports: </span>{result.supports}{result.supportBuildPlateOnly ? ' (build plate only)' : ''}</div>}
            {result.brim !== 'no_brim' && <div><span style={{ color: 'var(--muted)' }}>Brim: </span>{result.brim} {result.brimWidth}mm</div>}
          </div>
          <button onClick={reset} style={{ marginTop: 10, padding: '6px 14px', fontSize: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--muted)', cursor: 'pointer' }}>
            Slice another file
          </button>
        </div>
      )}
    </div>
  );
}
