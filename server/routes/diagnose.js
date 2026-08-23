import { Router } from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, insertDiagnosis, getHistory } from '../db.js';
import { getPrinterContext, formatContextForPrompt } from '../printerContext.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');

fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

const SYSTEM_PROMPT = `You are a 3D printing quality expert specializing in FDM printers like the QIDI X-Plus 3 (CoreXY, 0.4mm nozzle). Analyze the provided image of a 3D print and any accompanying printer context data to identify quality issues.

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

Respond ONLY with valid JSON in this exact format:
{
  "overall_severity": "ok",
  "issues": [
    {
      "category": "stringing",
      "severity": "minor",
      "description": "Fine hair-like strands visible between the towers in the upper half of the model",
      "suggestion": "Lower retraction distance or increase travel speed"
    }
  ],
  "summary": "Minor stringing visible between towers but overall print quality is good."
}

overall_severity must be one of: ok, warning, critical
severity for each issue must be one of: minor, moderate, severe
description must be a specific observation of what you see in the image that led to this diagnosis — be concrete about location and appearance, not generic.
suggestion must be an actionable fix.
If the print looks good, return overall_severity "ok" and an empty issues array.`;

async function runDiagnosis({ imageBuffer, imagePath, printFile, autoTriggered, config }) {
  const ollamaUrl = config.ollama_url || 'http://100.73.128.40:11434';
  const model = config.ollama_model || 'qwen2.5-vl:7b';
  const base64 = imageBuffer.toString('base64');

  // Fetch printer context in parallel with image encoding
  const ctx = await getPrinterContext(config);
  const contextText = formatContextForPrompt(ctx);

  const userText = contextText
    ? `Analyze this 3D print image and identify any quality issues.\n\n${contextText}`
    : 'Analyze this 3D print image and identify any quality issues.';

  const body = {
    model,
    system: SYSTEM_PROMPT,
    prompt: userText,
    images: [base64],
    stream: false,
    options: { num_ctx: 8192 },
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

  const record = {
    timestamp: new Date().toISOString(),
    image_path: imagePath || null,
    print_file: printFile || ctx?.filename || null,
    issues: parsed.issues || [],
    overall_severity: parsed.overall_severity || 'warning',
    raw_response: raw,
    auto_triggered: autoTriggered || false,
    summary: parsed.summary || '',
    printer_context: ctx,
  };

  insertDiagnosis(record);
  return record;
}

// POST /api/diagnose — accepts multipart file OR triggers live snapshot
router.post('/diagnose', upload.single('image'), async (req, res) => {
  const config = getConfig();
  let imageBuffer;
  let imagePath = null;

  if (req.file) {
    imageBuffer = req.file.buffer;
    const fname = `manual_${Date.now()}.jpg`;
    imagePath = path.join(SNAPSHOTS_DIR, fname);
    fs.writeFileSync(imagePath, imageBuffer);
  } else {
    const snapshotUrl = config.camera_url || (config.printer_ip ? `http://${config.printer_ip}/webcam/?action=snapshot` : null);
    if (!snapshotUrl) return res.status(400).json({ error: 'No image uploaded and no printer camera configured' });

    try {
      const r = await fetch(snapshotUrl, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Camera ${r.status}`);
      imageBuffer = Buffer.from(await r.arrayBuffer());
      const fname = `snap_${Date.now()}.jpg`;
      imagePath = path.join(SNAPSHOTS_DIR, fname);
      fs.writeFileSync(imagePath, imageBuffer);
    } catch (e) {
      return res.status(503).json({ error: `Camera unreachable: ${e.message}` });
    }
  }

  try {
    const result = await runDiagnosis({ imageBuffer, imagePath, printFile: req.body?.print_file, autoTriggered: false, config });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diagnose/chat — follow-up conversation grounded in a diagnosis result
router.post('/diagnose/chat', async (req, res) => {
  const { messages, context } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'messages required' });

  const config = getConfig();
  const ollamaBase = config.ollama_url || 'http://100.73.128.40:11434';
  const chatUrl = config.chat_llm_url || ollamaBase;
  const model = config.chat_llm_model || config.ollama_model || 'qwen2.5-vl:7b';

  const systemLines = [
    'You are a 3D printing expert helping a user understand a print quality issue on their QIDI X-Plus 3 (CoreXY, 0.4mm nozzle).',
    'A vision AI just ran a diagnosis on their print. Answer questions about it conversationally and practically.',
    '',
  ];

  if (context) {
    systemLines.push(`DIAGNOSIS: ${(context.overall_severity || 'unknown').toUpperCase()}`);
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

  const sendEvent = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const r = await fetch(`${chatUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemLines.join('\n') }, ...messages],
        stream: true,
        options: { num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!r.ok) {
      sendEvent({ error: `Chat LLM ${r.status}: ${await r.text()}` });
      return res.end();
    }

    let buf = '';
    for await (const chunk of r.body) {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { res.write('data: [DONE]\n\n'); return res.end(); }
        try {
          const token = JSON.parse(payload).choices?.[0]?.delta?.content || '';
          if (token) sendEvent({ token });
        } catch { /* skip malformed chunk */ }
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    sendEvent({ error: e.message });
    res.end();
  }
});

// GET /api/history
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(getHistory(limit));
});

export { runDiagnosis };
export default router;
