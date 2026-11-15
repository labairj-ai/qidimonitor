import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildFixes, validAdjustment, validateFixContext, fixCommand, FIX_TTL_MS } from '../server/diagnosisFixes.js';

const baseline = () => ({model:'qidi', print_state:'printing', filename:'part.gcode', active_extruder:'extruder', print_duration_sec:100, print_total_duration_sec:100, captured_at:Date.now(), speed_factor_pct:100, flow_pct:100, fan_pct:60, filament_type:'PLA', z_mm:2, first_layer_height:0.2});
const parsed = (control='speed', value=90, category='ghosting') => ({ overall_severity:'warning', issues:[{category,severity:'moderate',description:'Visible ripples beside the edge',suggestion:'Try a small adjustment'}], control_suggestions:[{control,value,issue_category:category,reason:'Visible ringing suggests trying a modest speed reduction.'}] });
const options = () => ({printerId:'qidi',diagnosisId:1});

test('proposals require reliable live data and bounded structured recommendations',()=>{
  assert.equal(buildFixes(parsed(),baseline(),options()).length,1);
  for(const p of [null, {}, {...parsed(),overall_severity:'critical'}, {...parsed(),control_suggestions:[{control:'speed',value:'90',issue_category:'ghosting',reason:'test'}]}, parsed('speed',200), parsed('temperature',210), {...parsed(),control_suggestions:[]}, {...parsed(),issues:[{category:'spaghetti',severity:'severe'}]}]) assert.deepEqual(buildFixes(p,baseline(),options()),[]);
  for(const ctx of [null,{...baseline(),model:'u1'},{...baseline(),print_state:'paused'},{...baseline(),filename:null},{...baseline(),speed_factor_pct:null}]) assert.deepEqual(buildFixes(parsed(),ctx,options()),[]);
  assert.deepEqual(buildFixes(parsed(),baseline(),{...options(),uploaded:true}),[]);
  assert.deepEqual(buildFixes(parsed('speed',95,'over_extrusion'),baseline(),options()),[]);
  assert.equal(buildFixes(parsed('flow',102,'under_extrusion'),baseline(),options()).length,1);
  assert.equal(buildFixes(parsed('flow',98,'over_extrusion'),baseline(),options()).length,1);
  assert.deepEqual(buildFixes(parsed('flow',98,'under_extrusion'),baseline(),options()),[]);
  assert.deepEqual(buildFixes(parsed('flow',102,'under_extrusion'),{...baseline(),filament_type:null},options()),[]);
  assert.equal(buildFixes(parsed('fan',70,'stringing'),baseline(),options()).length,1);
  assert.deepEqual(buildFixes(parsed('fan',70,'stringing'),{...baseline(),z_mm:0.2},options()),[]);
  assert.deepEqual(buildFixes(parsed('fan',70,'stringing'),{...baseline(),filament_type:'ABS'},options()),[]);
  assert.equal(validAdjustment('flow',107,105,baseline(),'over_extrusion'),false);
  assert.throws(()=>fixCommand('speed','90\nM112'));
  assert.throws(()=>fixCommand('heater',250));
});

test('freshness, print identity and changed controls are rechecked before apply and undo',()=>{
  const now=Date.now(); const fix=buildFixes(parsed(),baseline(),{...options(),now})[0];
  assert.doesNotThrow(()=>validateFixContext(fix,baseline(),{now}));
  for(const ctx of [{...baseline(),print_state:'complete'},{...baseline(),filename:'other.gcode'},{...baseline(),active_extruder:'extruder1'},{...baseline(),filament_type:'ABS'},{...baseline(),speed_factor_pct:95},{...baseline(),print_duration_sec:2},{...baseline(),print_duration_sec:500}]) assert.throws(()=>validateFixContext(fix,ctx,{now}));
  assert.throws(()=>validateFixContext(fix,baseline(),{now:now+FIX_TTL_MS+1}));
  assert.doesNotThrow(()=>validateFixContext(fix,{...baseline(),speed_factor_pct:90},{undo:true,appliedAt:now,now:now+100}));
  assert.throws(()=>validateFixContext(fix,{...baseline(),speed_factor_pct:85},{undo:true,appliedAt:now,now:now+100}));
});

