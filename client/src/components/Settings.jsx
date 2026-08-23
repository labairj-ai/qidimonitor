import React, { useState, useEffect } from 'react';

const FIELDS = [
  { key: 'printer_ip', label: 'Printer IP Address', placeholder: '192.168.4.x', hint: 'Local IP of your QIDI X-Plus 3' },
  { key: 'camera_url', label: 'Camera Snapshot URL (optional override)', placeholder: 'http://192.168.4.x/webcam/?action=snapshot', hint: 'Leave blank to auto-derive from printer IP' },
  { key: 'moonraker_url', label: 'Moonraker API URL (optional override)', placeholder: 'http://192.168.4.x:7125', hint: 'Leave blank to auto-derive from printer IP' },
  { key: 'ollama_url', label: 'Ollama URL', placeholder: 'http://100.73.128.40:11434', hint: 'Ollama server running a vision-capable model (used for image diagnosis)' },
  { key: 'ollama_model', label: 'Ollama Vision Model', placeholder: 'llava:13b', hint: 'Must support image inputs. Options: llava:13b, qwen2.5-vl:7b' },
  { key: 'chat_llm_url', label: 'Chat LLM URL', placeholder: 'http://100.73.128.40:8080', hint: 'OpenAI-compatible server for AI chat follow-up (MLX, Ollama, etc.)' },
  { key: 'chat_llm_model', label: 'Chat LLM Model', placeholder: 'mlx-community/Llama-3.3-70B-Instruct-4bit', hint: 'Text model for post-diagnosis chat — does not need vision support' },
];

export default function Settings({ config, onSave }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await onSave();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Settings</h2>

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

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && <span style={{ color: 'var(--ok)', fontSize: 13 }}>Saved!</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
        <p style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>QIDI X-Plus 3 Camera URLs</p>
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
