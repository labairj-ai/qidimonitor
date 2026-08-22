import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import configRouter from './routes/config.js';
import printerRouter from './routes/printer.js';
import diagnoseRouter from './routes/diagnose.js';
import filesRouter from './routes/files.js';
import slicerRouter from './routes/slicer.js';
import { getConfig, insertDiagnosis } from './db.js';
import { runDiagnosis } from './routes/diagnose.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4200;
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

const app = express();
app.use(express.json());

app.use('/api/config', configRouter);
app.use('/api/printer', printerRouter);
app.use('/api', diagnoseRouter);
app.use('/api/files', filesRouter);
app.use('/api/slicer', slicerRouter);

// Serve React SPA in production
app.use(express.static(CLIENT_DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`qidimonitor running on port ${PORT}`);
  startAutoMonitor();
});

// --- Auto-monitor loop ---
let lastAutoDiagTime = 0;

async function startAutoMonitor() {
  setInterval(async () => {
    const config = getConfig();
    if (config.auto_enabled !== '1') return;

    const intervalMs = (parseInt(config.auto_interval_min) || 10) * 60 * 1000;
    if (Date.now() - lastAutoDiagTime < intervalMs) return;

    // Check if printing
    const base = config.moonraker_url || (config.printer_ip ? `http://${config.printer_ip}:7125` : null);
    if (!base) return;

    try {
      const r = await fetch(`${base}/printer/objects/query?print_stats`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const data = await r.json();
      const stats = data.result?.status?.print_stats;
      if (stats?.state !== 'printing') return;

      const snapshotUrl = config.camera_url || (config.printer_ip ? `http://${config.printer_ip}/webcam/?action=snapshot` : null);
      if (!snapshotUrl) return;

      const imgR = await fetch(snapshotUrl, { signal: AbortSignal.timeout(8000) });
      if (!imgR.ok) return;
      const imageBuffer = Buffer.from(await imgR.arrayBuffer());

      lastAutoDiagTime = Date.now();
      await runDiagnosis({ imageBuffer, imagePath: null, printFile: stats.filename, autoTriggered: true, config });
      console.log(`[auto] Diagnosis complete for ${stats.filename || 'unknown'}`);
    } catch (e) {
      // silent — printer may be offline
    }
  }, 60 * 1000);
}
