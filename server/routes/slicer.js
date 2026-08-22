import { Router } from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getConfig } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const ORCA = '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer';
const PROFILES = '/Applications/OrcaSlicer.app/Contents/Resources/profiles';

const MACHINE = `${PROFILES}/Qidi/machine/Qidi X-Plus 3 0.4 nozzle.json`;

const FILAMENTS = {
  PLA:      `${PROFILES}/OrcaFilamentLibrary/filament/Generic PLA @System.json`,
  'PLA+':   `${PROFILES}/OrcaFilamentLibrary/filament/Generic PLA High Speed @System.json`,
  PETG:     `${PROFILES}/OrcaFilamentLibrary/filament/Generic PETG @System.json`,
  ABS:      `${PROFILES}/OrcaFilamentLibrary/filament/Generic ABS @System.json`,
  ASA:      `${PROFILES}/Qidi/filament/QIDI ASA-CF @Qidi X-Plus 3 0.4 nozzle.json`,
  TPU:      `${PROFILES}/OrcaFilamentLibrary/filament/Generic TPU @System.json`,
  'PA-CF':  `${PROFILES}/OrcaFilamentLibrary/filament/Generic PA-CF @System.json`,
};

const QUALITY_PRESETS = {
  'Fine (0.12mm)':        `${PROFILES}/Qidi/process/0.12mm Fine @Qidi XPlus3.json`,
  'Optimal (0.16mm)':     `${PROFILES}/Qidi/process/0.16mm Optimal @Qidi XPlus3.json`,
  'Standard (0.20mm)':    `${PROFILES}/Qidi/process/0.20mm Standard @Qidi XPlus3.json`,
  'Draft (0.24mm)':       `${PROFILES}/Qidi/process/0.24mm Draft @Qidi XPlus3.json`,
  'Extra Draft (0.28mm)': `${PROFILES}/Qidi/process/0.28mm Extra Draft @Qidi XPlus3.json`,
};

// GET /api/slicer/options
router.get('/options', (_req, res) => {
  res.json({
    materials: Object.keys(FILAMENTS),
    qualities: Object.keys(QUALITY_PRESETS),
    defaults: { material: 'PLA', quality: 'Standard (0.20mm)' },
  });
});

// POST /api/slicer/slice — slice STL and upload resulting G-code to printer
router.post('/slice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No STL file provided' });

  const { material = 'PLA', quality = 'Standard (0.20mm)' } = req.body;
  const filamentJson = FILAMENTS[material];
  const processJson = QUALITY_PRESETS[quality];

  if (!filamentJson) return res.status(400).json({ error: `Unknown material: ${material}` });
  if (!processJson) return res.status(400).json({ error: `Unknown quality: ${quality}` });

  // Write STL to a temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qidi-slice-'));
  const stlPath = path.join(tmpDir, req.file.originalname);
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(stlPath, req.file.buffer);

  try {
    // Run OrcaSlicer
    const log = await runSlicer(stlPath, outDir, filamentJson, processJson);

    // Find the generated G-code file
    const gcodeFile = fs.readdirSync(outDir).find(f => f.endsWith('.gcode'));
    if (!gcodeFile) throw new Error(`Slicing produced no G-code output.\n${log}`);

    const gcodePath = path.join(outDir, gcodeFile);
    const gcodeBuffer = fs.readFileSync(gcodePath);
    const gcodeSize = gcodeBuffer.length;

    // Derive a clean output filename
    const baseName = req.file.originalname.replace(/\.stl$/i, '');
    const outputName = `${baseName}_${material}_${quality.replace(/[^a-z0-9]/gi, '_')}.gcode`;

    // Upload G-code to the printer via Moonraker
    const config = getConfig();
    const moonrakerBase = config.moonraker_url || (config.printer_ip ? `http://${config.printer_ip}:7125` : null);
    if (!moonrakerBase) throw new Error('Printer not configured');

    const form = new FormData();
    form.append('file', new Blob([gcodeBuffer]), outputName);
    form.append('root', 'gcodes');

    const uploadRes = await fetch(`${moonrakerBase}/server/files/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!uploadRes.ok) throw new Error(`Printer upload failed: ${await uploadRes.text()}`);

    res.json({ filename: outputName, size: gcodeSize, material, quality });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function runSlicer(stlPath, outDir, filamentJson, processJson) {
  return new Promise((resolve, reject) => {
    const args = [
      '--load-settings', MACHINE,
      '--load-filaments', filamentJson,
      '--load-settings', processJson,
      '--outputdir', outDir,
      '--slice', '0',
      stlPath,
    ];

    const proc = spawn(ORCA, args, { timeout: 300000 });
    let log = '';
    proc.stdout.on('data', d => { log += d.toString(); });
    proc.stderr.on('data', d => { log += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(log);
      else reject(new Error(`OrcaSlicer exited ${code}:\n${log.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

export default router;
