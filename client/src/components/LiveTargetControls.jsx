import React, { useState } from 'react';
import { usePrinterApi } from '../printerApi.jsx';

const controls = [
  { name: 'bed', field: 'bed_target', label: 'Bed temperature', unit: '°C', step: 1 },
  { name: 'z_offset', field: 'z_offset', label: 'Z offset', unit: 'mm', step: 0.001, delta: 0.02 },
  { name: 'pressure_advance', field: 'pressure_advance', label: 'Pressure advance', step: 0.001, delta: 0.03 },
  { name: 'acceleration', field: 'max_acceleration', label: 'Acceleration limit', unit: 'mm/s²', step: 1 },
];

function LiveTarget({ control, ctx, onApplied, unlocked }) {
  const { apiFetch } = usePrinterApi();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const current = ctx[control.field];
  const limits = ctx.live_control_limits?.[control.name];
  const target = draft === '' ? NaN : Number(draft);
  const valid = limits && Number.isFinite(target) && target !== current &&
    target >= limits[0] && target <= limits[1] &&
    (!control.delta || Math.abs(target - current) <= control.delta + 0.000001);
  const apply = async event => {
    event.preventDefault();
    if (!unlocked || busy || !valid) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiFetch(`/api/printer/live-controls/${control.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target, expected: current, filename: ctx.filename, extruder: ctx.active_extruder,
          session_start: ctx.captured_at - ctx.print_total_duration_sec * 1000,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to change the setting.');
      setDraft('');
      setFeedback({ text: result.confirmed ? `Set to ${result.observed}${control.unit ? ' ' + control.unit : ''}.` : result.message });
    } catch (error) {
      setFeedback({ error: true, text: error.message });
    } finally {
      try { await onApplied(); } finally { setBusy(false); }
    }
  };
  return <form onSubmit={apply} style={{ margin: '12px 0' }}>
    <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
      {control.label}
      <input aria-label={control.label + ' target'} type="number" min={limits?.[0]} max={limits?.[1]}
        step={control.step} value={unlocked ? draft : ''} placeholder={String(current ?? '—')}
        onChange={event => setDraft(event.target.value)} disabled={!unlocked || busy || !limits}
        style={{ width: 95, marginLeft: 8 }} />
    </label>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn-ghost" type="submit" disabled={!unlocked || busy || !valid}>
        {busy ? 'Applying…' : `Apply ${control.label.toLowerCase()}`}
      </button>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
        {control.name === 'bed' && `Actual ${ctx.bed_temp ?? '—'}°C · `}
        Current {current ?? '—'} {control.unit}
        {limits && control.delta && ` · Up to ${control.delta} per change`}
      </span>
    </div>
    {!limits && <p style={{ fontSize: 12, color: 'var(--muted)' }}>
      {control.name === 'z_offset' ? 'Available when the first layer is confirmed.' : 'Waiting for supported live readings and limits.'}
    </p>}
    {feedback && <p style={{ fontSize: 12, color: feedback.error ? 'var(--crit)' : 'var(--muted)' }}
      role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
  </form>;
}

export default function LiveTargetControls({ ctx, onApplied, unlocked }) {
  return <details style={{ marginBottom: 12 }}>
    <summary>Bed and advanced print tuning</summary>
    <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Later printer or slicer commands can replace live settings.</p>
    {controls.map(control => <LiveTarget key={control.name + unlocked} control={control} ctx={ctx}
      onApplied={onApplied} unlocked={unlocked} />)}
  </details>;
}
