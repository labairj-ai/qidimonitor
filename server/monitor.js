import fetch from 'node-fetch';
import { listPrinters } from './db.js';
import { runDiagnosis } from './routes/diagnose.js';

export function monitorSetup(config) {
  if (!config.printer_ip && !config.moonraker_url) return 'Save a printer address in Settings first.';
  if (!config.camera_url && !(config.model === 'qidi' && config.printer_ip)) return 'Save a camera snapshot URL in Settings first.';
  return null;
}

export function createMonitor({ printers = listPrinters, request = fetch, diagnose = runDiagnosis, now = Date.now } = {}) {
  const states = new Map();
  const stateFor = id => {
    if (!states.has(id)) states.set(id, { phase:'waiting_for_print', busy:false, last_attempt_at:null, last_completed_at:null, last_success_at:null, next_check_at:null, last_error:null, next_poll_at:0, was_printing:false, last_filename:null, last_duration:null });
    return states.get(id);
  };
  const intervalFor = config => Math.max(1,Number(config.auto_interval_min) || 10) * 60000;
  const find = id => printers().find(p => p.id === id);
  const status = id => {
    const config = find(id);
    if (!config) throw new Error('Unknown printer');
    const state = stateFor(id);
    const enabled = config.auto_enabled === '1';
    const setup_error = monitorSetup(config);
    const phase = !enabled ? state.busy ? 'finishing' : 'disabled' : setup_error ? 'not_configured' : state.phase;
    const { next_poll_at, was_printing, last_filename, last_duration, ...visible } = state;
    return { ...visible, phase, enabled, interval_minutes:intervalFor(config)/60000, setup_error, next_check_at:enabled ? state.next_check_at : null };
  };
  const stillConfigured = config => {
    const current = find(config.id);
    return current?.auto_enabled === '1' && ['printer_ip','moonraker_url','camera_url','ollama_url','ollama_model'].every(key => current[key] === config[key]);
  };
  const run = async (config, force = false) => {
    const state = stateFor(config.id);
    if (config.auto_enabled !== '1' || state.busy || monitorSetup(config) || (!force && now() < state.next_poll_at)) return;
    state.busy = true; state.phase = 'checking';
    let attempted = false;
    try {
      const base = config.moonraker_url || `http://${config.printer_ip}:7125`;
      const r = await request(`${base}/printer/objects/query?print_stats`, { signal:AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`Printer status unavailable (${r.status}).`);
      const stats = (await r.json()).result?.status?.print_stats;
      if (!stats || typeof stats.state !== 'string') throw new Error('Printer did not report its print state.');
      if (!stillConfigured(config)) return;
      if (stats.state !== 'printing') {
        state.phase = 'waiting_for_print'; state.next_check_at = null; state.last_error = null; state.was_printing = false;
        return;
      }
      const newPrint = !state.was_printing || stats.filename !== state.last_filename ||
        (Number.isFinite(stats.print_duration) && Number.isFinite(state.last_duration) && stats.print_duration < state.last_duration);
      state.was_printing = true; state.last_filename = stats.filename; state.last_duration = stats.print_duration;
      const due = state.last_completed_at === null ? 0 : state.last_completed_at + intervalFor(config);
      if (!force && !newPrint && now() < due) { state.phase = state.last_error ? 'error' : 'scheduled'; state.next_check_at = due; return; }
      attempted = true; state.last_attempt_at = now(); state.last_error = null;
      const camera = config.camera_url || `http://${config.printer_ip}/webcam/?action=snapshot`;
      const image = await request(camera, { signal:AbortSignal.timeout(8000) });
      if (!image.ok) throw new Error(`Camera snapshot unavailable (${image.status}).`);
      const imageBuffer = Buffer.from(await image.arrayBuffer());
      if (!imageBuffer.length) throw new Error('Camera returned an empty snapshot.');
      if (!stillConfigured(config)) return;
      state.phase = 'analyzing';
      const result = await diagnose({ imageBuffer, printFile:stats.filename, autoTriggered:true, config });
      state.last_success_at = now(); state.last_diagnosis_id = result?.id || null; state.last_severity = result?.overall_severity || null;
      state.phase = 'scheduled'; state.last_error = null;
    } catch(e) {
      state.phase = 'error';
      state.last_error = ['AbortError','TimeoutError'].includes(e.name) ? 'The printer, camera, or AI request timed out. You can retry with Check now.' : e.message;
      if (!attempted) { attempted = true; state.last_attempt_at = now(); }
      console.warn(`[auto:${config.id}] ${state.last_error}`);
    } finally {
      state.busy = false;
      if (attempted) state.last_completed_at = now();
      state.next_poll_at = now() + 15000;
      const current = find(config.id);
      state.next_check_at = current?.auto_enabled === '1' && state.was_printing && state.last_completed_at !== null ? state.last_completed_at + intervalFor(current) : null;
    }
  };
  const tick = async () => { await Promise.all(printers().map(config => run(config))); };
  tick.status = status;
  tick.check = id => {
    const config = find(id);
    if (!config) throw new Error('Unknown printer');
    if (config.auto_enabled !== '1') throw new Error('Enable automatic monitoring first.');
    const missing = monitorSetup(config); if (missing) throw new Error(missing);
    void run(config,true).catch(e => console.warn(`[auto:${id}] ${e.message}`));
    return status(id);
  };
  tick.configurationChanged = (id, before, after) => {
    const keys = ['auto_enabled','auto_interval_min','printer_ip','moonraker_url','camera_url','ollama_url','ollama_model'];
    if (keys.every(key => before[key] === after[key])) return;
    const state = stateFor(id);
    state.next_poll_at = 0;
    const connectionChanged = keys.slice(2).some(key => before[key] !== after[key]);
    if (before.auto_enabled !== after.auto_enabled || connectionChanged) {
      state.last_attempt_at = null; state.last_completed_at = null; state.was_printing = false; state.last_error = null;
    }
    state.next_check_at = after.auto_enabled === '1' && state.last_completed_at !== null ? state.last_completed_at + intervalFor(after) : null;
    if (after.auto_enabled === '1') void run(after).catch(e => console.warn(`[auto:${id}] ${e.message}`));
  };
  return tick;
}
