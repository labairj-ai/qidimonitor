import { belongsToPrint } from '../diagnosisSession.mjs';
import DiagnosisFixes from './DiagnosisFixes.jsx';
import History from './History.jsx';
import { usePrinterApi } from '../printerApi.jsx';
import React, { useState, useRef, useEffect } from 'react';

const SEVERITY_COLORS = { ok: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)' };
const ISSUE_LABELS = {
  bed_temperature: 'Bed temperature',
  stringing: 'Stringing',
  layer_delamination: 'Layer Delamination',
  warping: 'Warping',
  under_extrusion: 'Under-Extrusion',
  over_extrusion: 'Over-Extrusion',
  elephant_foot: 'Elephant Foot',
  ghosting: 'Ghosting/Ringing',
  spaghetti: 'Spaghetti Failure',
  blob_zit: 'Blob/Zit',
  bed_adhesion: 'Bed Adhesion',
  ok: 'Healthy Print',
};

function SeverityChip({ sev }) {
  const cls = sev === 'ok' ? 'chip chip-ok' : sev === 'warning' ? 'chip chip-warning' : 'chip chip-critical';
  return <span className={cls}>{sev}</span>;
}

function ChatBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '85%', padding: '8px 12px', borderRadius: isUser ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
        background: isUser ? 'var(--accent)' : 'var(--surface2)',
        color: isUser ? '#fff' : 'var(--text)',
        fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  );
}

