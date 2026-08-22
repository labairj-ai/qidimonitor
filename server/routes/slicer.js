import { Router } from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { getConfig, insertSlicerJob, getSlicerJobs, getSlicerJob, deleteSlicerJob } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const ORCA = '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer';
const PROFILES = '/Applications/OrcaSlicer.app/Contents/Resources/profiles';
const MACHINE = `${PROFILES}/Qidi/machine/Qidi X-Plus 3 0.4 nozzle.json`;

const STLS_DIR = process.env.STLS_DIR ||
  path.join(os.homedir(), 'qidimonitor', 'stls');
fs.mkdirSync(STLS_DIR, { recursive: true });

const FILAMENTS = {
  PLA:      `${PROFILES}/OrcaFilamentLibrary/filament/Generic PLA @System.json`,
  'PLA+':   `${PROFILES}/OrcaFilamentLibrary/filament/Generic PLA High Speed @System.json`,
  PETG:     `${PROFILES}/OrcaFilamentLibrary/filament/Generic PETG @System.json`,
  ABS:      `${PROFILES}/OrcaFilamentLibrary/filament/Generic ABS @System.json`,
  ASA:      `${PROFILES}/Qidi/filament/QIDI ASA-CF @Qidi X-Plus 3 0.4 nozzle.json`,
  TPU:      `${PROFILES}/OrcaFilamentLibrary/filament/Generic TPU @System.json`,
  'PA-CF':  `${PROFILES}/OrcaFilamentLibrary/filament/Generic PA-CF @System.json`,
};

// Quality preset name → the exact OrcaSlicer profile name used as inherits target
const QUALITY_PRESETS = {
  'Fine (0.12mm)':        '0.12mm Fine @Qidi XPlus3',
  'Optimal (0.16mm)':     '0.16mm Optimal @Qidi XPlus3',
  'Standard (0.20mm)':    '0.20mm Standard @Qidi XPlus3',
  'Draft (0.24mm)':       '0.24mm Draft @Qidi XPlus3',
  'Extra Draft (0.28mm)': '0.28mm Extra Draft @Qidi XPlus3',
};

// GET /api/slicer/options
router.get('/options', (_req, res) => {
  res.json({
    materials: Object.keys(FILAMENTS),
    qualities: Object.keys(QUALITY_PRESETS),
    defaults: { material: 'PLA', quality: 'Standard (0.20mm)' },
  });
});

// GET /api/slicer/jobs — list stored STL jobs
router.get('/jobs', (_req, res) => {
  res.json(getSlicerJobs());
});

// GET /api/slicer/jobs/:id/stl — download stored STL
router.get('/jobs/:id/stl', (req, res) => {
  const job = getSlicerJob(req.params.id);
  if (!job || !fs.existsSync(job.stl_path)) return res.status(404).json({ error: 'STL not found' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${job.stl_name}"`);
  fs.createReadStream(job.stl_path).pipe(res);
});

// DELETE /api/slicer/jobs/:id
router.delete('/jobs/:id', (req, res) => {
  const job = getSlicerJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  try { fs.unlinkSync(job.stl_path); } catch { /* already gone */ }
  deleteSlicerJob(req.params.id);
  res.json({ ok: true });
});

// POST /api/slicer/slice — slice uploaded STL
router.post('/slice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No STL file provided' });
  const { settings, result, err } = await doSlice(req.file.buffer, req.file.originalname, req.body);
  if (err) return res.status(500).json({ error: err });

  // Persist STL for future re-slicing
  const jobId = randomUUID();
  const stlPath = path.join(STLS_DIR, `${jobId}.stl`);
  fs.writeFileSync(stlPath, req.file.buffer);
  insertSlicerJob({
    id: jobId,
    stl_name: req.file.originalname,
    stl_path: stlPath,
    gcode_name: result.filename,
    settings,
    created_at: new Date().toISOString(),
  });

  res.json({ ...result, jobId });
});

// POST /api/slicer/reslice/:id — re-slice a stored STL with new settings
router.post('/reslice/:id', async (req, res) => {
  const job = getSlicerJob(req.params.id);
  if (!job || !fs.existsSync(job.stl_path)) return res.status(404).json({ error: 'STL not found' });

  const stlBuffer = fs.readFileSync(job.stl_path);
  const { settings, result, err } = await doSlice(stlBuffer, job.stl_name, req.body);
  if (err) return res.status(500).json({ error: err });

  // Update the job record with new settings + gcode name
  insertSlicerJob({ ...job, gcode_name: result.filename, settings, created_at: new Date().toISOString() });

  res.json({ ...result, jobId: job.id });
});

