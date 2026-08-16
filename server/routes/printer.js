import { Router } from 'express';
import fetch from 'node-fetch';
import { getConfig } from '../db.js';

const router = Router();

function moonrakerUrl(config) {
  if (config.moonraker_url) return config.moonraker_url;
  if (config.printer_ip) return `http://${config.printer_ip}:7125`;
  return null;
}

function cameraSnapshotUrl(config) {
  if (config.camera_url) return config.camera_url;
  if (config.printer_ip) return `http://${config.printer_ip}/webcam/?action=snapshot`;
  return null;
}

function cameraStreamUrl(config) {
  if (config.printer_ip) return `http://${config.printer_ip}/webcam/?action=stream`;
  return null;
}

// GET /api/printer/status
router.get('/status', async (req, res) => {
  const config = getConfig();
  const base = moonrakerUrl(config);
  if (!base) return res.status(400).json({ error: 'Printer IP not configured' });

  try {
    const url = `${base}/printer/objects/query?print_stats&extruder&heater_bed&display_status`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Moonraker ${r.status}`);
    const data = await r.json();
    res.json(data.result?.status || data);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// GET /api/printer/snapshot — returns raw image bytes
router.get('/snapshot', async (req, res) => {
  const config = getConfig();
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
  const config = getConfig();
  const url = cameraStreamUrl(config);
  if (!url) return res.status(400).json({ error: 'Printer IP not configured' });

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Stream ${r.status}`);
    res.set('Content-Type', r.headers.get('content-type') || 'multipart/x-mixed-replace');
    res.set('Cache-Control', 'no-cache');
    r.body.pipe(res);
    req.on('close', () => r.body.destroy());
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

export default router;
