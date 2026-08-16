import React, { useState, useEffect } from 'react';

const SEV_COLORS = { ok: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)' };

export default function History() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(data => { setRecords(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  if (!records.length) return <p style={{ color: 'var(--muted)' }}>No diagnoses yet. Run your first diagnosis from the Monitor tab.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700 }}>Diagnosis History</span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{records.length} records</span>
      </div>

      {records.map(r => (
        <div
          key={r.id}
          className="card"
          style={{ cursor: 'pointer', borderLeft: `3px solid ${SEV_COLORS[r.overall_severity] || 'var(--border)'}` }}
          onClick={() => setExpanded(expanded === r.id ? null : r.id)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: SEV_COLORS[r.overall_severity] }}>
                  {r.overall_severity === 'ok' ? 'OK' : r.overall_severity === 'warning' ? 'Warning' : 'Critical'}
                </span>
                {r.auto_triggered && <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>auto</span>}
                {r.print_file && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.print_file}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {new Date(r.timestamp).toLocaleString()}
              </div>
            </div>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>{expanded === r.id ? '▲' : '▼'}</span>
          </div>

          {expanded === r.id && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              {r.issues?.length > 0 ? (
                r.issues.map((issue, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{issue.category}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{issue.severity}</span>
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{issue.suggestion}</p>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 13, color: 'var(--ok)' }}>No issues detected</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
