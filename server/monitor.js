import fetch from 'node-fetch';
import { listPrinters } from './db.js';
import { runDiagnosis } from './routes/diagnose.js';

export function createMonitor({ printers = listPrinters, request = fetch, diagnose = runDiagnosis, now = Date.now } = {}) {
  const lastRun = new Map();
  const busy = new Set();
  return async function tick() {
    await Promise.all(printers().map(async config => {
      if (config.auto_enabled !== '1' || busy.has(config.id)) return;
      const interval = Math.max(1, Number(config.auto_interval_min) || 10) * 60000;
      if (now() - (lastRun.get(config.id) || 0) < interval) return;
      const base = config.moonraker_url || (config.printer_ip ? `http://${config.printer_ip}:7125` : null);
      const camera = config.camera_url || (config.model === 'qidi' && config.printer_ip ? `http://${config.printer_ip}/webcam/?action=snapshot` : null);
      if (!base || !camera) return;
      busy.add(config.id);
      try {
        const r = await request(`${base}/printer/objects/query?print_stats`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return;
        const stats = (await r.json()).result?.status?.print_stats;
        if (stats?.state !== 'printing') return;
        const image = await request(camera, { signal: AbortSignal.timeout(8000) });
        if (!image.ok) return;
        await diagnose({ imageBuffer: Buffer.from(await image.arrayBuffer()), printFile: stats.filename, autoTriggered: true, config });
      } catch (e) { console.warn(`[auto:${config.id}] ${e.message}`); }
      finally { lastRun.set(config.id, now()); busy.delete(config.id); }
    }));
  };
}
