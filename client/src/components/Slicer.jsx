import React, { useState, useEffect, useRef } from 'react';
import STLViewer from './STLViewer.jsx';

const AXIS_COLOR = { X: '#ff6b6b', Y: '#51cf66', Z: '#339af0' };

function RotationAxis({ axis, value, onChange, disabled }) {
  const color = AXIS_COLOR[axis];
  const btnStyle = (delta) => ({
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '3px 7px', fontSize: 11, color: 'var(--text)', cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'monospace', lineHeight: 1,
  });
  const steps = [[-90, '−90'], [-15, '−15'], [+15, '+15'], [+90, '+90']];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 12 }}>{axis}</span>
      {steps.map(([d, label]) => (
        <button key={d} style={btnStyle(d)} disabled={disabled} onClick={() => onChange(value + d)}>
          {label}°
        </button>
      ))}
      <input
        type="number" step="1" value={Math.round(((value % 360) + 360) % 360)}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{
          width: 48, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '3px 6px', fontSize: 11, color: 'var(--text)',
          fontFamily: 'monospace', textAlign: 'right',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>°</span>
    </div>
  );
}

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

const numStyle = {
  ...selectStyle, width: '100%', boxSizing: 'border-box',
};

export default function Slicer({ onFileUploaded, preloadJob }) {
  const [options, setOptions] = useState(null);

  // Core settings
  const [material, setMaterial] = useState('PLA');
  const [quality, setQuality] = useState('Standard (0.20mm)');

  // Support + brim
  const [supports, setSupports] = useState('none');
  const [supportBuildPlateOnly, setSupportBuildPlateOnly] = useState(false);
  const [brim, setBrim] = useState('no_brim');
  const [brimWidth, setBrimWidth] = useState(5);

  // Infill
  const [infillDensity, setInfillDensity] = useState(15);
  const [infillPattern, setInfillPattern] = useState('grid');

  // Wall / shell / surface
  const [wallLoops, setWallLoops] = useState(3);
  const [topShells, setTopShells] = useState(3);
  const [bottomShells, setBottomShells] = useState(3);

  // Cooling
  const [fanSpeed, setFanSpeed] = useState(100);

  // Surface & travel
  const [ironing, setIroning] = useState('no ironing');
  const [seamPosition, setSeamPosition] = useState('aligned');

  // Rotation (degrees)
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);
  const [rotZ, setRotZ] = useState(0);

  // State
  const [file, setFile] = useState(null);
  const [slicing, setSlicing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef();
  const viewerRef = useRef();

  useEffect(() => {
    fetch('/api/slicer/options').then(r => r.json()).then(d => {
      setOptions(d);
      setMaterial(d.defaults.material);
      setQuality(d.defaults.quality);
    }).catch(() => {});
  }, []);

  // Pre-fill settings when a re-slice job is loaded
  useEffect(() => {
    if (!preloadJob) return;
    const s = preloadJob.settings;
    if (s.material) setMaterial(s.material);
    if (s.quality) setQuality(s.quality);
    if (s.supports) setSupports(s.supports);
    setSupportBuildPlateOnly(!!s.supportBuildPlateOnly);
    if (s.brim) setBrim(s.brim);
    if (s.brimWidth != null) setBrimWidth(s.brimWidth);
    if (s.infillDensity != null) setInfillDensity(s.infillDensity);
    if (s.infillPattern) setInfillPattern(s.infillPattern);
    if (s.wallLoops != null) setWallLoops(s.wallLoops);
    if (s.topShells != null) setTopShells(s.topShells);
    if (s.bottomShells != null) setBottomShells(s.bottomShells);
    if (s.fanSpeed != null) setFanSpeed(s.fanSpeed);
    if (s.ironing) setIroning(s.ironing);
    if (s.seamPosition) setSeamPosition(s.seamPosition);
    setResult(null);
    setError(null);
    setFile(null);
    setRotX(0); setRotY(0); setRotZ(0);
  }, [preloadJob]);

  const handleFile = (f) => {
    if (!f) return;
    if (!/\.stl$/i.test(f.name)) { setError('Only .stl files are supported'); return; }
    setFile(f);
    setResult(null);
    setError(null);
    setRotX(0); setRotY(0); setRotZ(0);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const buildForm = (f) => {
    const form = new FormData();
    if (f) form.append('file', f);
    form.append('material', material);
    form.append('quality', quality);
    form.append('supports', supports);
    form.append('supportBuildPlateOnly', supportBuildPlateOnly ? '1' : '0');
    form.append('brim', brim);
    form.append('brimWidth', String(brimWidth));
    form.append('infillDensity', String(infillDensity));
    form.append('infillPattern', infillPattern);
    form.append('wallLoops', String(wallLoops));
    form.append('topShells', String(topShells));
    form.append('bottomShells', String(bottomShells));
    form.append('fanSpeed', String(fanSpeed));
    form.append('ironing', ironing);
    form.append('seamPosition', seamPosition);
    return form;
  };

  const runXhr = (method, url, body) => new Promise((resolve) => {
    setSlicing(true);
    setUploading(false);
    setError(null);
    setResult(null);
    const xhr = new XMLHttpRequest();
    if (method === 'POST' && body instanceof FormData && body.has('file')) {
      xhr.upload.onload = () => setUploading(true);
    }
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
    xhr.open(method, url);
    xhr.send(body);
  });

  const slice = async () => {
    if (!file && !preloadJob) return;
    if (preloadJob && !file) {
      return runXhr('POST', `/api/slicer/reslice/${preloadJob.id}`, buildForm(null));
    }
    // If rotation is applied, export the rotated geometry from the viewer and send that
    let stlToSend = file;
    if ((rotX !== 0 || rotY !== 0 || rotZ !== 0) && viewerRef.current) {
      const buffer = viewerRef.current.getTransformedSTL();
      if (buffer) {
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        stlToSend = new File([blob], file.name, { type: 'application/octet-stream' });
      }
    }
    return runXhr('POST', '/api/slicer/slice', buildForm(stlToSend));
  };

  const reset = () => { setFile(null); setResult(null); setError(null); };
  const busy = slicing || uploading;
  const canSlice = !!file || !!preloadJob;

  return (
    <div className="card">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: preloadJob ? 6 : 14 }}>
        {preloadJob ? `Re-slice: ${preloadJob.stl_name}` : 'Slice STL'}
      </div>

      {preloadJob && !file && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          Using stored STL. Drop a new STL below to slice a different file instead.
        </div>
      )}

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
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{preloadJob ? 'Drop a different STL to override' : 'Drop STL file here or click to select'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>.stl</div>
          </>
        )}
      </div>

      {/* 3D preview */}
      {file && !busy && !result && (
        <>
          <STLViewer ref={viewerRef} file={file} rotation={{ x: rotX, y: rotY, z: rotZ }} />
          <div style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Rotate model
              </span>
              {(rotX !== 0 || rotY !== 0 || rotZ !== 0) && (
                <button
                  onClick={() => { setRotX(0); setRotY(0); setRotZ(0); }}
                  style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 6px' }}
                >
                  Reset
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <RotationAxis axis="X" value={rotX} onChange={setRotX} disabled={busy} />
              <RotationAxis axis="Y" value={rotY} onChange={setRotY} disabled={busy} />
              <RotationAxis axis="Z" value={rotZ} onChange={setRotZ} disabled={busy} />
            </div>
          </div>
        </>
      )}

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

          {/* Fan speed */}
          <div style={{ gridColumn: '1 / -1' }}>
            <Label>Part cooling fan — {fanSpeed}%</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min="0" max="100" step="5"
                value={fanSpeed} onChange={e => setFanSpeed(Number(e.target.value))}
                disabled={busy} style={{ flex: 1, accentColor: fanSpeed === 0 ? 'var(--crit)' : 'var(--accent)' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 36, textAlign: 'right' }}>{fanSpeed}%</span>
            </div>
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
              <input type="number" min="2" max="20" step="1"
                value={brimWidth} onChange={e => setBrimWidth(Number(e.target.value))}
                disabled={busy} style={numStyle} />
            </div>
          )}

          {/* Support build-plate only */}
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
              <input type="range" min="0" max="100" step="5"
                value={infillDensity} onChange={e => setInfillDensity(Number(e.target.value))}
                disabled={busy} style={{ flex: 1, accentColor: 'var(--accent)' }} />
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

          {/* Divider */}
          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

          {/* Wall loops */}
          <div>
            <Label>Wall loops</Label>
            <input type="number" min="1" max="20" step="1"
              value={wallLoops} onChange={e => setWallLoops(Number(e.target.value))}
              disabled={busy} style={numStyle} />
          </div>

          {/* Seam position */}
          <div>
            <Label>Seam position</Label>
            <select value={seamPosition} onChange={e => setSeamPosition(e.target.value)} style={selectStyle} disabled={busy}>
              <option value="aligned">Aligned</option>
              <option value="back">Back</option>
              <option value="random">Random</option>
              <option value="nearest">Nearest</option>
            </select>
          </div>

          {/* Top shells */}
          <div>
            <Label>Top shell layers</Label>
            <input type="number" min="0" max="20" step="1"
              value={topShells} onChange={e => setTopShells(Number(e.target.value))}
              disabled={busy} style={numStyle} />
          </div>

          {/* Bottom shells */}
          <div>
            <Label>Bottom shell layers</Label>
            <input type="number" min="0" max="20" step="1"
              value={bottomShells} onChange={e => setBottomShells(Number(e.target.value))}
              disabled={busy} style={numStyle} />
          </div>

          {/* Ironing */}
          <div style={{ gridColumn: '1 / -1' }}>
            <Label>Ironing (top surface)</Label>
            <select value={ironing} onChange={e => setIroning(e.target.value)} style={selectStyle} disabled={busy}>
              <option value="no ironing">None</option>
              <option value="top">Top surface only</option>
              <option value="topmost">Topmost surface only</option>
              <option value="solid">All solid layers</option>
            </select>
          </div>

        </div>
      )}

      {/* Slice button */}
      {!result && (
        <button
          onClick={slice}
          disabled={!canSlice || busy}
          style={{
            width: '100%', padding: '10px 0', fontWeight: 700, fontSize: 13,
            background: canSlice && !busy ? 'var(--accent)' : 'var(--surface2)',
            color: canSlice && !busy ? '#fff' : 'var(--muted)',
            border: 'none', borderRadius: 6, cursor: canSlice && !busy ? 'pointer' : 'default',
            transition: 'background 0.15s',
          }}
        >
          {busy ? 'Slicing…' : preloadJob && !file ? 'Re-slice & Upload to Printer' : 'Slice & Upload to Printer'}
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
            <div><span style={{ color: 'var(--muted)' }}>Walls: </span>{result.wallLoops} loops · Top {result.topShells} · Bottom {result.bottomShells}</div>
            <div><span style={{ color: 'var(--muted)' }}>Fan: </span>{result.fanSpeed}% · Seam: {result.seamPosition}{result.ironing !== 'no ironing' ? ` · Ironing: ${result.ironing}` : ''}</div>
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
