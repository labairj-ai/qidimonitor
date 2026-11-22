import { MATERIAL_PROFILES } from './materialProfiles.js';
import { randomUUID } from 'node:crypto';

export const CONTROL_FIELDS = { speed: 'speed_factor_pct', flow: 'flow_pct', fan: 'fan_pct', nozzle: 'nozzle_target' };
export const FIX_TTL_MS = 10 * 60000;
const categories = {
  speed: ['ghosting', 'under_extrusion'],
  flow: ['under_extrusion', 'over_extrusion'],
  fan: ['stringing', 'blob_zit'],
  nozzle: ['stringing', 'blob_zit', 'over_extrusion', 'under_extrusion'],
};
const fanRanges = { PLA: [50, 100], PETG: [20, 50], ABS: [0, 20], ASA: [0, 20], TPU: [0, 20] };
export function materialKey(ctx) { return typeof ctx?.filament_type === 'string' ? ctx.filament_type.trim().toUpperCase() : ''; }

export function validAdjustment(control, before, after, ctx, category) {
  if (!Object.hasOwn(categories, control) || !Number.isFinite(before) || !Number.isInteger(after) || before === after || !categories[control]?.includes(category)) return false;
  if (control === 'speed') return after >= 50 && after <= 100 && before - after >= 5 && before - after <= 10;
  if (control === 'nozzle') {
    const range = MATERIAL_PROFILES[materialKey(ctx)]?.nozzle;
    const cfg = ctx.printer_config;
    if (!range || !/^extruder\d*$/.test(ctx.active_extruder) ||
        !Number.isFinite(cfg?.nozzle_max_temp) || !Number.isFinite(cfg?.nozzle_min_temp) || !Number.isFinite(cfg?.min_extrude_temp)) return false;
    const lower = Math.max(180, range.min, cfg.nozzle_min_temp + 5, cfg.min_extrude_temp + 5);
    const upper = Math.min(280, range.max, cfg.nozzle_max_temp - 5);
    const direction = category === 'under_extrusion' ? 1 : -1;
    return before >= Math.max(180, range.min - 10, cfg.nozzle_min_temp + 5, cfg.min_extrude_temp + 5) && before <= Math.min(280, range.max + 10, cfg.nozzle_max_temp - 5) &&
      after >= lower && after <= upper && Math.abs(after - before) <= 10 && (after - before) * direction > 0;
  }
  if (!fanRanges[materialKey(ctx)]) return false;
  if (control === 'flow') {
    const direction = category === 'under_extrusion' ? 1 : -1;
    return before >= 95 && before <= 105 && after >= 95 && after <= 105 && (after - before) * direction > 0 && Math.abs(after - before) <= 2;
  }
  const [min, max] = fanRanges[materialKey(ctx)];
  return before >= 0 && before <= 100 && after >= min && after <= max && after > before && after - before <= 10 &&
    Number.isFinite(ctx.z_mm) && Number.isFinite(ctx.first_layer_height) && ctx.z_mm > ctx.first_layer_height * 2;
}

function pastStartup(ctx) {
  if (Number.isInteger(ctx.current_layer)) return ctx.current_layer > 2;
  const first = Number(ctx.first_layer_height);
  const layer = Number(ctx.layer_height) || first;
  return first > 0 && layer > 0 && Number.isFinite(ctx.z_mm) && ctx.z_mm > first + layer;
}

// Suggestions are data only. Free-text suggestions and AI-supplied commands are never executed.
export function buildFixes(parsed, ctx, { printerId, diagnosisId, uploaded = false, now = Date.now(), connection = null }) {
  if (uploaded || ctx?.model !== 'qidi' || ctx.print_state !== 'printing' || !ctx.filename || !pastStartup(ctx) ||
      !Number.isFinite(ctx.print_duration_sec) || !Number.isFinite(ctx.print_total_duration_sec) || !Number.isFinite(ctx.captured_at) || !['warning'].includes(parsed?.overall_severity) ||
      !Array.isArray(parsed.issues) || parsed.issues.some(i => i?.severity === 'severe' || ['spaghetti','warping','bed_adhesion','layer_delamination'].includes(i?.category))) return [];
  for (const candidate of (Array.isArray(parsed.control_suggestions) ? parsed.control_suggestions.slice(0, 5) : [])) {
    if (!candidate || typeof candidate.reason !== 'string' || !candidate.reason.trim() || candidate.reason.length > 500) continue;
    const { control, value, issue_category: category } = candidate;
    if (!parsed.issues.some(i => i?.category === category && i.evidence_region === 'printed_part' && ['minor','moderate'].includes(i.severity))) continue;
    const before = ctx[CONTROL_FIELDS[control]];
    if (!validAdjustment(control, before, value, ctx, category)) continue;
    if (control === 'nozzle' && (!Number.isFinite(ctx.nozzle_temp) || Math.abs(ctx.nozzle_temp - before) > 5)) continue;
    return [{ id: randomUUID(), printer_id: printerId, diagnosis_id: diagnosisId, control,
      connection, before, after: value, reason: candidate.reason.trim(), category, baseline: { ...ctx, evidence_region: 'printed_part' },
      created_at: now, expires_at: now + FIX_TTL_MS }];
  }
  return [];
}

