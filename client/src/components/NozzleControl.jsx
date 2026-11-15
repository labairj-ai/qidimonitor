import React, { useEffect, useRef, useState } from 'react';
import { usePrinterApi } from '../printerApi.jsx';

export default function NozzleControl({ config, ctx, onApplied }) {
  const { apiFetch } = usePrinterApi();
  const [target, setTarget] = useState(String(ctx.nozzle_target ?? ''));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const sending = useRef(false);
  useEffect(() => { if (!dirty.current) setTarget(String(ctx.nozzle_target ?? '')); }, [ctx.nozzle_target]);
  const cfg = ctx.printer_config;
  const limitsKnown = Number.isFinite(cfg?.nozzle_min_temp) && Number.isFinite(cfg?.nozzle_max_temp) && Number.isFinite(cfg?.min_extrude_temp);
  const min = limitsKnown ? Math.max(180,cfg.nozzle_min_temp+5,cfg.min_extrude_temp+5) : 180;
  const max = limitsKnown ? Math.min(300,cfg.nozzle_max_temp-5) : 300;
  const value = target.trim() ? Number(target) : NaN;
  const valid = limitsKnown && Number.isInteger(value) && value >= min && value <= max;
  const apply = async e => {
    e.preventDefault();
    if (sending.current || !valid) return;
    sending.current = true; setBusy(true); setMessage(''); setError('');
    try {
      const r = await apiFetch('/api/printer/nozzle', { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ target:value, expected_target:ctx.nozzle_target, extruder:ctx.active_extruder, filename:ctx.filename }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Unable to set the nozzle target');
      dirty.current = false;
      setMessage(data.confirmed ? `Target set to ${data.observed}°C. Allow the actual temperature to settle.` : data.message || 'Target change is unconfirmed. Check the live target before trying again.');
    } catch(e) { setError(e.message); }
    finally { await onApplied(); sending.current = false; setBusy(false); }
  };
  return <form onSubmit={apply} style={{ marginBottom:14, borderTop:'1px solid var(--border)', paddingTop:12 }}>
    <label htmlFor={`nozzle-target-${config.id}`}>Nozzle temperature</label>
    <p style={{ color:'var(--muted)', fontSize:12, margin:'5px 0' }}>Actual {ctx.nozzle_temp ?? '—'}°C · Current target {ctx.nozzle_target ?? '—'}°C</p>
    <div style={{ display:'flex',gap:8,alignItems:'center' }}>
      <input id={`nozzle-target-${config.id}`} type="number" min={min} max={max} step="1" value={target} disabled={busy || !limitsKnown}
        onChange={e => { dirty.current=true; setTarget(e.target.value); setMessage(''); }} style={{ width:100 }}/>
      <span>°C</span><button className="btn-primary" type="submit" disabled={busy || !valid || value === ctx.nozzle_target}>{busy ? 'Setting target…' : 'Apply temperature'}</button>
    </div>
    <p style={{ color:'var(--muted)', fontSize:12, marginTop:6 }}>{limitsKnown ? `Allowed ${min}–${max}°C.` : 'Waiting for nozzle heater limits.'}{ctx.material_profile?.nozzle && ` ${ctx.filament_type} reference: ${ctx.material_profile.nozzle.min}–${ctx.material_profile.nozzle.max}°C; follow your filament manufacturer's settings.`} Changes apply only when you click Apply temperature.</p>
    {message && <p role="status" style={{ fontSize:12,marginTop:6 }}>{message}</p>}
    {error && <p role="alert" style={{ fontSize:12,color:'var(--crit)',marginTop:6 }}>{error}</p>}
  </form>;
}
