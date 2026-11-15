import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fetch from 'node-fetch';
import { fileURLToPath } from 'node:url';
import db, { getHistory } from './db.js';
import { saveFixes, finishFix } from './fixStore.js';
import { getPrinterContext } from './printerContext.js';

const snapshots=()=>process.env.SNAPSHOTS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)),'..','snapshots');
const camera=config=>config.camera_url || (config.model==='qidi' && config.printer_ip ? `http://${config.printer_ip}/webcam/?action=snapshot` : null);
const connection=config=>config.moonraker_url || `http://${config.printer_ip}:7125`;
const start=ctx=>ctx?.captured_at-ctx?.print_total_duration_sec*1000;
db.exec('CREATE TABLE IF NOT EXISTS correction_observations (fix_id TEXT PRIMARY KEY,printer_id TEXT NOT NULL,payload TEXT NOT NULL)');
const store=obs=>db.prepare('INSERT OR REPLACE INTO correction_observations VALUES (?,?,?)').run(obs.fix_id,obs.printer_id,JSON.stringify(obs));
export function correctionMemory(ctx,config) {
  if (!ctx || !Number.isFinite(start(ctx))) return [];
  return db.prepare("SELECT f.payload,f.id,f.state,f.updated_at,f.applied_at,o.payload AS observation FROM diagnosis_fixes f LEFT JOIN correction_observations o ON o.fix_id=f.id WHERE f.printer_id=? AND (f.state IN ('applied','undone','unconfirmed') OR (f.state='dismissed' AND EXISTS(SELECT 1 FROM diagnosis_fix_events e WHERE e.fix_id=f.id AND e.outcome='unconfirmed')))").all(config.id).flatMap(row=>{
    const f=JSON.parse(row.payload),b=f.baseline;
    if (f.connection!==connection(config) || b.filename!==ctx.filename || b.active_extruder!==ctx.active_extruder || b.filament_type!==ctx.filament_type || !Number.isFinite(start(b)) || Math.abs(start(b)-start(ctx))>30000) return [];
    const at=row.state==='undone'?row.updated_at:(row.applied_at || row.updated_at);
    return [row.observation?JSON.parse(row.observation):{id:`pending-${f.id}`,fix_id:f.id,printer_id:config.id,category:f.category,control:f.control,value:row.state==='undone'?f.before:f.after,at,settle_until:at+(f.control==='nozzle'?120000:60000),reference:null,reference_settled:false,context:b}];
  }).sort((a,b)=>b.at-a.at);
}
function saveImage(obs,image,ctx,settled,config) {
  fs.mkdirSync(snapshots(),{recursive:true});
  const file=path.join(snapshots(),`followup_${obs.printer_id}_${randomUUID()}.jpg`);
  fs.writeFileSync(file,image);
  const next={...obs,id:randomUUID(),reference:file,reference_at:Date.now(),reference_z:ctx.z_mm,reference_duration:ctx.print_duration_sec,reference_settled:settled,camera_url:camera(config)};
  store(next);return next;
}
export async function recordCorrection(fix,config,{undo=false}={}) {
  const at=Date.now();
  const obs={id:randomUUID(),fix_id:fix.id,printer_id:fix.printer_id,category:fix.category,control:fix.control,value:undo?fix.before:fix.after,at,settle_until:at+(fix.control==='nozzle'?120000:60000),reference:null,reference_settled:false,context:fix.baseline};
  store(obs); // Missing camera evidence must still prevent a repeat correction.
  const ctx=await getPrinterContext(config);
  const url=camera(config);if(!url || !ctx) return;
  const r=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(`Camera ${r.status}`);
  const image=Buffer.from(await r.arrayBuffer());if(!image.length) throw new Error('Empty comparison image');
  saveImage(obs,image,ctx,false,config);
}
export function prepareFollowup(ctx,config,image,{now=Date.now()}={}) {
  const memories=correctionMemory(ctx,config);
  if(!memories.length) return null;
  let latest=memories[0];
  const categories=[...new Set(memories.map(m=>m.category))];
  const settled=now>=latest.settle_until && (latest.control!=='nozzle' || (Number.isFinite(ctx.nozzle_temp) && Math.abs(ctx.nozzle_temp-ctx.nozzle_target)<=3));
  const target=latest.control==='nozzle'?ctx.nozzle_target:latest.control==='flow'?ctx.flow_pct:null;
  const oldTarget=latest.control==='nozzle'?latest.reference_target:latest.control==='flow'?latest.reference_flow:null;
  if(latest.reference_settled && oldTarget!=null && target!==oldTarget) {
    latest={...latest,reference_settled:false,settle_until:now+(latest.control==='nozzle'?120000:60000)};store(latest);
    return {categories,reference_id:latest.id,ready:false,images:[],note:'A control changed again. Waiting to establish a fresh comparison image.'};
  }
  if(settled && (!latest.reference_settled || latest.camera_url!==camera(config) || !latest.reference || !fs.existsSync(latest.reference))) {
    latest=saveImage({...latest,reference_target:ctx.nozzle_target,reference_flow:ctx.flow_pct},image,ctx,true,config);
    return {categories,reference_id:latest.id,ready:false,images:[],note:'Saved a new baseline after the adjustment settled. Existing defects are historical; the next check will inspect new material.'};
  }
  const progressed=Number.isFinite(ctx.z_mm) && Number.isFinite(latest.reference_z) && ctx.z_mm>=latest.reference_z+Math.max(0.2,ctx.layer_height || 0.2) && ctx.print_duration_sec>latest.reference_duration;
  const ready=settled && latest.reference_settled && progressed && latest.reference && fs.existsSync(latest.reference);
  return {categories,reference_id:latest.id,ready:!!ready,images:ready?[fs.readFileSync(latest.reference).toString('base64')]:[],reference_at:latest.reference_at,reference_z:latest.reference_z,
    note:ready?'Compare only newly deposited material against the saved post-fix baseline.':!settled?'Waiting for the adjustment to settle. Previously corrected issues will not trigger another fix.':'Waiting for new material above the saved baseline. Existing defects will not trigger another fix.'};
}
export function filterFollowup(parsed,followup) {
  if(!followup) return {parsed,metadata:null};
  const excluded=[];const verified=[];
  const issues=(parsed.issues || []).filter(issue=>{
    if(!followup.categories.includes(issue.category)) return true;
    const fresh=followup.ready && parsed.comparison?.clear_view===true && parsed.comparison?.reference_id===followup.reference_id && issue.observation==='new' && typeof issue.new_evidence==='string' && issue.new_evidence.trim().length>=20;
    if(fresh) {verified.push(issue.category);return true;}
    excluded.push(issue.category);return false;
  });
  return {parsed:{...parsed,issues,overall_severity:excluded.length && !issues.length ? 'warning' : parsed.overall_severity},metadata:{...followup,images:undefined,excluded_categories:[...new Set(excluded)],verified_categories:verified}};
}
export function validateCorrectionMemory(fix,ctx,config,{undo=false}={}) {
  if(undo) return;
  const memories=correctionMemory(ctx,config);
  if(!memories.some(m=>m.category===fix.category)) return;
  const latest=memories[0];
  if(!fix.followup_reference || fix.followup_reference!==latest.id || !latest.reference_settled) throw new Error('This issue was already corrected. A clear comparison showing new defects after the fix is required.');
}