function DiagnosisChat({ result }) {
  const { apiFetch } = usePrinterApi();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef();
  const inputRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);
    const newMsg = { role: 'user', content: text };
    const updated = [...messages, newMsg];
    setMessages([...updated, { role: 'assistant', content: '' }]);
    setLoading(true);
    try {
      const r = await apiFetch('/api/diagnose/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updated,
          context: {
            overall_severity: result.overall_severity,
            summary: result.summary,
            issues: result.issues,
            printer_context: result.printer_context,
            followup:result.followup,
            print_file: result.print_file,
          },
        }),
      });

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { streamDone = true; break; }
          try {
            const obj = JSON.parse(payload);
            if (obj.error) throw new Error(obj.error);
            if (obj.token) {
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: 'assistant', content: copy[copy.length - 1].content + obj.token };
                return copy;
              });
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    } catch (e) {
      setError(e.message);
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const suggestions = [
    'Was this a settings issue?',
    'Could the filament be the cause?',
    'How do I prevent this next time?',
    'Is it safe to keep printing?',
  ];

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Discuss with AI
      </div>

      {/* Suggestion chips (only when no messages yet) */}
      {messages.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 20,
                border: '1px solid var(--border)', background: 'var(--surface2)',
                color: 'var(--muted)', cursor: 'pointer',
              }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Message thread */}
      {messages.length > 0 && (
        <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 10, paddingRight: 2 }}>
          {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
          {loading && messages[messages.length - 1]?.content === '' && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
              <div style={{ padding: '8px 14px', borderRadius: '12px 12px 12px 3px', background: 'var(--surface2)', fontSize: 13, color: 'var(--muted)' }}>
                <span style={{ animation: 'pulse 1s infinite' }}>●</span>
                <span style={{ animation: 'pulse 1s 0.3s infinite', marginLeft: 3 }}>●</span>
                <span style={{ animation: 'pulse 1s 0.6s infinite', marginLeft: 3 }}>●</span>
                <style>{`@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }`}</style>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: 'var(--crit)', marginBottom: 8 }}>{error}</p>}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about this diagnosis… (Enter to send)"
          rows={2}
          disabled={loading}
          style={{
            flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 13,
            resize: 'none', fontFamily: 'inherit', lineHeight: 1.4,
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          style={{
            padding: '0 14px', background: input.trim() && !loading ? 'var(--accent)' : 'var(--surface2)',
            color: input.trim() && !loading ? '#fff' : 'var(--muted)',
            border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
            cursor: input.trim() && !loading ? 'pointer' : 'default', transition: 'background 0.15s',
            alignSelf: 'stretch',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function DiagnosePanel({ config, onResult, latestResult }) {
  const { apiFetch } = usePrinterApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileRef = useRef();
  const contextRef = useRef(null);
  const [printContext, setPrintContext] = useState(null);
  const latestRef = useRef(latestResult);
  const loadingRef = useRef(loading);
  latestRef.current = latestResult; loadingRef.current = loading;
  useEffect(() => {
    let active = true;
    const refreshContext = async () => {
      try {
        const r = await apiFetch('/api/printer/context');
        if (!r.ok) return;
        const ctx = await r.json();
        if (!active || !ctx?.captured_at) return;
        contextRef.current = ctx;
        setPrintContext(ctx);
        if (latestRef.current && !belongsToPrint(latestRef.current, ctx)) {
          latestRef.current = null;
          onResult(null);
          setPreviewUrl(null);
          setError(null);
        }
      } catch { /* Retain the last known session during connection failures. */ }
    };
    const refresh = async () => {
      try {
        await refreshContext();
        const r = await apiFetch('/api/history?limit=1');
        if (!r.ok) return;
        const rows = await r.json();
        const latest = rows[0];
        if (!active || loadingRef.current || !latest || !belongsToPrint(latest, contextRef.current) || (latestRef.current && new Date(latest.timestamp) <= new Date(latestRef.current.timestamp))) return;
        let parsed = {}; try { parsed = JSON.parse(latest.raw_response || '{}'); } catch {}
        onResult({ ...latest, summary: parsed?.summary || '' });
      } catch { /* Keep the current diagnosis when polling is unavailable. */ }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    const contextTimer = setInterval(refreshContext, 5000);
    return () => { active = false; clearInterval(timer); clearInterval(contextTimer); };
  }, [apiFetch, onResult]);


  const diagnose = async (file) => {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      if (file) fd.append('image', file);
      const r = await apiFetch('/api/diagnose', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Diagnosis failed');
      if (belongsToPrint(data, contextRef.current)) onResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    diagnose(file);
  };

  const result = latestResult;

  return (
    <div className="stack">
      <div className="card">
        <DiagnosisFixes recent config={config} printContext={printContext} />
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>AI Diagnosis</div>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>Nozzle and flow fixes can auto-apply when enabled in Automatic monitoring. Speed and fan changes require Apply fix.</p>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-primary"
            style={{ flex: 1 }}
            onClick={() => diagnose(null)}
            disabled={loading || (!config?.printer_ip && !config?.camera_url)}
          >
            {loading ? 'Analyzing…' : 'Diagnose Now'}
          </button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={loading}>
            Upload Image
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        </div>

        {!config?.printer_ip && !config?.camera_url && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            "Diagnose Now" requires the printer camera. Configure the printer IP in Settings, or upload a photo manually.
          </p>
        )}

        {error && <p style={{ color: 'var(--crit)', fontSize: 13 }}>{error}</p>}

        {previewUrl && (
          <img src={previewUrl} alt="Upload preview" style={{ borderRadius: 6, maxHeight: 180, objectFit: 'contain', background: '#000' }} />
        )}

        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: result.followup && !result.issues?.length ? 'var(--muted)' : SEVERITY_COLORS[result.overall_severity] }}>
                {result.printer_context?.print_reference?.inconclusive ? 'Inconclusive camera view' : result.followup && !result.issues?.length ? 'Follow-up: no confirmed new issues' : result.overall_severity === 'ok' ? 'Print looks good' :
                 result.overall_severity === 'warning' ? 'Issues detected' : 'Critical issues'}
              </span>
              {!result.printer_context?.print_reference?.inconclusive && !(result.followup && !result.issues?.length) && <SeverityChip sev={result.overall_severity} />}
            </div>

            {result.printer_context?.print_reference && (
              <p style={{ color: 'var(--muted)', fontSize: 12 }}>
                {result.printer_context.print_reference.status === 'used'
                  ? `Compared with active G-code through Z ${result.printer_context.print_reference.z_mm.toFixed(2)} mm`
                  : result.printer_context.print_reference.status === 'preparing'
                    ? 'Downloading G-code for a future comparison'
                    : 'Print geometry reference unavailable'}
              </p>
            )}
            {result.followup && <div className="card" style={{fontSize:13}}><strong>Follow-up after correction</strong><p>{result.followup.note}</p><p style={{color:'var(--muted)',marginTop:6}}>Previously corrected: {result.followup.categories.map(c=>ISSUE_LABELS[c] || c).join(', ')}. Existing marks are excluded from new-issue findings.</p></div>}
            {result.summary && (!result.followup || result.issues?.length > 0) && (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>{result.summary}</p>
            )}

            {result.issues?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.issues.map((issue, i) => {
                  const borderColor = issue.severity === 'severe' ? 'var(--crit)' : issue.severity === 'moderate' ? 'var(--warn)' : 'var(--ok)';
                  return (
                    <div key={i} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', borderLeft: `3px solid ${borderColor}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{ISSUE_LABELS[issue.category] || issue.category}</span>
                        <span style={{ fontSize: 11, color: borderColor, fontWeight: 600, textTransform: 'uppercase' }}>{issue.severity}</span>
                      </div>
                      {issue.description && (
                        <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 5, lineHeight: 1.45 }}>{issue.description}</p>
                      )}
                      <p style={{ fontSize: 12, color: 'var(--muted)', borderTop: issue.description ? '1px solid var(--border)' : 'none', paddingTop: issue.description ? 5 : 0, marginTop: 0, lineHeight: 1.45 }}>
                        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Fix: </span>{issue.suggestion}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {new Date(result.timestamp).toLocaleString()}
            </div>

            {result.id && <DiagnosisFixes key={result.id} result={result} config={config} />}
            <DiagnosisChat key={result.id || result.timestamp} result={result} />
          </div>
        )}

        {!result && !loading && !error && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
            Click "Diagnose Now" to capture and analyze the current print
          </div>
        )}
      </div>
      <div className="card">
        <History latestId={result?.id} />
      </div>
    </div>
  );
}
