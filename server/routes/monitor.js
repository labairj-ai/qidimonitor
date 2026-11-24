import { Router } from 'express';
import { monitor } from '../monitorRuntime.js';
import { getConfig, getHistory } from '../db.js';
import { getPrinterContext } from '../printerContext.js';
import { belongsToPrint } from '../../client/src/diagnosisSession.mjs';
const router = Router();
router.get('/', async (req,res) => {
  const ctx = await getPrinterContext(getConfig(req.printerId));
  const [latest] = ctx?.filename ? getHistory(1, req.printerId, 0,
    record => record.auto_triggered && belongsToPrint(record, ctx)) : [];
  res.json({
    ...monitor.status(req.printerId),
    last_success_at: latest ? Date.parse(latest.timestamp) : null,
    latest_diagnosis: latest ? { id: latest.id, timestamp: latest.timestamp, severity: latest.overall_severity } : null,
  });
});
router.post('/check', (req,res) => {
  try { res.status(202).json(monitor.check(req.printerId)); }
  catch(e) { res.status(409).json({ error:e.message }); }
});
export default router;
