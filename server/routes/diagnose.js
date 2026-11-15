import { Router } from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { getConfig, insertDiagnosis, getHistory, saveFollowup } from '../db.js';
import { buildFixes } from '../diagnosisFixes.js';
import { autoApplyFixes } from '../fixService.js';
import { prepareFollowup, filterFollowup, refreshFollowup } from '../correctionMemory.js';
import { saveFixes } from '../fixStore.js';
import { getPrinterContext, formatContextForPrompt } from '../printerContext.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');

fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

const SYSTEM_PROMPT = `You are a 3D printing quality expert specializing in FDM printers. Use the supplied printer identity and toolhead data; do not assume a machine or nozzle size. Analyze the provided image of a 3D print and any accompanying printer context data to identify quality issues.

When printer context is provided, use it to inform your diagnosis:
- Compare actual temperatures to targets — deviations often explain quality problems
- Note if speed/flow overrides are active
- Consider filament type when assessing adhesion, stringing, or warping
- A low or zero fan speed with PLA suggests possible heat-related issues
- High pressure advance values can cause under-extrusion at speed
- Input shaper settings affect ghosting/ringing artifacts

Look for these specific issues:
- stringing/oozing: thin threads or blobs between parts
- layer_delamination: layers separating or poor adhesion between layers
- warping: print lifting off bed or curling at edges
- under_extrusion: gaps, weak layers, or incomplete fills
- over_extrusion: blobbing, oozing, or excess material
- elephant_foot: base of print flaring outward
- ghosting: ripple or shadow patterns caused by vibration
- spaghetti: catastrophic failure, random plastic strands
- blob_zit: localized blob or zit on a surface
- bed_adhesion: poor first layer adhesion
- ok: print looks healthy with no significant issues

Return JSON matching the supplied schema. Use fields overall_severity, issues, summary, and control_suggestions. Base all observations on the actual image; do not invent towers, strings, or other features that are not visible. If the view is obstructed, blurry, or insufficient, explain that in summary and leave issues and control_suggestions empty.

overall_severity must be one of: ok, warning, critical
severity for each issue must be one of: minor, moderate, severe
description must be a specific observation of what you see in the image that led to this diagnosis — be concrete about location and appearance, not generic.
suggestion must be an actionable fix.
If the print looks good, return overall_severity "ok", an empty issues array, and empty control_suggestions.

REVIEWED CONTROL SUGGESTIONS (optional, never commands):
Only for an actual live QIDI print with reliable context, you may suggest ONE small adjustment when the visible issue and telemetry support it. For control_suggestions, specify the control name, integer target percentage value, matching issue_category, and a reason tied to actual visible evidence and reported readings. Empty arrays are appropriate when no bounded live change is justified.
- speed: percentage override, only reduce current by 5 to 10 percentage points, final 50 to 100; for ghosting or under_extrusion only. Do not reduce speed to treat over-extrusion or oozing.
- flow: percentage override, only change by 1 to 2 percentage points within 95 to 105; increase for under_extrusion, decrease for over_extrusion. Requires known PLA/PETG/ABS/ASA/TPU material.
- fan: only increase part-cooling by at most 10 percentage points for stringing/blob_zit after the first two layer heights. Final ranges PLA 50-100, PETG 20-50, ABS/ASA/TPU 0-20. Requires known material and layer/Z context.
Do not propose changes for severe or critical issues, spaghetti, warping, bed adhesion failure, or layer delamination. Those need user inspection. - nozzle: nozzle TARGET in degrees Celsius, not the measured temperature. Change by at most 10 C per fix, only with known PLA/PETG/ABS/ASA/TPU and a settled nozzle (actual within 5 C of its current target). Decrease for stringing, blob_zit, or over_extrusion; increase only for under_extrusion. Final ranges: PLA 200-210 C, PETG 230-245 C, ABS/ASA 235-255 C, TPU 210-225 C, also respecting reported hardware limits. Never turn the heater off. If recommending a nozzle adjustment in the advice and these bounds permit it, include a matching nozzle control_suggestion so it can be reviewed and applied.
Do not propose retraction, motion, calibration, bed/chamber temperature, other heater, or power commands. Never invent missing readings. If uncertain, use [] and give textual advice only. A suggestion is an experiment to review, not a guaranteed fix.`;

const DIAGNOSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overall_severity','issues','summary','control_suggestions','comparison'],
  properties: {
    overall_severity: { type: 'string', enum: ['ok','warning','critical'] },
    summary: { type: 'string' },
    comparison:{type:'object',required:['reference_id','clear_view'],properties:{reference_id:{type:'string'},clear_view:{type:'boolean'}}},
    issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['category','severity','description','suggestion','observation','new_evidence'], properties: {
        category: { type: 'string', enum: ['stringing','layer_delamination','warping','under_extrusion','over_extrusion','elephant_foot','ghosting','spaghetti','blob_zit','bed_adhesion'] },
        severity: { type: 'string', enum: ['minor','moderate','severe'] },
        description: { type: 'string' }, suggestion: { type: 'string' },
        observation:{type:'string',enum:['new','existing','uncertain']},new_evidence:{type:'string'},
      } } },
    control_suggestions: { type: 'array', maxItems: 1, items: { type: 'object', additionalProperties: false,
      required: ['control','value','issue_category','reason'], properties: {
        control: { type: 'string', enum: ['speed','flow','fan','nozzle'] }, value: { type: 'integer' },
        issue_category: { type: 'string', enum: ['stringing','under_extrusion','over_extrusion','ghosting','blob_zit'] }, reason: { type: 'string' },
      } } },
  },
};

async function runDiagnosis({ imageBuffer, imagePath, printFile, autoTriggered, config, uploaded = false }) {
  const ollamaUrl = config.ollama_url || 'http://100.73.128.40:11434';
  const model = config.ollama_model || 'qwen2.5-vl:7b';
  const base64 = imageBuffer.toString('base64');

  // Fetch printer context in parallel with image encoding
  const ctx = await getPrinterContext(config);
  const contextText = formatContextForPrompt(ctx);
  let followup=uploaded?null:prepareFollowup(ctx,config,imageBuffer);

  const userText = contextText
    ? `${uploaded ? 'This is an uploaded image. Do not suggest live control changes. ' : ''}Analyze this 3D print image and identify any quality issues.\n\n${contextText}`
    : 'Analyze this 3D print image and identify any quality issues.';

  const body = {
    model,
    system: SYSTEM_PROMPT + `\nPrinter: ${config.name} (${config.model}).`,
    prompt: userText + (followup ? `\nFOLLOW-UP AFTER CORRECTION: ${followup.note}\nPreviously corrected categories: ${followup.categories.join(', ')}. Reference ID: ${followup.reference_id}. ${followup.ready ? 'Two images are supplied: FIRST is the saved post-fix baseline; SECOND is the current print. Compare the same visible surfaces. Report a previously corrected issue only if NEW material deposited above baseline Z '+followup.reference_z+'mm shows new defects. Existing strings/marks remain on the object and are NOT new failure evidence. Mark those observation existing. If motion, occlusion, lighting, or viewpoint prevents comparison, set clear_view false and observation uncertain. For genuinely new defects, give precise new_evidence tied to the changed region and matching reference_id in comparison.' : 'No reliable temporal comparison is available yet. Do not recommend another fix for previously corrected categories. Mark their observation existing or uncertain.'}` : '\nThis is an initial assessment; no post-fix baseline exists. Set comparison reference_id to an empty string.') + ((config.auto_nozzle_enabled==='1' || config.auto_flow_enabled==='1') ? '\nAutomatic application is enabled for eligible '+[config.auto_nozzle_enabled==='1'?'nozzle':'',config.auto_flow_enabled==='1'?'flow':''].filter(Boolean).join(' and ')+'. Prefer those controls only when justified by evidence and within the stated limits. Never invent a recommendation to force a change.' : ''),
    images: [...(followup?.images || []),base64],
    stream: false,
    format: DIAGNOSIS_SCHEMA,
    options: { num_ctx: 8192, temperature: 0.1 },
  };

  const r = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const raw = data.response || data.message?.content || '';

  if (!raw.trim()) {
    const errDetail = data.error ? JSON.stringify(data.error).slice(0, 200) : 'empty response';
    throw new Error(`Model returned no content (${errDetail}). The vision model may be overloaded or the image failed to process — try re-pulling: ollama pull ${model}`);
  }

  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    parsed = { overall_severity: 'warning', issues: [], summary: raw.trim() };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Diagnosis response must be an object');
  if (!Array.isArray(parsed.issues) || parsed.issues.some(i => !i || typeof i.category !== 'string' || typeof i.description !== 'string' || typeof i.suggestion !== 'string' || !['minor','moderate','severe'].includes(i.severity))) parsed.control_suggestions = [];
  parsed.issues = Array.isArray(parsed.issues) ? parsed.issues.filter(i => i && typeof i.category === 'string' && typeof i.description === 'string' && typeof i.suggestion === 'string' && ['minor','moderate','severe'].includes(i.severity)) : [];
  if(!uploaded) followup=refreshFollowup(followup,ctx,config);
  const filtered=filterFollowup(parsed,followup);parsed=filtered.parsed;
  const record = {
    printer_id: config.id,
    timestamp: new Date().toISOString(),
    image_path: imagePath || null,
    print_file: printFile || ctx?.filename || null,
    issues: parsed.issues || [],
    overall_severity: ['ok','warning','critical'].includes(parsed.overall_severity) ? parsed.overall_severity : 'warning',
    raw_response: raw,
    auto_triggered: autoTriggered || false,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    printer_context: ctx,
  };

  record.id = Number(insertDiagnosis(record).lastInsertRowid);
  const fixes = buildFixes(parsed,ctx,{ printerId: config.id, diagnosisId: record.id, uploaded, now: ctx?.captured_at || Date.now(), connection: config.moonraker_url || `http://${config.printer_ip}:7125` });
  for(const fix of fixes) if(filtered.metadata?.verified_categories.includes(fix.category)) fix.followup_reference=filtered.metadata.reference_id;
  saveFixes(fixes);
  if(filtered.metadata) saveFollowup(record.id,config.id,filtered.metadata);
  record.followup=filtered.metadata;
  record.auto_actions=uploaded?[]:await autoApplyFixes(fixes,config,{scheduled:!!autoTriggered});
  record.fixes = fixes;
  return record;
}