export function validateFixContext(fix, ctx, { undo = false, now = Date.now(), appliedAt } = {}) {
  if (!ctx || ctx.model !== 'qidi' || ctx.print_state !== 'printing') throw new Error('This fix requires the QIDI to be actively printing.');
  if (!undo && (fix.baseline.evidence_region !== 'printed_part' || !pastStartup(ctx))) throw new Error('Wait until past startup and run a new diagnosis with visible evidence on the print.');
  if (ctx.filename !== fix.baseline.filename || ctx.active_extruder !== fix.baseline.active_extruder || materialKey(ctx) !== materialKey(fix.baseline)) throw new Error('The print, toolhead, or material has changed. Run a new diagnosis.');
  const age = now - fix.created_at;
  if (age < 0 || !Number.isFinite(ctx.print_duration_sec) || ctx.print_duration_sec < fix.baseline.print_duration_sec || ctx.print_duration_sec > fix.baseline.print_duration_sec + age / 1000 + 30) throw new Error('The print session has changed. Run a new diagnosis.');
  const sessionStart = ctx.captured_at - ctx.print_total_duration_sec * 1000;
  const originalStart = fix.baseline.captured_at - fix.baseline.print_total_duration_sec * 1000;
  if (!Number.isFinite(sessionStart) || !Number.isFinite(originalStart) || Math.abs(sessionStart - originalStart) > 30000) throw new Error('The print session has changed. Run a new diagnosis.');
  if (undo ? !appliedAt || now - appliedAt > FIX_TTL_MS : now > fix.expires_at) throw new Error('This fix has expired. Run a new diagnosis or use the manual controls.');
  const expected = undo ? fix.after : fix.before;
  if (Math.abs(ctx[CONTROL_FIELDS[fix.control]] - expected) > 0.5 || !Number.isFinite(ctx[CONTROL_FIELDS[fix.control]])) throw new Error('This control has changed since the proposal. Run a new diagnosis or use the manual controls.');
  if (fix.control === 'nozzle' && !undo && (!Number.isFinite(ctx.nozzle_temp) || Math.abs(ctx.nozzle_temp - ctx.nozzle_target) > 5)) throw new Error('Wait for the nozzle to reach its current target before applying a temperature fix.');
  if (!validAdjustment(fix.control, fix.before, fix.after, ctx, fix.category)) throw new Error('The proposed adjustment no longer meets the limits.');
}

export function fixCommand(control, value, heater) {
  if (!Number.isFinite(value)) throw new Error('Invalid control value');
  if (control === 'nozzle' && Number.isFinite(value) && value >= 180 && value <= 300 && /^extruder\d*$/.test(heater)) return `SET_HEATER_TEMPERATURE HEATER=${heater} TARGET=${value}`;
  if (control === 'speed' && value >= 50 && value <= 200) return `M220 S${value}`;
  if (control === 'flow' && value >= 95 && value <= 105) return `M221 S${value}`;
  if (control === 'fan' && value >= 0 && value <= 100) return `M106 S${Math.round(value * 255 / 100)}`;
  throw new Error('Unsupported control');
}

// Confirmation reads only the required controls, avoiding metadata/model requests.
export async function readFixState(config, request, control, heater) {
  const base = config.moonraker_url || `http://${config.printer_ip}:7125`;
  try {
    const object = control === 'nozzle' && /^extruder\d*$/.test(heater) ? encodeURIComponent(heater) : control === 'fan' ? 'output_pin%20fan0' : 'gcode_move';
    const r = await request(`${base}/printer/objects/query?print_stats&toolhead&${object}`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const s = (await r.json()).result?.status;
    return { filename: s?.print_stats?.filename, print_state: s?.print_stats?.state,
      active_extruder: s?.toolhead?.extruder, print_duration_sec: s?.print_stats?.print_duration,
      speed_factor_pct: typeof s?.gcode_move?.speed_factor === 'number' ? s.gcode_move.speed_factor * 100 : null,
      flow_pct: typeof s?.gcode_move?.extrude_factor === 'number' ? s.gcode_move.extrude_factor * 100 : null,
      nozzle_target: typeof s?.[heater]?.target === 'number' ? s[heater].target : null,
      fan_pct: typeof s?.['output_pin fan0']?.value === 'number' ? s['output_pin fan0'].value * 100 : null };
  } catch { return null; }
}

// Send once; a slow acknowledgment never causes a duplicate command.
export async function executeFix({ fix, undo, config, request, context, wait = ms => new Promise(r => setTimeout(r, ms)), attempts = 12 }) {
  const desired = undo ? fix.before : fix.after;
  const base = config.moonraker_url || `http://${config.printer_ip}:7125`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let commandError;
  const command = request(`${base}/printer/gcode/script`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: fixCommand(fix.control, desired, fix.baseline.active_extruder) }), signal: controller.signal,
  }).then(async r => { if (!r.ok) throw new Error(`Printer rejected the command (${r.status})`); await r.text(); }).catch(e => { commandError = e; });
  try {
    const deadline = Date.now() + 10000;
    for (let i = 0; i < attempts && Date.now() < deadline; i++) {
      await wait(500);
      const actual = await context(config);
      if (!actual) continue;
      if (actual.filename !== fix.baseline.filename || actual.print_state !== fix.baseline.print_state || actual.active_extruder !== fix.baseline.active_extruder || !Number.isFinite(actual.print_duration_sec) || actual.print_duration_sec < fix.baseline.print_duration_sec) break;
      const value = actual[CONTROL_FIELDS[fix.control]];
      if (Number.isFinite(value) && Math.abs(value - desired) <= 0.5) return { confirmed: true, observed: value };
      if (commandError && !['AbortError','TimeoutError'].includes(commandError.name)) throw commandError;
    }
    return { confirmed: false, message: 'Command sent, but the resulting setting is unconfirmed. Check the live controls; do not repeat this fix.' };
  } finally { clearTimeout(timer); controller.abort(); await command; }
}
