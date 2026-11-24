import fetch from 'node-fetch';
import { getConfig, setConfig } from './db.js';
import { getPrinterContext } from './printerContext.js';
import { executeFix, validateFixContext, readFixState, AUTO_FLAGS } from './diagnosisFixes.js';
import { getFix, claimFix, finishFix, recordFixEvent } from './fixStore.js';
import { recordCorrection, validateCorrectionMemory } from './correctionMemory.js';

export { AUTO_FLAGS };
export const busyAdjustments = new Set();
export async function applySavedFix(id, printerId, { undo=false, automatic=false, scheduled=false } = {}) {
  if (busyAdjustments.has(printerId)) throw new Error('A printer adjustment is already in progress.');
  const fix=getFix(id,printerId);
  if (!fix) throw new Error('Fix not found');
  busyAdjustments.add(printerId);let claimed=false;
  try {
    const config=getConfig(printerId);
    if (config.model !== 'qidi') throw new Error('Fixes are currently available for the QIDI only.');
    const connection=config.moonraker_url || `http://${config.printer_ip}:7125`;
    if (fix.connection !== connection) throw new Error('The printer connection changed. Run a new diagnosis.');
    const ctx=await getPrinterContext(config);
    validateFixContext(fix,ctx,{undo,appliedAt:fix.applied_at});
    validateCorrectionMemory(fix,ctx,config,{undo});
    const fresh=getConfig(printerId);
    if ((fresh.moonraker_url || `http://${fresh.printer_ip}:7125`) !== connection) throw new Error('The printer connection changed.');
    if (automatic && scheduled && fresh.auto_enabled !== '1') throw new Error('Automatic monitoring was disabled; no setting change was submitted.');
    if (automatic && (!AUTO_FLAGS[fix.control] || fresh[AUTO_FLAGS[fix.control]] !== '1')) throw new Error('Automatic application is disabled for this control.');
    const action=undo?'undo':'apply';
    claimFix(fix,action,Date.now(),automatic?'automatic':'manual');claimed=true;
    const result=await executeFix({fix,undo,config,request:fetch,context:cfg=>readFixState(cfg,fetch,fix.control,fix.baseline.active_extruder)});
    finishFix(fix,action,{...result,source:automatic?'automatic':'manual'});
    if (result.confirmed) await recordCorrection(fix,config,{undo}).catch(e=>console.warn(`[fix:${printerId}] Comparison image unavailable: ${e.message}`));
    if ((undo || !result.confirmed) && AUTO_FLAGS[fix.control]) setConfig({[AUTO_FLAGS[fix.control]]:'0'},printerId);
    return {...result,fix:getFix(id,printerId)};
  } catch(e) {
    if (!claimed) throw e;
    finishFix(fix,undo?'undo':'apply',{confirmed:false,source:automatic?'automatic':'manual',message:`Change could not be confirmed: ${e.message}. Inspect live controls; it will not be resent.`});
    if (AUTO_FLAGS[fix.control]) setConfig({[AUTO_FLAGS[fix.control]]:'0'},printerId);
    return {confirmed:false,message:e.message,fix:getFix(id,printerId)};
  } finally {busyAdjustments.delete(printerId);}
}
export async function autoApplyFixes(fixes, originalConfig, {scheduled=false}={}) {
  const results=[];
  for (const fix of fixes) {
    const flag=AUTO_FLAGS[fix.control];
    if (!flag || originalConfig[flag] !== '1') continue;
    try {results.push(await applySavedFix(fix.id,fix.printer_id,{automatic:true,scheduled}));}
    catch(e) {recordFixEvent(fix,'auto_apply','skipped',{source:'automatic',message:e.message});results.push({confirmed:false,skipped:true,message:e.message});}
  }
  return results;
}
