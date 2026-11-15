import { Router } from 'express';
import fetch from 'node-fetch';
import { getConfig, getDiagnosis } from '../db.js';
import { getPrinterContext } from '../printerContext.js';
import { executeFix, validateFixContext, readFixState } from '../diagnosisFixes.js';
import { listFixes, fixEvents, getFix, claimFix, finishFix, dismissFix, recentFixes, recentFixEvents } from '../fixStore.js';

const router = Router();
const busy = new Set();
router.get('/fixes/recent', (req,res) => res.json({ fixes: recentFixes(req.printerId), events: recentFixEvents(req.printerId) }));
router.get('/:diagnosisId/fixes', (req,res) => {
  const diagnosis = getDiagnosis(req.params.diagnosisId,req.printerId);
  if (!diagnosis) return res.status(404).json({ error: 'Diagnosis not found' });
  res.json({ fixes: listFixes(diagnosis.id,req.printerId), events: fixEvents(diagnosis.id,req.printerId),
    note: 'Review first: no changes are automatic. One small adjustment per diagnosis. Recheck the print after a change.' });
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
  if (busy.has(req.printerId)) return res.status(409).json({ error: 'A printer adjustment is already in progress.' });
  busy.add(req.printerId);
  let claimed = false;
  try {
    const config = getConfig(req.printerId);
    if (config.model !== 'qidi') throw new Error('Reviewed fixes are currently available for the QIDI only.');
    const connection = config.moonraker_url || `http://${config.printer_ip}:7125`;
    if (fix.connection !== connection) throw new Error('The printer connection has changed. Run a new diagnosis.');
    const context = await getPrinterContext(config);
    validateFixContext(fix,context,{ undo: action === 'undo', appliedAt: fix.applied_at });
    claimFix(fix,action); claimed = true;
    const result = await executeFix({ fix, undo: action === 'undo', config, request: fetch, context: cfg => readFixState(cfg,fetch,fix.control) });
    finishFix(fix,action,result);
    res.status(result.confirmed ? 200 : 202).json({ ...result, fix: getFix(fixId,req.printerId) });
  } catch (e) {
    if (claimed) finishFix(fix,action,{ confirmed:false, message: `Change could not be confirmed: ${e.message}. Check live controls; this fix will not be resent.` });
    res.status(claimed ? 202 : 409).json({ error: e.message, fix: getFix(fixId,req.printerId) });
  } finally { busy.delete(req.printerId); }
});
export default router;
