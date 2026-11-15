import { Router } from 'express';
import { getDiagnosis } from '../db.js';
import { applySavedFix } from '../fixService.js';
import { listFixes, fixEvents, getFix, dismissFix, recentFixes, recentFixEvents } from '../fixStore.js';

const router = Router();
router.get('/fixes/recent', (req,res) => res.json({ fixes: recentFixes(req.printerId), events: recentFixEvents(req.printerId) }));
router.get('/:diagnosisId/fixes', (req,res) => {
  const diagnosis = getDiagnosis(req.params.diagnosisId,req.printerId);
  if (!diagnosis) return res.status(404).json({ error: 'Diagnosis not found' });
  res.json({ fixes: listFixes(diagnosis.id,req.printerId), events: fixEvents(diagnosis.id,req.printerId),
    note: 'Eligible nozzle and flow changes may apply automatically when enabled. Other fixes require review.' });
});
router.post('/fixes/:fixId/:action', async (req,res) => {
  const { action, fixId } = req.params;
  if (!['apply','undo','dismiss'].includes(action)) return res.status(404).json({ error: 'Unknown action' });
  const fix = getFix(fixId,req.printerId);
  if (!fix) return res.status(404).json({ error: 'Fix not found' });
  if (action === 'dismiss') {
    try { dismissFix(fix); return res.json({ confirmed: true }); }
    catch(e) { return res.status(409).json({ error: e.message }); }
  }
  try {
    const result=await applySavedFix(fixId,req.printerId,{undo:action==='undo'});
    res.status(result.confirmed?200:202).json(result);
  } catch(e) {res.status(409).json({error:e.message,fix:getFix(fixId,req.printerId)});}
});
export default router;
