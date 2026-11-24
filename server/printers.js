import { AUTO_FLAGS } from './diagnosisFixes.js';
import { Router } from 'express';
import fetch from 'node-fetch';
import { getConfig, listPrinters } from './db.js';

export function validateSettings(updates) {
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value !== 'string' || value.length > 1000) throw new Error('Settings must be text, up to 1000 characters');
    if (key.endsWith('_url') && value) {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) URL without embedded credentials');
    }
    if (key === 'printer_ip' && value && !/^[a-zA-Z0-9.-]+$/.test(value)) throw new Error('Enter an IP address or hostname without a port or path');
    if (['auto_enabled','controls_enabled',...Object.values(AUTO_FLAGS)].includes(key) && !['0','1'].includes(value)) throw new Error('Invalid toggle');
    if (key === 'auto_interval_min' && (!/^\d+$/.test(value) || +value < 1 || +value > 1440)) throw new Error('Monitoring interval must be 1–1440 minutes');
    if (key === 'name' && !value.trim()) throw new Error('Printer name is required');
  }
}

export function printerScope(req, res, next) {
  const id = req.params.printerId;
  if (!listPrinters().some(p => p.id === id)) return res.status(404).json({ error: 'Unknown printer' });
  req.printerId = id;
  const config = getConfig(id);
  if (config.model === 'u1' && config.controls_enabled !== '1' && req.method !== 'GET' &&
      (req.path.startsWith('/files') || req.path === '/printer/gcode')) {
    return res.status(409).json({ error: 'Enable U1 controls in Settings after verifying its connection and identity.' });
  }
  next();
}

export const printersRouter = Router();
printersRouter.get('/', (_req, res) => res.json(listPrinters()));
printersRouter.post('/:printerId/test', async (req, res) => {
  if (!listPrinters().some(p => p.id === req.params.printerId)) return res.status(404).json({ error: 'Unknown printer' });
  const config = getConfig(req.params.printerId);
  const base = config.moonraker_url || (config.printer_ip ? `http://${config.printer_ip}:7125` : null);
  if (!base) return res.status(400).json({ error: 'Save a printer address first' });
  try {
    const r = await fetch(`${base}/printer/info`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Printer returned ${r.status}`);
    const data = await r.json();
    if (!data.result?.hostname) throw new Error('Expected a Klipper printer response');
    const cameras = await fetch(`${base}/server/webcams/list`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null).catch(() => null);
    const resolveCamera = value => {
      if (!value) return '';
      try {
        const url = new URL(value, base);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch { return ''; }
    };
    const webcams = (cameras?.result?.webcams || []).map(c => ({ name: c.name, snapshot_url: resolveCamera(c.snapshot_url), stream_url: resolveCamera(c.stream_url) }));
    res.json({ ok: true, hostname: data.result.hostname, state: data.result.state, webcams, note: 'Check the hostname against this printer before enabling controls. Camera URLs can be copied into Settings.' });
  } catch (e) { res.status(503).json({ error: e.message }); }
});
