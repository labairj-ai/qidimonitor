import { Router } from 'express';
import fetch from 'node-fetch';
import { getConfig } from '../db.js';
import { recordManualCorrection } from '../correctionMemory.js';
import { executeFix, readFixState, CONTROL_FIELDS, LIVE_TARGET_CONTROLS, validLiveTarget } from '../diagnosisFixes.js';
import { busyAdjustments } from '../fixService.js';
import { getPrinterContext } from '../printerContext.js';

const router = Router();

function moonrakerUrl(config) {
  if (config.moonraker_url) return config.moonraker_url;
  if (config.printer_ip) return `http://${config.printer_ip}:7125`;
  return null;
}

function cameraSnapshotUrl(config) {
  if (config.camera_url) return config.camera_url;
  if (config.model === 'qidi' && config.printer_ip) return `http://${config.printer_ip}/webcam/?action=snapshot`;
  return null;
}

function cameraStreamUrl(config) {
  if (config.camera_stream_url) return config.camera_stream_url;
  if (config.model === 'qidi' && config.printer_ip) return `http://${config.printer_ip}/webcam/?action=stream`;
  return null;
}

// A failed connection never reassigns this printer to another network device.
async function fetchForPrinter(req, urlFn, fetchFn) {
  const config = getConfig(req.printerId);
  const url = urlFn(config);
  if (!url) return { error: 'not_configured' };
  return fetchFn(url, config);
}