export async function recordManualCorrection(control,before,after,ctx,config) {
  if(before===after || !Number.isFinite(before) || !Number.isFinite(after)) return;
  const d=getHistory(1,config.id)[0], b=d?.printer_context;
  if(!b || b.filename!==ctx.filename || b.active_extruder!==ctx.active_extruder || b.filament_type!==ctx.filament_type || !Number.isFinite(start(b)) || Math.abs(start(b)-start(ctx))>30000 || d.image_path?.includes('_manual_')) return;
  const relevant=control==='nozzle'?['stringing','blob_zit','under_extrusion','over_extrusion']:['under_extrusion','over_extrusion'];
  const categories=[...new Set([...(d.issues || []).map(i=>i.category),...(d.followup?.categories || [])])].filter(c=>relevant.includes(c));
  let first;
  for(const category of categories) {
    const now=Date.now(),fix={id:randomUUID(),printer_id:config.id,diagnosis_id:d.id,control,before,after,category,baseline:ctx,connection:connection(config),created_at:now,expires_at:now+600000,manual_setting:true,reason:'Manual setting change. Follow-up checks will assess only new material.'};
    saveFixes([fix]);finishFix(fix,'apply',{confirmed:true,observed:after,source:'manual-control'});
    if(!first) {await recordCorrection(fix,config).catch(e=>console.warn(`[manual:${config.id}] ${e.message}`));first=correctionMemory(ctx,config).find(m=>m.fix_id===fix.id);}
    else store({...first,fix_id:fix.id,category,id:randomUUID()});
  }
}

export function refreshFollowup(prepared,ctx,config) {
  const memory=correctionMemory(ctx,config);
  if(!memory.length || prepared?.reference_id===memory[0].id) return prepared;
  return {categories:[...new Set(memory.map(m=>m.category))],reference_id:memory[0].id,ready:false,images:[],note:'A correction or comparison baseline changed while this image was being analyzed. This result cannot establish new defects after that change; a fresh check is required.'};
}
