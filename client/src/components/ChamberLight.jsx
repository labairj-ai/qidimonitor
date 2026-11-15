import React, { useEffect, useRef, useState } from 'react';
import { usePrinterApi } from '../printerApi.jsx';

export default function ChamberLight({ config }) {
  const { apiFetch } = usePrinterApi();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const revision = useRef(0);
  const pending = useRef(null);
  const pendingUntil = useRef(0);
  const configured = !!(config?.printer_ip || config?.moonraker_url);
  const locked = config?.model === 'u1' && config.controls_enabled !== '1';

  useEffect(() => {
    let active = true;
    setState(null); setError('');
    if (!configured) return;
    const poll = async () => {
      if (changing.current) return;
      const version = revision.current;
      try {
        const r = await apiFetch('/api/printer/light');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Unable to read chamber light');
        if (active && version === revision.current && !changing.current) {
          setState(data);
          if (pending.current !== null && Date.now() > pendingUntil.current) {
            pending.current = null; setBusy(false); setError('Light change is still unconfirmed. Current printer state is shown; you can try again.');
            return;
          }
          if (pending.current === null || data.on === pending.current) { pending.current = null; setBusy(false); setError(''); }
        }
      } catch (e) { if (active && version === revision.current && !changing.current) { setError(e.message); } }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [apiFetch, configured, config?.printer_ip, config?.moonraker_url]);

  const toggle = async () => {
    if (changing.current || busy || !state?.supported) return;
    changing.current = true; revision.current += 1;
    const desired = !state.on;
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/printer/light', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: desired }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Unable to change chamber light');
      if (data.pending) { pending.current = desired; pendingUntil.current = Date.now() + 30000; }
      else { pending.current = null; setState({ supported: true, on: data.on }); }
    } catch (e) { pending.current = null; setError(e.message); }
    finally { changing.current = false; if (pending.current === null) setBusy(false); }
  };

  return <section className="card" style={{ marginBottom: 16 }}>
    <h3 style={{ marginBottom: 8 }}>Chamber light</h3>
    <p style={{ color: 'var(--muted)', marginBottom: 12 }}>
      {!configured ? 'Save a printer address to control its light.' : locked ? 'Enable controls after verifying this printer to switch its light.' : state?.supported === false ? 'This printer does not expose a supported chamber light.' : state ? `Light is ${state.on ? 'on' : 'off'}.` : error ? 'Light state unavailable.' : 'Checking light…'}
    </p>
    <button className="btn-primary" role="switch" aria-label="Chamber light" aria-checked={state?.on === true}
      disabled={!state?.supported || busy || locked} onClick={toggle}>
      {busy ? 'Updating…' : state?.on ? 'Turn off' : 'Turn on'}
    </button>
    {error && <p role="alert" style={{ color: 'var(--crit)', marginTop: 8 }}>{error}</p>}
  </section>;
}
