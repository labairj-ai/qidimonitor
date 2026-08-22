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
    {"category": "stringing", "severity": "minor", "suggestion": "Lower retraction distance or increase travel speed"}
  ],
  "summary": "One sentence overall assessment of the print quality."
}

overall_severity must be one of: ok, warning, critical
severity for each issue must be one of: minor, moderate, severe
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
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userText, images: [base64] },
    ],
    stream: false,
  };

  const r = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const raw = data.message?.content || data.response || '';

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

// GET /api/history
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(getHistory(limit));
});

export { runDiagnosis };
export default router;
