import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'qidi-memory-test-'));
process.env.DB_PATH=path.join(dir,'test.db');process.env.SNAPSHOTS_DIR=path.join(dir,'snapshots');
const {default:db}=await import('../server/db.js');
const {saveFixes,finishFix}=await import('../server/fixStore.js');
const {buildFixes}=await import('../server/diagnosisFixes.js');
const {prepareFollowup,filterFollowup,correctionMemory,validateCorrectionMemory,refreshFollowup}=await import('../server/correctionMemory.js');
const at=Date.now();
const config={id:'qidi',model:'qidi',printer_ip:'device',moonraker_url:'http://device',camera_url:'http://device/snapshot'};
const ctx=(elapsed=0,z=5)=>({model:'qidi',filename:'part.gcode',print_state:'printing',active_extruder:'extruder',filament_type:'PETG',captured_at:at+elapsed*1000,print_duration_sec:100+elapsed,print_total_duration_sec:100+elapsed,nozzle_temp:240,nozzle_target:240,flow_pct:100,z_mm:z,layer_height:0.2,printer_config:{nozzle_min_temp:0,nozzle_max_temp:300,min_extrude_temp:170}});
const parsed=()=>({overall_severity:'warning',issues:[{category:'stringing',severity:'minor',description:'Threads between the walls',suggestion:'Reduce nozzle temperature',observation:'existing',new_evidence:''}],control_suggestions:[{control:'nozzle',value:235,issue_category:'stringing',reason:'A modest temperature reduction may reduce new threads.'}]});
const initial=parsed();initial.control_suggestions[0].value=240;
const fix=buildFixes(initial,{...ctx(),nozzle_temp:250,nozzle_target:250},{printerId:'qidi',diagnosisId:1,now:at,connection:config.moonraker_url})[0];
saveFixes([fix]);finishFix(fix,'apply',{confirmed:true},at);
const image=Buffer.from([255,216,255,217]);

test('after a correction, settling and baseline creation suppress existing defects',()=>{
  const raced=refreshFollowup(null,ctx(30),config);assert.equal(raced.ready,false);assert.match(raced.note,/while this image/);
  const warm=prepareFollowup(ctx(30),config,image,{now:at+30000});assert.equal(warm.ready,false);
  assert.equal(filterFollowup(parsed(),warm).parsed.issues.length,0);
  const baseline=prepareFollowup(ctx(130),config,image,{now:at+130000});assert.equal(baseline.ready,false);assert.match(baseline.note,/Saved a new baseline/);
  const noGrowth=prepareFollowup(ctx(150),config,image,{now:at+150000});assert.equal(noGrowth.ready,false);assert.equal(filterFollowup(parsed(),noGrowth).parsed.issues.length,0);
});

test('a repeat requires new material, a clear paired-image comparison and specific new evidence',()=>{
  const compare=prepareFollowup(ctx(180,5.4),config,image,{now:at+180000});assert.equal(compare.ready,true);assert.equal(compare.images.length,1);
  for(const change of [null,{reference_id:'wrong',clear_view:true},{reference_id:compare.reference_id,clear_view:false}]) {
    const p=parsed();p.comparison=change;p.issues[0].observation='new';p.issues[0].new_evidence='New threads span the upper layer added since the baseline.';
    assert.equal(filterFollowup(p,compare).parsed.issues.length,0);
  }
  const p=parsed();p.comparison={reference_id:compare.reference_id,clear_view:true};p.issues[0].observation='new';p.issues[0].new_evidence='New threads span the upper layer added since the baseline.';
  const filtered=filterFollowup(p,compare);assert.equal(filtered.parsed.issues.length,1);
  const repeat=buildFixes(filtered.parsed,ctx(180,5.4),{printerId:'qidi',diagnosisId:2,now:at+180000,connection:config.moonraker_url})[0];assert.ok(repeat);
  assert.throws(()=>validateCorrectionMemory(repeat,ctx(180,5.4),config),/already corrected/);
  repeat.followup_reference=compare.reference_id;assert.doesNotThrow(()=>validateCorrectionMemory(repeat,ctx(180,5.4),config));
  p.issues[0].observation='existing';assert.equal(filterFollowup(p,compare).parsed.issues.length,0);
});

test('memory persists across reloads and never crosses prints, devices, or toolheads',async()=>{
  const reload=await import('../server/correctionMemory.js?reload=1');assert.equal(reload.correctionMemory(ctx(190),config).length,1);
  assert.equal(correctionMemory({...ctx(190),filename:'other.gcode'},config).length,0);
  assert.equal(correctionMemory({...ctx(190),active_extruder:'extruder1'},config).length,0);
  assert.equal(correctionMemory({...ctx(190),print_total_duration_sec:1},config).length,0);
  assert.equal(correctionMemory(ctx(190),{...config,moonraker_url:'http://other'}).length,0);
});

test('manual target changes invalidate the reference rather than inviting a repeated fix',()=>{
  const changed=prepareFollowup({...ctx(200,6),nozzle_target:245,nozzle_temp:245},config,image,{now:at+200000});assert.equal(changed.ready,false);assert.match(changed.note,/control changed again/);
});

test.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
