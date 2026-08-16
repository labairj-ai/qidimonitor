import React, { useState, useRef } from 'react';

const SEVERITY_COLORS = { ok: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)' };
const ISSUE_LABELS = {
  stringing: 'Stringing',
  layer_delamination: 'Layer Delamination',
  warping: 'Warping',
  under_extrusion: 'Under-Extrusion',
  over_extrusion: 'Over-Extrusion',
  elephant_foot: 'Elephant Foot',
  ghosting: 'Ghosting/Ringing',
  spaghetti: 'Spaghetti Failure',
  blob_zit: 'Blob/Zit',
  bed_adhesion: 'Bed Adhesion',
  ok: 'Healthy Print',
};

function SeverityChip({ sev }) {
  const cls = sev === 'ok' ? 'chip chip-ok' : sev === 'warning' ? 'chip chip-warning' : 'chip chip-critical';
  return <span className={cls}>{sev}</span>;
}

export default function DiagnosePanel({ config, onResult, latestResult }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileRef = useRef();

  const diagnose = async (file) => {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      if (file) fd.append('image', file);
      const r = await fetch('/api/diagnose', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Diagnosis failed');
      onResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    diagnose(file);
  };

  const result = latestResult;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>AI Diagnosis</div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          onClick={() => diagnose(null)}
          disabled={loading || (!config?.printer_ip && !config?.camera_url)}
        >
          {loading ? 'Analyzing…' : 'Diagnose Now'}
        </button>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={loading}>
          Upload Image
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      </div>

      {!config?.printer_ip && !config?.camera_url && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          "Diagnose Now" requires the printer camera. Configure the printer IP in Settings, or upload a photo manually.
        </p>
      )}

      {error && <p style={{ color: 'var(--crit)', fontSize: 13 }}>{error}</p>}

      {/* Preview */}
      {previewUrl && (
        <img src={previewUrl} alt="Upload preview" style={{ borderRadius: 6, maxHeight: 180, objectFit: 'contain', background: '#000' }} />
      )}

      {/* Result */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: SEVERITY_COLORS[result.overall_severity] }}>
              {result.overall_severity === 'ok' ? 'Print looks good' :
               result.overall_severity === 'warning' ? 'Issues detected' : 'Critical issues'}
            </span>
            <SeverityChip sev={result.overall_severity} />
          </div>

          {result.summary && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>{result.summary}</p>
          )}

          {result.issues?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.issues.map((issue, i) => (
                <div key={i} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', borderLeft: `3px solid ${SEVERITY_COLORS[issue.severity === 'severe' ? 'critical' : issue.severity === 'moderate' ? 'warning' : 'ok']}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{ISSUE_LABELS[issue.category] || issue.category}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{issue.severity}</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--muted)' }}>{issue.suggestion}</p>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {new Date(result.timestamp).toLocaleString()}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
          Click "Diagnose Now" to capture and analyze the current print
        </div>
      )}
    </div>
  );
}
