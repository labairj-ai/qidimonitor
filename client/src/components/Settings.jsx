import ChamberLight from './ChamberLight.jsx';
import { usePrinterApi } from '../printerApi.jsx';
import React, { useState, useEffect } from 'react';

const FIELDS = [
  { key: 'name', label: 'Printer name', placeholder: 'Printer name', hint: 'Shown on the dashboard and controls' },
  { key: 'camera_stream_url', label: 'Camera stream URL', placeholder: 'http://printer/webcam/?action=stream', hint: 'Use the camera stream address reported by this printer' },
  { key: 'printer_ip', label: 'Printer IP Address', placeholder: '192.168.4.x', hint: 'Local IP or hostname of this printer' },
  { key: 'camera_url', label: 'Camera Snapshot URL (optional override)', placeholder: 'http://192.168.4.x/webcam/?action=snapshot', hint: 'QIDI defaults are derived from its IP; for U1 cameras enter the URL reported by the connection check' },
  { key: 'moonraker_url', label: 'Moonraker API URL (optional override)', placeholder: 'http://192.168.4.x:7125', hint: 'Leave blank for port 7125, or enter the API URL supplied by your printer' },
  { key: 'ollama_url', label: 'Ollama URL', placeholder: 'http://100.73.128.40:11434', hint: 'Ollama server running a vision-capable model (used for image diagnosis)' },
  { key: 'ollama_model', label: 'Ollama Vision Model', placeholder: 'llava:13b', hint: 'Must support image inputs. Options: llava:13b, qwen2.5-vl:7b' },
  { key: 'chat_llm_url', label: 'Chat LLM URL', placeholder: 'http://100.73.128.40:8080', hint: 'OpenAI-compatible server for AI chat follow-up (MLX, Ollama, etc.)' },
  { key: 'chat_llm_model', label: 'Chat LLM Model', placeholder: 'mlx-community/Llama-3.3-70B-Instruct-4bit', hint: 'Text model for post-diagnosis chat — does not need vision support' },
];

export default function Settings({ config, onSave }) {
  const { apiFetch } = usePrinterApi();
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [connection, setConnection] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const r = await apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries([...FIELDS.map(f=>f.key),...(config?.model==='u1'?['controls_enabled']:[])].map(key=>[key,form[key] || '']))),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Save failed');
      setError('');
      setConnection(null);
      await onSave();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch(e) { setError(e.message); } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true); setConnection(null); setError('');
    try {
      const r = await fetch(`/api/printers/${config.id}/test`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setConnection(data);
    } catch(e) { setError(e.message); } finally { setTesting(false); }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Settings</h2>

      <ChamberLight config={config}/>

      {config?.model === 'u1' && <div className="card setup-card" style={{ marginBottom: 16 }}><h3>U1 arrival checklist</h3><p>Connect the printer to your local network. Save its address below, then test the saved connection. Verify the reported hostname and copy the camera URLs before enabling controls. Monitoring works with controls disabled.</p></div>}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {FIELDS.map(f => (
          <div key={f.key}>
            <label>{f.label}</label>
            <input
              value={form[f.key] || ''}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
            />
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{f.hint}</p>
          </div>
        ))}

        {config?.model === 'u1' && <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input style={{ width: 'auto' }} type="checkbox" checked={form.controls_enabled === '1'} onChange={e => setForm(prev => ({ ...prev, controls_enabled: e.target.checked ? '1' : '0' }))}/>Enable uploads and print controls for this U1 after verifying its identity</label>}
        {error && <p role="alert" style={{ color: 'var(--crit)' }}>{error}</p>}
        {connection && <div className="connection-result"><strong>Connected: {connection.hostname}</strong><p>State: {connection.state}</p><p>{connection.note}</p>{connection.webcams.map((c,i) => <div key={i}><strong>{c.name || 'Camera'}</strong><p>Snapshot: {c.snapshot_url || 'Not reported'}</p><p>Stream: {c.stream_url || 'Not reported'}</p><button className="btn-ghost" onClick={() => setForm(prev => ({ ...prev, camera_url: c.snapshot_url || '', camera_stream_url: c.stream_url || '' }))}>Use this camera</button><p>Save Settings to apply.</p></div>)}</div>}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          <button className="btn-ghost" onClick={testConnection} disabled={testing || saving}>{testing ? 'Checking…' : 'Test saved connection'}</button>
          {saved && <span style={{ color: 'var(--ok)', fontSize: 13 }}>Saved!</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
        <p style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Camera connection hints</p>
        <p>Try these URLs for your printer (replace with your printer IP):</p>
        <ul style={{ marginTop: 6, marginLeft: 18 }}>
          <li><code>http://PRINTER_IP/webcam/?action=snapshot</code> — snapshot (most common)</li>
          <li><code>http://PRINTER_IP/webcam/?action=stream</code> — MJPEG stream</li>
          <li><code>http://PRINTER_IP:4408</code> — alternate camera port</li>
          <li><code>http://PRINTER_IP:7125</code> — Moonraker API port</li>
        </ul>
        <p style={{ marginTop: 10, fontWeight: 700, color: 'var(--text)' }}>Ollama Vision Model</p>
        <p>Default: <code>ollama pull qwen2.5vl:7b</code></p>
        <p>Higher accuracy: <code>ollama pull qwen2.5vl:32b</code></p>
      </div>
    </div>
  );
}
