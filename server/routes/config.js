import { Router } from 'express';
import { getConfig, setConfig } from '../db.js';

import { validateSettings } from '../printers.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(getConfig(req.printerId));
});

router.put('/', (req, res) => {
  const allowed = ['name', 'camera_stream_url', 'controls_enabled', 'printer_ip', 'camera_url', 'moonraker_url', 'ollama_url', 'ollama_model', 'auto_enabled', 'auto_interval_min', 'chat_llm_url', 'chat_llm_model'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  try { validateSettings(updates); } catch (e) { return res.status(400).json({ error: e.message }); }
  setConfig(updates, req.printerId);
  res.json({ ok: true });
});

export default router;
