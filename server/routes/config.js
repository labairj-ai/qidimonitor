import { Router } from 'express';
import { getConfig, setConfig } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(getConfig());
});

router.put('/', (req, res) => {
  const allowed = ['printer_ip', 'camera_url', 'moonraker_url', 'ollama_url', 'ollama_model', 'auto_enabled', 'auto_interval_min'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  setConfig(updates);
  res.json({ ok: true });
});

export default router;
