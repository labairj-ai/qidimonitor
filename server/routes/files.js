import { Router } from 'express';
import fetch from 'node-fetch';
import multer from 'multer';
import { getConfig } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

function base(config) {
  return config.moonraker_url || (config.printer_ip ? `http://${config.printer_ip}:7125` : null);
}

// GET /api/files — list gcode files with metadata
router.get('/', async (req, res) => {
  const config = getConfig();
  const b = base(config);
  if (!b) return res.status(400).json({ error: 'Printer not configured' });

  try {
    const listRes = await fetch(`${b}/server/files/list?root=gcodes`, { signal: AbortSignal.timeout(8000) });
    if (!listRes.ok) throw new Error(`File list ${listRes.status}`);
    const files = (await listRes.json()).result
      .filter(f => !f.path.startsWith('.') && /\.(gcode|gco|g)$/i.test(f.path))
      .sort((a, b) => b.modified - a.modified);

    // Fetch metadata for all files in parallel batches
    const BATCH = 8;
    const withMeta = [];
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async f => {
        try {
          const r = await fetch(`${b}/server/files/metadata?filename=${encodeURIComponent(f.path)}`, {
            signal: AbortSignal.timeout(3000),
          });
          return { ...f, meta: r.ok ? (await r.json()).result : null };
        } catch {
          return { ...f, meta: null };
        }
      }));
      withMeta.push(...results);
    }

    res.json(withMeta);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// POST /api/files/upload — upload gcode to printer
router.post('/upload', upload.single('file'), async (req, res) => {
  const config = getConfig();
  const b = base(config);
  if (!b) return res.status(400).json({ error: 'Printer not configured' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer]), req.file.originalname);
    form.append('root', 'gcodes');

    const r = await fetch(`${b}/server/files/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`Upload failed: ${await r.text()}`);
    res.json((await r.json()).result || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/files — delete a gcode file
router.delete('/', async (req, res) => {
  const config = getConfig();
  const b = base(config);
  const { filename } = req.body;
  if (!b) return res.status(400).json({ error: 'Printer not configured' });
  if (!filename) return res.status(400).json({ error: 'Filename required' });

  try {
    const r = await fetch(`${b}/server/files/gcodes/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Delete failed: ${r.status}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/print/start
router.post('/print/start', async (req, res) => {
  const config = getConfig();
  const b = base(config);
  const { filename } = req.body;
  if (!b) return res.status(400).json({ error: 'Printer not configured' });
  if (!filename) return res.status(400).json({ error: 'Filename required' });

  try {
    const r = await fetch(`${b}/printer/print/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Start failed: ${await r.text()}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/print/pause|resume|cancel
for (const action of ['pause', 'resume', 'cancel']) {
  router.post(`/print/${action}`, async (req, res) => {
    const config = getConfig();
    const b = base(config);
    if (!b) return res.status(400).json({ error: 'Printer not configured' });
    try {
      const r = await fetch(`${b}/printer/print/${action}`, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`${action} failed: ${r.status}`);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

export default router;
