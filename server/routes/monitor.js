import { Router } from 'express';
import { monitor } from '../monitorRuntime.js';
import { getLatestAutoDiagnosis } from '../db.js';
const router = Router();
router.get('/', (req,res) => {
  const latest = getLatestAutoDiagnosis(req.printerId);
  res.json({ ...monitor.status(req.printerId), latest_diagnosis:latest });
});
router.post('/check', (req,res) => {
  try { res.status(202).json(monitor.check(req.printerId)); }
  catch(e) { res.status(409).json({ error:e.message }); }
});
export default router;
