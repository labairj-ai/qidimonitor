import React, { useState, useEffect } from 'react';

export default function AutoMonitor({ config, onConfigChange }) {
  const [saving, setSaving] = useState(false);
  const enabled = config?.auto_enabled === '1';
  const interval = parseInt(config?.auto_interval_min) || 10;

  const toggle = async () => {
    setSaving(true);
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_enabled: enabled ? '0' : '1' }),
    });
    await onConfigChange();
    setSaving(false);
  };

  const setInterval_ = async (val) => {
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_interval_min: String(val) }),
    });
    await onConfigChange();
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Auto-Monitor</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
            {enabled
              ? `Diagnosing every ${interval} min while printing`
              : 'Disabled — manual diagnose only'}
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={saving}
          className={enabled ? 'btn-primary' : 'btn-ghost'}
          style={{ padding: '6px 14px', minWidth: 80 }}
        >
          {enabled ? 'On' : 'Off'}
        </button>
      </div>

      {enabled && (
        <div style={{ marginTop: 14 }}>
          <label>Check interval (minutes)</label>
          <input
            type="range"
            min={2}
            max={60}
            step={1}
            value={interval}
            onChange={e => setInterval_(e.target.value)}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            <span>2 min</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{interval} min</span>
            <span>60 min</span>
          </div>
        </div>
      )}
    </div>
  );
}
