import React, { useState, useEffect, useCallback } from 'react';

function TempGauge({ label, actual, target }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: actual > 40 ? 'var(--warn)' : 'var(--text)' }}>
        {actual != null ? `${Math.round(actual)}°` : '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      {target > 0 && <div style={{ fontSize: 11, color: 'var(--accent)' }}>→ {Math.round(target)}°</div>}
    </div>
  );
}

const STATE_COLORS = {
  printing: 'var(--ok)',
  paused: 'var(--warn)',
  error: 'var(--crit)',
  standby: 'var(--muted)',
  complete: 'var(--accent)',
};

export default function PrintStatus({ config, onPrinterFound }) {
  const [status, setStatus] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [foundIp, setFoundIp] = useState(null);

  const poll = useCallback(async () => {
    if (!config?.printer_ip && !config?.moonraker_url) return;
    try {
      const [statusRes, ctxRes] = await Promise.all([
        fetch('/api/printer/status'),
        fetch('/api/printer/context'),
      ]);
      if (!statusRes.ok) throw new Error(await statusRes.text());
      setStatus(await statusRes.json());
      if (ctxRes.ok) setCtx(await ctxRes.json());
      setError(null);
      setFoundIp(null);
    } catch (e) {
      setError(e.message);
      setCtx(null);
    }
  }, [config?.printer_ip, config?.moonraker_url]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [poll]);

  const runDiscovery = async () => {
    setDiscovering(true);
    setFoundIp(null);
    try {
      const r = await fetch('/api/printer/discover', { method: 'POST' });
      const data = await r.json();
      if (data.status === 'found') {
        setFoundIp(data.ip);
        setError(null);
        onPrinterFound?.();
        setTimeout(poll, 500);
      }
    } catch (e) {
      // silent
    } finally {
      setDiscovering(false);
    }
  };

  const stats = status?.print_stats;
  const extruder = status?.extruder;
  const bed = status?.heater_bed;
  const display = status?.display_status;
  const progressPct = display?.progress != null ? Math.round(display.progress * 100) : null;
  const state = stats?.state || 'unknown';

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Printer Status</span>
        {state !== 'unknown' && (
          <span style={{ fontSize: 12, fontWeight: 700, color: STATE_COLORS[state] || 'var(--muted)', textTransform: 'uppercase' }}>
            ● {state}
          </span>
        )}
      </div>

      {!config?.printer_ip && !config?.moonraker_url ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Configure printer IP in Settings</p>
      ) : error ? (
        <div>
          {foundIp ? (
            <p style={{ color: 'var(--ok)', fontSize: 13 }}>Found at {foundIp} — reconnecting…</p>
          ) : discovering ? (
            <p style={{ color: 'var(--accent)', fontSize: 13 }}>Scanning network for printer…</p>
          ) : (
            <>
              <p style={{ color: 'var(--crit)', fontSize: 13, marginBottom: 10 }}>Printer unreachable</p>
              <button
                onClick={runDiscovery}
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Find Printer
              </button>
            </>
          )}
        </div>
      ) : !status ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Connecting…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 14 }}>
            <TempGauge label="Nozzle" actual={extruder?.temperature} target={extruder?.target} />
            <TempGauge label="Bed" actual={bed?.temperature} target={bed?.target} />
            {ctx?.chamber_temp != null && (
              <TempGauge label="Chamber" actual={ctx.chamber_temp} target={ctx.chamber_target} />
            )}
          </div>

          {/* Material profile + deviations */}
          {ctx?.filament_type && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ background: 'var(--surface2)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                {ctx.filament_type}
              </span>
              {ctx.material_profile && (
                <span>
                  Nozzle {ctx.material_profile.nozzle.min}–{ctx.material_profile.nozzle.max}°C &middot; Bed {ctx.material_profile.bed.min}–{ctx.material_profile.bed.max}°C &middot; Fan {ctx.material_profile.cooling}
                </span>
              )}
            </div>
          )}
          {ctx?.deviations?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {ctx.deviations.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--warn)', background: 'rgba(255,180,0,0.08)', borderRadius: 4, padding: '4px 8px', marginBottom: 4 }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}

          {ctx?.fan_pct != null && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'flex', gap: 16 }}>
              <span>Fan {ctx.fan_pct}%</span>
              {ctx.speed_factor_pct != null && ctx.speed_factor_pct !== 100 && <span>Speed {ctx.speed_factor_pct}%</span>}
              {ctx.flow_pct != null && ctx.flow_pct !== 100 && <span>Flow {ctx.flow_pct}%</span>}
              {ctx.z_mm != null && <span>Z {ctx.z_mm}mm</span>}
            </div>
          )}

          {progressPct != null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                <span>{stats?.filename || 'Unknown file'}</span>
                <span>{progressPct}%</span>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 4, height: 6 }}>
                <div style={{ background: 'var(--accent)', width: `${progressPct}%`, height: '100%', borderRadius: 4, transition: 'width 0.5s' }} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