// --- Shared slice logic ---
async function doSlice(stlBuffer, originalName, body) {
  const {
    material = 'PLA',
    quality = 'Standard (0.20mm)',
    supports = 'none',
    supportBuildPlateOnly = '0',
    brim = 'no_brim',
    brimWidth = '5',
    infillDensity = '15',
    infillPattern = 'grid',
    wallLoops = '3',
    topShells = '3',
    bottomShells = '3',
    ironing = 'no ironing',
    seamPosition = 'aligned',
  } = body;

  const filamentJson = FILAMENTS[material];
  const inheritPreset = QUALITY_PRESETS[quality];
  if (!filamentJson) return { err: `Unknown material: ${material}` };
  if (!inheritPreset) return { err: `Unknown quality: ${quality}` };

  const settings = {
    material, quality, supports, supportBuildPlateOnly: supportBuildPlateOnly === '1',
    brim, brimWidth: Number(brimWidth), infillDensity: Number(infillDensity), infillPattern,
    wallLoops: Number(wallLoops), topShells: Number(topShells), bottomShells: Number(bottomShells),
    ironing, seamPosition,
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qidi-slice-'));
  const stlPath = path.join(tmpDir, originalName);
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(stlPath, stlBuffer);

  // Build single process override that inherits the quality preset
  const overrides = {
    type: 'process',
    name: 'qidi_monitor_slice',
    inherits: inheritPreset,
    from: 'system',
    instantiation: 'true',
    compatible_printers: ['Qidi X-Plus 3 0.4 nozzle'],
    sparse_infill_density: `${infillDensity}%`,
    sparse_infill_pattern: infillPattern,
    brim_type: brim,
    brim_width: String(brimWidth),
    wall_loops: String(wallLoops),
    top_shell_layers: String(topShells),
    bottom_shell_layers: String(bottomShells),
    ironing_type: ironing,
    seam_position: seamPosition,
  };

  if (supports === 'none') {
    overrides.enable_support = '0';
  } else {
    overrides.enable_support = '1';
    overrides.support_type = supports === 'tree' ? 'tree(auto)' : 'normal(auto)';
    overrides.support_on_build_plate_only = supportBuildPlateOnly === '1' ? '1' : '0';
  }

  if (ironing !== 'no ironing') {
    overrides.ironing_type = ironing;
  }

  const overridePath = path.join(tmpDir, 'overrides.json');
  fs.writeFileSync(overridePath, JSON.stringify(overrides));

  try {
    const log = await runSlicer(stlPath, outDir, filamentJson, overridePath);
    const gcodeFile = fs.readdirSync(outDir).find(f => f.endsWith('.gcode'));
    if (!gcodeFile) return { err: `Slicing produced no G-code.\n${log}` };

    const gcodeBuffer = fs.readFileSync(path.join(outDir, gcodeFile));
    const gcodeSize = gcodeBuffer.length;
    const baseName = originalName.replace(/\.stl$/i, '');
    const outputName = `${baseName}_${material}_${quality.replace(/[^a-z0-9]/gi, '_')}.gcode`;

    const config = getConfig();
    const moonrakerBase = config.moonraker_url || (config.printer_ip ? `http://${config.printer_ip}:7125` : null);
    if (!moonrakerBase) return { err: 'Printer not configured' };

    const form = new FormData();
    form.append('file', new Blob([gcodeBuffer]), outputName);
    form.append('root', 'gcodes');
    const uploadRes = await fetch(`${moonrakerBase}/server/files/upload`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(60000),
    });
    if (!uploadRes.ok) return { err: `Printer upload failed: ${await uploadRes.text()}` };

    return { settings, result: { filename: outputName, size: gcodeSize, ...settings } };
  } catch (e) {
    return { err: e.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runSlicer(stlPath, outDir, filamentJson, overrideJson) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ORCA, [
      '--load-settings', MACHINE,
      '--load-filaments', filamentJson,
      '--load-settings', overrideJson,
      '--outputdir', outDir,
      '--slice', '0',
      stlPath,
    ], { timeout: 300000 });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    proc.on('close', code => code === 0 ? resolve(log) : reject(new Error(`OrcaSlicer exit ${code}: ${log.slice(-500)}`)));
    proc.on('error', reject);
  });
}

export default router;