const dir=mkdtempSync(path.join(tmpdir(),'qidi-fix-test-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.SNAPSHOTS_DIR=path.join(dir,'snapshots');
process.env.STLS_DIR=path.join(dir,'stls');
const store=await import('../server/db.js');
const fixStore=await import('../server/fixStore.js');
let speed=100, flow=100, fan=60, filename='part.gcode', printState='printing', recommendation=parsed();
const scripts=[];
let commandMode='normal';
const fake=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  const status={ print_stats:{state:printState,filename,print_duration:100,total_duration:100},toolhead:{extruder:'extruder'},gcode_move:{speed_factor:speed/100,extrude_factor:flow/100},extruder:{temperature:205,target:205},heater_bed:{temperature:60,target:60},'output_pin fan0':{value:fan/100},motion_report:{live_position:[0,0,2]},configfile:{config:{extruder:{nozzle_diameter:0.4}}}};
  if(req.url==='/api/generate') { for await(const _ of req) {} return res.end(JSON.stringify({response:JSON.stringify(recommendation)})); }
  if(req.url==='/snapshot') { res.setHeader('Content-Type','image/jpeg'); return res.end(Buffer.from([255,216,255,217])); }
  if(req.url==='/printer/objects/list') return res.end(JSON.stringify({result:{objects:Object.keys(status)}}));
  if(req.url.startsWith('/printer/objects/query')) return res.end(JSON.stringify({result:{status}}));
  if(req.url.startsWith('/server/files/metadata')) return res.end(JSON.stringify({result:{filament_type:'PLA',first_layer_height:0.2}}));
  if(req.url==='/printer/gcode/script') {
    let body='';for await(const chunk of req) body+=chunk;
    const script=JSON.parse(body).script; scripts.push(script);
    if(commandMode==='reject') { res.statusCode=500; return res.end('{}'); }
    setTimeout(()=>{
      if(script.startsWith('M220 S')) speed=Number(script.slice(6));
      if(script.startsWith('M221 S')) flow=Number(script.slice(6));
      if(script.startsWith('M106 S')) fan=Math.round(Number(script.slice(6))*100/255);
    },600);
    // State changes before the acknowledgment, as on the physical printer.
    return setTimeout(()=>res.end(JSON.stringify({result:'ok'})),2500);
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
const device=`http://127.0.0.1:${fake.address().port}`;
store.setConfig({moonraker_url:device,camera_url:device+'/snapshot',ollama_url:device,auto_enabled:'0'},'qidi');
let child,base;
const json=async(url,opts)=>{const r=await fetch(base+url,opts);return {status:r.status,data:await r.json()};};
const post={method:'POST'};
const diagnose=async()=>{const r=await json('/api/printers/qidi/diagnose',post);assert.equal(r.status,200,JSON.stringify(r));return r.data;};

test('reviewed fix API applies once, verifies delayed changes, logs and undoes without trusting client commands',async()=>{
  child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  await new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(output.includes('running on port')){clearInterval(t);resolve();}else if(++n>100||child.exitCode!==null){clearInterval(t);reject(new Error(output));}},30);});
  base=`http://127.0.0.1:${output.match(/running on port (\d+)/)[1]}`;
  const diagnosis=await diagnose();assert.ok(diagnosis.id);assert.equal(diagnosis.fixes.length,1);
  assert.equal(diagnosis.printer_context.filament_type,'PLA');
  let review=await json(`/api/printers/qidi/diagnose/${diagnosis.id}/fixes`);const fix=review.data.fixes[0];assert.equal(fix.before,100);assert.equal(fix.after,90);
  assert.equal((await json(`/api/printers/u1/diagnose/${diagnosis.id}/fixes`)).status,404);
  assert.equal((await json(`/api/printers/u1/diagnose/fixes/${fix.id}/apply`,post)).status,404);
  const request={...post,headers:{'Content-Type':'application/json'},body:JSON.stringify({script:'M112',value:999})};
  const results=await Promise.all([json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,request),json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,request)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.deepEqual(scripts,['M220 S90']);assert.equal(speed,90);
  review=await json(`/api/printers/qidi/diagnose/${diagnosis.id}/fixes`);assert.equal(review.data.fixes[0].state,'applied');assert.equal(review.data.events.length,2);
  const recent = await json('/api/printers/qidi/diagnose/fixes/recent'); assert.equal(recent.data.fixes[0].id,fix.id);
  assert.deepEqual((await json('/api/printers/u1/diagnose/fixes/recent')).data.fixes,[]);
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,post)).status,409);
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/undo`,post)).status,200);assert.equal(speed,100);assert.deepEqual(scripts,['M220 S90','M220 S100']);
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/undo`,post)).status,409);
  // Uploaded photos remain advice only, even if the model proposes a live change.
  const form=new FormData();form.append('image',new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'}),'test.jpg');
  const uploaded=await json('/api/printers/qidi/diagnose',{method:'POST',body:form});assert.equal(uploaded.status,200);assert.deepEqual(uploaded.data.fixes,[]);
});

test('stale or changed-print fixes send nothing; cooldown is enforced across diagnoses',async()=>{
  const d=await diagnose();const fix=d.fixes[0];const count=scripts.length;
  store.setConfig({moonraker_url:device+'/'},'qidi');
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,post)).status,409);
  store.setConfig({moonraker_url:device},'qidi');
  filename='different.gcode';assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,post)).status,409);filename='part.gcode';
  speed=95;assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,post)).status,409);speed=100;
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,post)).status,409); // cooldown
  const expired=buildFixes(parsed(),baseline(),{...options(),diagnosisId:d.id,now:Date.now()-FIX_TTL_MS-1})[0];fixStore.saveFixes([expired]);
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${expired.id}/apply`,post)).status,409);
  assert.equal(scripts.length,count);
  recommendation=parsed('speed',190);assert.deepEqual((await diagnose()).fixes,[]);
  recommendation={...parsed(),issues:[{category:'spaghetti',severity:'severe',description:'Loose strands',suggestion:'Inspect the print'}]};assert.deepEqual((await diagnose()).fixes,[]);
  recommendation=parsed();
});

test('uncertain changes cannot be replayed and acknowledgement sends no command',async()=>{
  // Clear only this disposable fixture's events to exercise the uncertainty path without waiting for cooldown.
  store.default.prepare('DELETE FROM diagnosis_fix_events').run();
  const d=await diagnose();const fix=d.fixes[0];const count=scripts.length;commandMode='reject';
  const result=await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,post);assert.equal(result.status,202);assert.equal(result.data.fix.state,'unconfirmed');
  assert.equal(scripts.length,count+1);
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/apply`,post)).status,409);assert.equal(scripts.length,count+1);
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/dismiss`,post)).status,200);assert.equal(scripts.length,count+1);
  assert.equal((await json(`/api/printers/qidi/diagnose/fixes/${fix.id}/undo`,post)).status,409);
});

test.after(async()=>{
  child?.kill();await new Promise(r=>fake.close(r));store.default.close();rmSync(dir,{recursive:true,force:true});
});