// Only the explicitly identified chamber-light pin may be controlled here.
async function chamberLight(base) {
  const r = await fetch(`${base}/printer/objects/list`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Moonraker ${r.status}`);
  const data = await r.json();
  if (!data.result?.objects?.includes('output_pin caselight')) return { supported: false };
  const query = await fetch(`${base}/printer/objects/query?output_pin%20caselight&configfile`, { signal: AbortSignal.timeout(5000) });
  if (!query.ok) throw new Error(`Moonraker ${query.status}`);
  const status = (await query.json()).result?.status;
  const value = status?.['output_pin caselight']?.value;
  const scale = Number(status?.configfile?.config?.['output_pin caselight']?.scale ?? 1);
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) throw new Error('Chamber light state unavailable');
  return { supported: true, on: value > 0, scale };
}

router.get('/light', async (req, res) => {
  const base = moonrakerUrl(getConfig(req.printerId));
  if (!base) return res.status(400).json({ error: 'Save a printer address first' });
  try {
    const { scale, ...state } = await chamberLight(base);
    res.json(state);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.post('/light', async (req, res) => {
  if (typeof req.body.on !== 'boolean') return res.status(400).json({ error: 'on must be a boolean' });
  const config = getConfig(req.printerId);
  if (config.model === 'u1' && config.controls_enabled !== '1') return res.status(409).json({ error: 'Enable U1 controls in Settings first.' });
  const base = moonrakerUrl(config);
  if (!base) return res.status(400).json({ error: 'Save a printer address first' });
  try {
    const state = await chamberLight(base);
    if (!state.supported) return res.status(409).json({ error: 'This printer does not expose a supported chamber light' });
    // The G-code acknowledgment can lag the pin itself. Watch actual state
    // concurrently, rather than waiting for a response that may remain queued.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let commandError;
    const command = fetch(`${base}/printer/gcode/script`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: `SET_PIN PIN=caselight VALUE=${req.body.on ? state.scale : 0}` }),
      signal: controller.signal,
    }).then(async r => {
      if (!r.ok) throw new Error(`Moonraker ${r.status}: ${await r.text()}`);
      await r.text();
    }).catch(e => { commandError = e; });
    try {
      const deadline = Date.now() + 12000;
      do {
        await new Promise(resolve => setTimeout(resolve, 250));
        const actual = await chamberLight(base).catch(() => null);
        if (actual?.supported && actual.on === req.body.on) return res.json({ ok: true, on: actual.on });
        if (commandError && !['AbortError', 'TimeoutError'].includes(commandError.name)) throw commandError;
      } while (Date.now() < deadline);
      return res.status(202).json({ pending: true, requested: req.body.on });
    } finally {
      clearTimeout(timer);
      controller.abort();
      await command;
    }
  } catch (e) {
    res.status(503).json({ error: ['AbortError', 'TimeoutError'].includes(e.name) ? 'The printer is taking too long to report its light state. Please check the connection.' : e.message });
  }
});

// GET /api/printer/status
router.get('/status', async (req, res) => {
  try {
    const result = await fetchForPrinter(req,
      cfg => moonrakerUrl(cfg) && `${moonrakerUrl(cfg)}/printer/objects/query?print_stats&extruder&heater_bed&display_status`,
      async (url) => {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`Moonraker ${r.status}`);
        return r.json();
      }
    );
    if (result.error === 'not_configured') return res.status(400).json({ error: 'Printer IP not configured' });
    res.json(result.result?.status || result);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// GET /api/printer/snapshot — returns raw image bytes
router.get('/snapshot', async (req, res) => {
  const config = getConfig(req.printerId);
  const url = cameraSnapshotUrl(config);
  if (!url) return res.status(400).json({ error: 'Printer IP not configured' });

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Camera ${r.status}`);
    const ct = r.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', ct);
    r.body.pipe(res);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// GET /api/printer/stream — proxy MJPEG stream
router.get('/stream', async (req, res) => {
  const config = getConfig(req.printerId);
  const url = cameraStreamUrl(config);
  if (!url) return res.status(400).json({ error: 'Printer IP not configured' });

  try {
    // Separate connect-phase timeout: abort if printer doesn't send headers within 8s.
    // Once connected, the stall watchdog below takes over for ongoing data.
    const connectCtrl = new AbortController();
    const connectTimeout = setTimeout(() => connectCtrl.abort(), 8000);
    let r;
    try {
      r = await fetch(url, { signal: connectCtrl.signal });
      clearTimeout(connectTimeout);
    } catch (e) {
      clearTimeout(connectTimeout);
      throw e;
    }
    if (!r.ok) throw new Error(`Stream ${r.status}`);
    res.set('Content-Type', r.headers.get('content-type') || 'multipart/x-mixed-replace');
    res.set('Cache-Control', 'no-cache');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Server-side stall watchdog: if the printer sends no bytes for 8s, kill the upstream.
    // The client has a 4s frame watchdog; this is a safety net for cases where the TCP
    // connection stays open but data stops flowing (WiFi drop without RST).
    const STALL_MS = 8000;
    let stallTimer = setTimeout(() => r.body.destroy(), STALL_MS);
    const resetStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => r.body.destroy(), STALL_MS);
    };
    r.body.on('data', resetStall);

    r.body.pipe(res);

    const cleanup = () => {
      clearTimeout(stallTimer);
      r.body.destroy();
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    r.body.on('error', () => { clearTimeout(stallTimer); res.destroy(); });
    r.body.on('close', () => { clearTimeout(stallTimer); if (!res.writableEnded) res.destroy(); });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// POST /api/printer/discover — manual discovery trigger
router.post('/discover', async (req, res) => {
  res.status(409).json({ error: 'Automatic reassignment is disabled for multiple printers. Set this printer’s address in Settings and test its connection.' });
});
router.get('/discover', (req, res) => res.json({ discovering: false, printer_ip: getConfig(req.printerId).printer_ip }));

// GET /api/printer/context — full printer context with material profile + deviations
router.get('/context', async (req, res) => {
  const config = getConfig(req.printerId);
  const ctx = await getPrinterContext(config);
  if (!ctx) return res.status(503).json({ error: 'Printer unreachable' });
  res.json(ctx);
});

// Manual target entry is independent of AI diagnosis eligibility.
router.post('/nozzle', async (req, res) => {
  const config = getConfig(req.printerId);
  if (config.model !== 'qidi') return res.status(409).json({ error: 'Manual nozzle controls are currently available for the QIDI only.' });
  const { target, expected_target, extruder, filename } = req.body;
  if (!Number.isInteger(target) || !Number.isFinite(expected_target) || typeof filename !== 'string' || !/^extruder\d*$/.test(extruder)) return res.status(400).json({ error: 'Enter a whole-number temperature and refresh the printer readings.' });
  if (busyAdjustments.has(req.printerId)) return res.status(409).json({ error: 'A nozzle change is already in progress.' });
  busyAdjustments.add(req.printerId);
  try {
    const ctx = await getPrinterContext(config);
    if (!ctx || !['printing','paused'].includes(ctx.print_state)) return res.status(409).json({ error: 'Nozzle target changes require an active or paused print.' });
    if (ctx.active_extruder !== extruder || ctx.filename !== filename || ctx.nozzle_target !== expected_target) return res.status(409).json({ error: 'The printer or nozzle target changed. Review the current readings and apply again.' });
    const cfg = ctx.printer_config;
    if (!Number.isFinite(cfg?.nozzle_min_temp) || !Number.isFinite(cfg?.nozzle_max_temp) || !Number.isFinite(cfg?.min_extrude_temp)) return res.status(409).json({ error: 'Nozzle heater limits are unavailable.' });
    const min = Math.max(180, cfg.nozzle_min_temp + 5, cfg.min_extrude_temp + 5);
    const max = Math.min(300, cfg.nozzle_max_temp - 5);
    if (target < min || target > max) return res.status(400).json({ error: `Choose a nozzle target between ${min} and ${max}°C.` });
    if (target === ctx.nozzle_target) return res.json({ confirmed:true, observed:target });
    const result = await executeFix({ fix: { control:'nozzle', before:ctx.nozzle_target, after:target, baseline:ctx },
      undo:false, config, request:fetch, context:cfg => readFixState(cfg,fetch,'nozzle',extruder) });
    if(result.confirmed) await recordManualCorrection('nozzle',ctx.nozzle_target,target,ctx,config).catch(e=>console.warn(`[manual:${req.printerId}] ${e.message}`));
    res.status(result.confirmed ? 200 : 202).json(result);
  } catch(e) { res.status(503).json({ error: `Nozzle change could not be confirmed: ${e.message}. Check the live target before trying again.` }); }
  finally { busyAdjustments.delete(req.printerId); }
});

router.post('/live-controls/:control', async (req, res) => {
  const { control } = req.params;
  if (!LIVE_TARGET_CONTROLS.includes(control)) return res.status(404).json({ error: 'Unknown live control.' });
  const config = getConfig(req.printerId);
  if (config.model !== 'qidi') return res.status(409).json({ error: 'These live controls are currently QIDI-only.' });
  const { target, expected, filename, extruder, session_start } = req.body || {};
  if (!Number.isFinite(target) || !Number.isFinite(expected) || typeof filename !== 'string' ||
      !/^extruder\d*$/.test(extruder) || !Number.isFinite(session_start)) {
    return res.status(400).json({ error: 'Enter a valid target and refresh the printer readings.' });
  }
  if (busyAdjustments.has(req.printerId)) return res.status(409).json({ error: 'A printer adjustment is already in progress.' });
  busyAdjustments.add(req.printerId);
  try {
    const ctx = await getPrinterContext(config);
    const field = CONTROL_FIELDS[control];
    const start = ctx?.captured_at - ctx?.print_total_duration_sec * 1000;
    if (!['printing', 'paused'].includes(ctx?.print_state) || ctx.filename !== filename || ctx.active_extruder !== extruder ||
        !Number.isFinite(start) || !Number.isFinite(ctx.print_total_duration_sec) ||
        Math.abs(start - session_start) > 15_000 || expected !== ctx[field]) {
      return res.status(409).json({ error: 'The print or current setting changed. Review the live readings before applying.' });
    }
    if (!validLiveTarget(control, target, ctx)) return res.status(400).json({ error: 'Target is outside the live adjustment limits or unavailable at this layer.' });
    if (target === expected) return res.json({ confirmed: true, observed: target });
    const result = await executeFix({
      fix: { control, before: expected, after: target, baseline: ctx },
      config, request: fetch, context: current => readFixState(current, fetch, control, extruder),
    });
    if (result.confirmed) await recordManualCorrection(control, expected, target, ctx, config).catch(e => console.warn(`[manual:${req.printerId}] ${e.message}`));
    return res.status(result.confirmed ? 200 : 202).json(result);
  } catch (e) {
    return res.status(503).json({ error: `Change could not be confirmed: ${e.message}. Check the live setting before trying again.` });
  } finally {
    busyAdjustments.delete(req.printerId);
  }
});

// POST /api/printer/gcode — run a raw gcode command (M220, M221, etc.)
router.post('/gcode', async (req, res) => {
  const { script } = req.body;
  if (!script) return res.status(400).json({ error: 'script required' });
  const config = getConfig(req.printerId);
  const base = moonrakerUrl(config);
  if (!base) return res.status(400).json({ error: 'Printer not configured' });
  const flowMatch=typeof script==='string' ? script.match(/^M221 S(\d+(?:\.\d+)?)$/) : null;
  const priorFlow=flowMatch ? await getPrinterContext(config) : null;
  try {
    const r = await fetch(`${base}/printer/gcode/script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(await r.text());
    if(flowMatch && priorFlow) {
      const actual=await readFixState(config,fetch,'flow',priorFlow.active_extruder);
      if(actual && Math.abs(actual.flow_pct-Number(flowMatch[1]))<=0.5) await recordManualCorrection('flow',priorFlow.flow_pct,actual.flow_pct,priorFlow,config).catch(e=>console.warn(`[manual:${req.printerId}] ${e.message}`));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
