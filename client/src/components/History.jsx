import React, { useState, useEffect } from 'react';

const SEV_COLORS = { ok: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)' };

function ContextRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', minWidth: 140 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PrinterContextPanel({ ctx }) {
  if (!ctx) return null;
  const pc = ctx.printer_config;
  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Printer State at Diagnosis
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 32px' }}>
        <ContextRow label="Print state" value={ctx.print_state} />
        <ContextRow label="Progress" value={ctx.progress_pct != null ? `${ctx.progress_pct}%` : null} />
        <ContextRow label="Duration" value={ctx.print_duration_min != null ? `${ctx.print_duration_min} min` : null} />
        <ContextRow label="Z height" value={ctx.z_mm != null ? `${ctx.z_mm}mm` : null} />
        <ContextRow label="Nozzle temp" value={ctx.nozzle_temp != null ? `${ctx.nozzle_temp}°C → ${ctx.nozzle_target}°C target` : null} />
        <ContextRow label="Bed temp" value={ctx.bed_temp != null ? `${ctx.bed_temp}°C → ${ctx.bed_target}°C target` : null} />
        <ContextRow label="Chamber temp" value={ctx.chamber_temp != null ? `${ctx.chamber_temp}°C → ${ctx.chamber_target}°C target` : null} />
        <ContextRow label="Part cooling fan" value={ctx.fan_pct != null ? `${ctx.fan_pct}%` : null} />
        <ContextRow label="Speed override" value={ctx.speed_factor_pct != null && ctx.speed_factor_pct !== 100 ? `${ctx.speed_factor_pct}%` : null} />
        <ContextRow label="Flow override" value={ctx.flow_pct != null && ctx.flow_pct !== 100 ? `${ctx.flow_pct}%` : null} />
        <ContextRow label="Pressure advance" value={ctx.pressure_advance} />
        <ContextRow label="Layer height" value={ctx.layer_height ? `${ctx.layer_height}mm` : null} />
        <ContextRow label="Filament type" value={ctx.filament_type} />
        <ContextRow label="Slicer" value={ctx.slicer} />
        {pc && <>
          <ContextRow label="Nozzle diameter" value={pc.nozzle_diameter ? `${pc.nozzle_diameter}mm` : null} />
          <ContextRow label="Max velocity" value={pc.max_velocity ? `${pc.max_velocity}mm/s` : null} />
          <ContextRow label="Max accel" value={pc.max_accel ? `${pc.max_accel}mm/s²` : null} />
          <ContextRow label="Kinematics" value={pc.kinematics} />
          <ContextRow label="Input shaper X" value={pc.input_shaper_x} />
          <ContextRow label="Input shaper Y" value={pc.input_shaper_y} />
        </>}
        {ctx.filament_detected === false && (
          <div style={{ fontSize: 12, color: 'var(--crit)', fontWeight: 600, marginTop: 4 }}>
            ⚠ Filament runout detected at time of diagnosis
          </div>
        )}
      </div>
    </div>
  );
}

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
                {r.printer_context?.z_mm != null && <span style={{ marginLeft: 8 }}>Z {r.printer_context.z_mm}mm</span>}
                {r.printer_context?.nozzle_temp != null && <span style={{ marginLeft: 8 }}>🌡 {r.printer_context.nozzle_temp}°</span>}
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
              <PrinterContextPanel ctx={r.printer_context} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