// POST /api/diagnose — accepts multipart file OR triggers live snapshot
router.post('/diagnose', upload.single('image'), async (req, res) => {
  const config = getConfig(req.printerId);
  let imageBuffer;
  let imagePath = null;

  if (req.file) {
    imageBuffer = req.file.buffer;
    const fname = `${config.id}_manual_${randomUUID()}.jpg`;
    imagePath = path.join(SNAPSHOTS_DIR, fname);
    fs.writeFileSync(imagePath, imageBuffer);
  } else {
    const snapshotUrl = config.camera_url || (config.model === 'qidi' && config.printer_ip ? `http://${config.printer_ip}/webcam/?action=snapshot` : null);
    if (!snapshotUrl) return res.status(400).json({ error: 'No image uploaded and no printer camera configured' });

    try {
      const r = await fetch(snapshotUrl, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Camera ${r.status}`);
      imageBuffer = Buffer.from(await r.arrayBuffer());
      const fname = `${config.id}_snap_${randomUUID()}.jpg`;
      imagePath = path.join(SNAPSHOTS_DIR, fname);
      fs.writeFileSync(imagePath, imageBuffer);
    } catch (e) {
      return res.status(503).json({ error: `Camera unreachable: ${e.message}` });
    }
  }

  try {
    const result = await runDiagnosis({ imageBuffer, imagePath, printFile: req.body?.print_file, autoTriggered: false, config, uploaded: !!req.file });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diagnose/chat — follow-up conversation grounded in a diagnosis result
router.post('/diagnose/chat', async (req, res) => {
  const { messages, context } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'messages required' });

  const config = getConfig(req.printerId);
  const ollamaBase = config.ollama_url || 'http://100.73.128.40:11434';
  const chatUrl = config.chat_llm_url || ollamaBase;
  const model = config.chat_llm_model || config.ollama_model || 'qwen2.5-vl:7b';

  const systemLines = [
    `You are a 3D printing expert helping with ${config.name} (${config.model}). Use actual reported toolhead and nozzle details.`,
    'A vision AI just ran a diagnosis on their print. Answer questions about it conversationally and practically.',
    '',
  ];

  if (context) {
    systemLines.push(`DIAGNOSIS: ${(context.overall_severity || 'unknown').toUpperCase()}`);
    if(context.followup) systemLines.push(`FOLLOW-UP: ${context.followup.note}. Previously corrected categories ${context.followup.categories.join(', ')} are historical unless new post-correction evidence is explicitly verified. Do not recommend another adjustment for old defects.`);
    if (context.summary) systemLines.push(`Summary: ${context.summary}`);

    if (context.issues?.length > 0) {
      systemLines.push('', 'DETECTED ISSUES:');
      for (const iss of context.issues) {
        const desc = iss.description ? `: ${iss.description}` : '';
        systemLines.push(`- ${iss.category} (${iss.severity})${desc} → Fix: ${iss.suggestion}`);
      }
    } else {
      systemLines.push('No specific issues were identified by the vision model.');
    }

    const pc = context.printer_context;
    if (pc || context.print_file) {
      systemLines.push('', 'PRINTER STATE AT TIME OF DIAGNOSIS:');
      if (context.print_file) systemLines.push(`  File: ${context.print_file}`);
      if (pc?.filament_type) systemLines.push(`  Filament: ${pc.filament_type}`);
      if (pc?.nozzle_temp != null) systemLines.push(`  Nozzle: ${pc.nozzle_temp}°C (target ${pc.nozzle_target}°C)`);
      if (pc?.bed_temp != null) systemLines.push(`  Bed: ${pc.bed_temp}°C (target ${pc.bed_target}°C)`);
      if (pc?.chamber_temp != null) systemLines.push(`  Chamber: ${pc.chamber_temp}°C`);
      if (pc?.fan_pct != null) systemLines.push(`  Part cooling fan: ${pc.fan_pct}%`);
      if (pc?.layer_height) systemLines.push(`  Layer height: ${pc.layer_height}mm`);
      if (pc?.z_mm != null) systemLines.push(`  Z height at snapshot: ${pc.z_mm}mm`);
      if (pc?.progress_pct != null) systemLines.push(`  Print progress: ${pc.progress_pct}%`);
      if (pc?.pressure_advance) systemLines.push(`  Pressure advance: ${pc.pressure_advance}`);
      if (pc?.slicer) systemLines.push(`  Slicer: ${pc.slicer}`);
      if (pc?.speed_factor_pct && pc.speed_factor_pct !== 100) systemLines.push(`  Speed override: ${pc.speed_factor_pct}%`);
      if (pc?.flow_pct && pc.flow_pct !== 100) systemLines.push(`  Flow override: ${pc.flow_pct}%`);
    }

    systemLines.push('', 'Help the user understand whether the issue was caused by settings, the model/file, material, mechanical factors, or something else. Be specific and practical.');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // send headers immediately so proxies don't time out waiting for first byte

  const sendEvent = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const r = await fetch(`${chatUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemLines.join('\n') }, ...messages],
        stream: true,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`[chat] LLM error ${r.status}: ${errText.slice(0, 200)}`);
      sendEvent({ error: `Chat LLM ${r.status}: ${errText}` });
      return res.end();
    }

    let buf = '';
    let done = false;
    for await (const chunk of r.body) {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { done = true; break; }
        try {
          const token = JSON.parse(payload).choices?.[0]?.delta?.content || '';
          if (token) sendEvent({ token });
        } catch { /* skip malformed chunk */ }
      }
      if (done) break;
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error(`[chat] stream error: ${e.message}`);
    sendEvent({ error: e.message });
    res.end();
  }
});

// GET /api/history
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(getHistory(limit, req.printerId));
});

export { runDiagnosis };
export default router;
