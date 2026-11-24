import { Router } from 'express';
import { getConfig, setConfig } from '../db.js';

import { monitor } from '../monitorRuntime.js';
import { monitorSetup } from '../monitor.js';
import { AUTO_FLAGS } from '../diagnosisFixes.js';
import { validateSettings } from '../printers.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(getConfig(req.printerId));
});

router.put('/', (req, res) => {
  const allowed = [...Object.values(AUTO_FLAGS),'name', 'camera_stream_url', 'controls_enabled', 'printer_ip', 'camera_url', 'moonraker_url', 'ollama_url', 'ollama_model', 'auto_enabled', 'auto_interval_min', 'chat_llm_url', 'chat_llm_model'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  try { validateSettings(updates); } catch (e) { return res.status(400).json({ error: e.message }); }
  const before = getConfig(req.printerId);
  const after = { ...before, ...updates };
  if (after.model !== 'qidi' && Object.values(AUTO_FLAGS).some(flag => after[flag] === '1')) return res.status(409).json({error:'Automatic adjustments are currently QIDI-only.'});
  if (after.auto_enabled === '1' && monitorSetup(after)) return res.status(409).json({ error:monitorSetup(after) });
  setConfig(updates, req.printerId);
  monitor.configurationChanged(req.printerId,before,after);
  res.json({ ok: true });
});

export default router;
