import { Router } from 'express';
import fetch from 'node-fetch';
import { getConfig } from '../db.js';
import { discoverPrinter, isDiscovering } from '../discovery.js';
import { getPrinterContext } from '../printerContext.js';

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

// Try a fetch; on network failure, auto-discover and retry once
async function fetchWithRediscover(urlFn, fetchFn) {
  const config = getConfig();
  let url = urlFn(config);
  if (!url) return { error: 'not_configured' };

  try {
    return await fetchFn(url, config);
  } catch (e) {
    if (!isDiscovering() && config.printer_ip) {
      const newIp = await discoverPrinter(config.printer_ip);
      if (newIp) {
        const newConfig = getConfig();
        const newUrl = urlFn(newConfig);
        try {
          return await fetchFn(newUrl, newConfig);
        } catch (e2) {
          throw e2;
        }
      }
    }
    throw e;
  }
}

// GET /api/printer/status
router.get('/status', async (req, res) => {
  try {
    const result = await fetchWithRediscover(
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
    const r = await fetch(url); // no timeout — stream runs until client disconnects
    if (!r.ok) throw new Error(`Stream ${r.status}`);
    res.set('Content-Type', r.headers.get('content-type') || 'multipart/x-mixed-replace');
    res.set('Cache-Control', 'no-cache');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders();
    r.body.pipe(res);
    const cleanup = () => r.body.destroy();
    req.on('close', cleanup);
    req.on('error', cleanup);
    r.body.on('error', () => res.destroy());
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// POST /api/printer/discover — manual discovery trigger
router.post('/discover', async (req, res) => {
  if (isDiscovering()) {
    return res.json({ status: 'in_progress' });
  }
  const config = getConfig();
  const ip = await discoverPrinter(config.printer_ip);
  if (ip) {
    res.json({ status: 'found', ip });
  } else {
    res.status(404).json({ status: 'not_found' });
  }
});

// GET /api/printer/discover — check if discovery is running
router.get('/discover', (req, res) => {
  res.json({ discovering: isDiscovering(), printer_ip: getConfig().printer_ip });
});

// GET /api/printer/context — full printer context with material profile + deviations
router.get('/context', async (req, res) => {
  const config = getConfig();
  const ctx = await getPrinterContext(config);
  if (!ctx) return res.status(503).json({ error: 'Printer unreachable' });
  res.json(ctx);
});

export default router;
