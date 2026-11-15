import { usePrinterApi } from '../printerApi.jsx';
import React, { useState, useEffect, useRef } from 'react';

const time = stamp => stamp ? new Date(stamp).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : 'Not yet';
export default function AutoMonitor({ config, onConfigChange }) {
  const { apiFetch } = usePrinterApi();
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [draft, setDraft] = useState(config?.auto_interval_min || '10');
  const dirty = useRef(false);
  const savingRef = useRef(false);
  const revision = useRef(0);
  const enabled = status?.enabled ?? config?.auto_enabled === '1';
  const savedInterval = status?.interval_minutes ?? Number(config?.auto_interval_min || 10);
  const interval = Number(draft);
  const valid = /^\d+$/.test(draft) && interval >= 1 && interval <= 1440;
  const running = status?.busy === true;
  useEffect(() => { if (!dirty.current) setDraft(String(savedInterval)); }, [savedInterval]);
  const readStatus = async () => {
    const r = await apiFetch('/api/monitor');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Monitoring status unavailable');
    return data;
  };
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (savingRef.current) return;
      const version = revision.current;
      try {
        const r = await apiFetch('/api/monitor');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Monitoring status unavailable');
        if (active && version === revision.current) { setStatus(data); setConnectionError(''); }
      } catch(e) { if (active && version === revision.current) setConnectionError(`Unable to refresh monitoring status: ${e.message}`); }
    };
    poll(); const timer = setInterval(poll,5000);
    return () => { active=false; clearInterval(timer); };
  }, [apiFetch]);
  const update = async changes => {
    if (savingRef.current) return;
    savingRef.current=true; revision.current++; setSaving(true); setError('');
    try {
      const r=await apiFetch('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});
      const data=await r.json();
      if (!r.ok) throw new Error(data.error || 'Unable to save automatic monitoring');
      if (changes.auto_interval_min) { dirty.current=false; setDraft(changes.auto_interval_min); }
      await onConfigChange();
      setStatus(await readStatus());
    } catch(e) { setError(e.message); }
    finally { savingRef.current=false; setSaving(false); }
  };
  const checkNow = async () => {
    setChecking(true); setError(''); revision.current++;
    try {
      const r=await apiFetch('/api/monitor/check',{method:'POST'});
      const data=await r.json();
      if (!r.ok) throw new Error(data.error || 'Unable to start a check');
      setStatus(data);
    } catch(e) { setError(e.message); }
    finally { setChecking(false); }
  };
  const description = !status ? 'Loading monitoring status…' : {
    disabled:'Off — use Diagnose Now for manual checks.',
    finishing:'Off — the current check is finishing. No further checks will start.',
    not_configured:status.setup_error,
    waiting_for_print:'Waiting for a print. The first check starts when printing is detected.',
    checking:'Checking the printer and camera…',
    analyzing:'AI is analyzing the latest camera image…',
    scheduled:`On — checking every ${savedInterval} minute${savedInterval === 1 ? '' : 's'} while printing.`,
    error:status.last_error || 'A check failed. Use Check now to retry.',
  }[status.phase] || 'Waiting for the next check.';
  return <section className="card">
    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap' }}>
      <h3 style={{ fontSize:14 }}>Automatic monitoring</h3>
      <button type="button" role="switch" aria-label="Automatic monitoring" aria-checked={enabled}
        className={enabled ? 'btn-primary' : 'btn-ghost'} disabled={saving || (!enabled && !!status?.setup_error)}
        onClick={() => update({auto_enabled:enabled ? '0':'1'})}>{saving ? 'Saving…' : enabled ? 'Disable automatic checks' : 'Enable automatic checks'}</button>
    </div>
    <p role="status" style={{fontSize:13,marginTop:10,color:status?.phase === 'error' ? 'var(--crit)' : 'var(--muted)'}}>{description}</p>
    <p style={{fontSize:12,color:'var(--muted)',marginTop:6}}>Automatic checks diagnose the print. Suggested printer changes still require Apply fix.</p>
    <form onSubmit={e => {e.preventDefault();if(valid) update({auto_interval_min:String(interval)});}} style={{marginTop:14}}>
      <label htmlFor={`monitor-interval-${config.id}`}>Check interval (minutes)</label>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:6}}>
        <input id={`monitor-interval-${config.id}`} type="number" min="1" max="1440" step="1" value={draft} disabled={saving}
          onChange={e=>{dirty.current=true;setDraft(e.target.value);}} style={{width:95}}/>
        <button className="btn-ghost" disabled={saving || !valid || interval === savedInterval} type="submit">Save interval</button>
        <button className="btn-ghost" disabled={saving || checking || !enabled || running || !!status?.setup_error} type="button" onClick={checkNow}>{running || checking ? 'Check in progress…' : 'Check now'}</button>
      </div>
      {dirty.current && interval !== savedInterval && <p style={{fontSize:12,color:'var(--muted)',marginTop:5}}>{valid ? `Unsaved. Currently checking every ${savedInterval} min.` : 'Enter a whole number from 1 to 1440 minutes.'}</p>}
    </form>
    <div style={{fontSize:12,color:'var(--muted)',marginTop:12,lineHeight:1.7}}>
      <p>Last successful check: {time(status?.last_success_at || status?.latest_diagnosis?.timestamp)}</p>
      {enabled && status?.next_check_at && !running && <p>Next scheduled check: {time(status.next_check_at)}</p>}
      {status?.latest_diagnosis && <p>Latest saved result: <strong>{status.latest_diagnosis.severity}</strong> · {time(status.latest_diagnosis.timestamp)}. Review it in this printer’s AI Diagnosis panel.</p>}
    </div>
    {(error || connectionError) && <p role="alert" style={{fontSize:13,color:'var(--crit)',marginTop:8}}>{error || connectionError}</p>}
  </section>;
}
