import React, { useEffect, useState } from 'react';
import { usePrinterApi } from '../printerApi.jsx';

const LABELS = { speed: 'Print speed', flow: 'Extrusion flow', fan: 'Part cooling fan' };
export default function DiagnosisFixes({ result, config, recent = false }) {
  const { apiFetch } = usePrinterApi();
  const [data, setData] = useState({ fixes: [], events: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const url = recent ? '/api/diagnose/fixes/recent' : `/api/diagnose/${result.id}/fixes`;
  const load = async () => {
    const r = await apiFetch(url);
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'Unable to load reviewed fixes');
    setData(body);
  };
  useEffect(() => {
    let active = true;
    setData({ fixes: [], events: [] }); setError('');
    const refresh = async () => {
      try {
        const r = await apiFetch(url);
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Unable to load reviewed fixes');
        if (active) { setData(body); setNow(Date.now()); }
      } catch (e) { if (active) setError(e.message); }
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [apiFetch, url]);

  const act = async (fix, action) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await apiFetch(`/api/diagnose/fixes/${fix.id}/${action}`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok || body.error) throw new Error(body.error || 'Unable to confirm the change');
      await load();
      if (body.confirmed && action !== 'dismiss') window.dispatchEvent(new CustomEvent('printer-controls-changed', { detail: { printerId: config.id } }));
      if (!body.confirmed && action !== 'dismiss') setError(body.message || 'Change sent but unconfirmed. Inspect the live controls.');
    } catch(e) { setError(e.message); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  return <section style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
    <h3 style={{ fontSize: 14, marginBottom: 6 }}>{recent ? 'Recent adjustments' : 'Review a suggested adjustment'}</h3>
    <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>Nothing changes automatically. Apply one small adjustment, inspect the print, then run a new diagnosis to assess it.</p>
    {data.fixes.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{recent ? 'No reviewed adjustments have been submitted yet.' : config?.model !== 'qidi' ? 'Reviewed control changes are currently supported for the QIDI only.' : 'No eligible live adjustment from this diagnosis. Follow the advice above; uploaded images, missing readings, and issues needing inspection do not offer control changes.'}</p>}
    {data.fixes.map(fix => {
      const expired = now > fix.expires_at;
      const undoExpired = !fix.applied_at || now > fix.applied_at + 600000;
      const inFlight = ['applying','undoing'].includes(fix.state);
      return <div key={fix.id} style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
        <strong>{LABELS[fix.control]}: {fix.before}% → {fix.after}%</strong>
        <p style={{ fontSize: 13, marginTop: 6 }}>{fix.reason}</p>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0' }}>At diagnosis: {fix.before}%. Proposed: {fix.after}%. Live readings and print identity are checked again before applying.</p>
        <p role="status" style={{ fontSize: 12, margin: '6px 0' }}>{busy || inFlight ? 'Checking printer and confirming change…' : fix.state === 'ready' ? expired ? 'Expired — run a new diagnosis.' : 'Ready for your review · expires after 10 minutes' : fix.state === 'applied' ? undoExpired ? 'Applied and verified. Undo has expired; use manual controls if needed.' : 'Applied and verified. Inspect the print before making another adjustment.' : fix.state === 'undone' ? 'Previous setting restored and verified.' : fix.state === 'dismissed' ? 'Unconfirmed change acknowledged. Use a fresh diagnosis for further adjustments.' : fix.message || fix.state}</p>
        {fix.state === 'ready' && <button className="btn-primary" disabled={busy || expired} onClick={() => act(fix,'apply')}>Apply fix · {LABELS[fix.control]} {fix.after}%</button>}
        {fix.state === 'applied' && <button className="btn-ghost" disabled={busy || undoExpired} onClick={() => act(fix,'undo')}>Undo · restore {fix.before}%</button>}
        {fix.state === 'unconfirmed' && <><p style={{ fontSize: 12 }}>Inspect the live controls first. Acknowledging this result sends no printer command.</p><button className="btn-ghost" disabled={busy} onClick={() => act(fix,'dismiss')}>I checked the current setting</button></>}
      </div>;
    })}
    {error && <p role="alert" style={{ fontSize: 13, color: 'var(--crit)' }}>{error}</p>}
    {data.events.length > 0 && <details style={{ marginTop: 10, fontSize: 12 }}><summary>Adjustment log</summary><ul style={{ paddingLeft: 18 }}>{data.events.map(e => <li key={e.id}>{new Date(e.timestamp).toLocaleTimeString()} · {e.action} · {e.outcome}</li>)}</ul></details>}
  </section>;
}
