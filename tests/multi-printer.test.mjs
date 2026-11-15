import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { spawn } from 'node:child_process';

const dir = mkdtempSync(path.join(tmpdir(), 'qidimonitor-test-'));
process.env.DB_PATH = path.join(dir, 'test.sqlite');
process.env.SNAPSHOTS_DIR = path.join(dir, 'snapshots');
process.env.STLS_DIR = path.join(dir, 'stls');
const legacy = new DatabaseSync(process.env.DB_PATH);
legacy.exec(`CREATE TABLE config (key TEXT PRIMARY KEY,value TEXT); INSERT INTO config VALUES ('printer_ip','qidi-old.local'),('auto_enabled','0');
CREATE TABLE diagnoses (id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp TEXT NOT NULL,image_path TEXT,print_file TEXT,issues TEXT,overall_severity TEXT,raw_response TEXT,auto_triggered INTEGER DEFAULT 0,printer_context TEXT);
INSERT INTO diagnoses(timestamp,issues) VALUES ('legacy','[]');
CREATE TABLE slicer_jobs (id TEXT PRIMARY KEY,stl_name TEXT NOT NULL,stl_path TEXT NOT NULL,gcode_name TEXT NOT NULL,settings TEXT NOT NULL,created_at TEXT NOT NULL);
INSERT INTO slicer_jobs VALUES ('old','part.stl','unused','part.gcode','{}','legacy');`);
legacy.close();
const store = await import('../server/db.js');
const servers = [];
async function fakePrinter(name, count) {
  const actions = [];
  const scripts = [];
  let light = 1;
  const server = http.createServer(async (req, res) => {
    actions.push(req.url);
    if (req.url === '/printer/gcode/script') {
      let body = ''; for await (const chunk of req) body += chunk;
      const script = JSON.parse(body).script; scripts.push(script);
      const desired = script.endsWith('VALUE=0') ? 0 : 1;
      setTimeout(() => { light = desired; }, 400);
    }
    const objects = ['print_stats','display_status','toolhead','gcode_move','heater_bed','configfile',...(count === 1 ? ['output_pin caselight'] : []),...Array.from({length:count},(_,i)=>i ? `extruder${i}`:'extruder')];
    const status = { print_stats: {state:'printing', filename: `${name}.gcode`}, toolhead:{extruder:count===4?'extruder2':'extruder'}, configfile:{config:{}}, heater_bed:{temperature:60,target:60} };
    if (count === 1) status['output_pin caselight'] = {value:light};
    for(let i=0;i<count;i++) status[i?`extruder${i}`:'extruder']={temperature:200+i,target:210};
    let result = req.url === '/printer/objects/list' ? {objects} : req.url === '/printer/info' ? {hostname:name,state:'ready'} : req.url === '/server/webcams/list' ? {webcams:[{name:'Built-in',stream_url:'/camera',snapshot_url:'/snapshot'}]} : {status};
    res.setHeader('Content-Type','application/json');
    // Apply the pin immediately, but simulate Klipper delaying its acknowledgment.
    if (req.url === '/printer/gcode/script' && light === 0) {
      setTimeout(() => res.end(JSON.stringify({result})), 5500);
    } else res.end(JSON.stringify({result}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); servers.push(server);
  return {url:`http://127.0.0.1:${server.address().port}`, actions, scripts};
}
const qidi=await fakePrinter('qidi-device',1), u1=await fakePrinter('u1-device',4);
let child;
test('migration preserves legacy QIDI data, isolates U1 and is repeatable', async()=>{
  assert.equal(store.getConfig('qidi').printer_ip,'qidi-old.local');
  assert.equal(store.getConfig('u1').printer_ip,'');
  assert.equal(store.getConfig('u1').auto_enabled,'0');
  assert.equal(store.getHistory(50,'qidi').length,1);
  assert.equal(store.getHistory(50,'u1').length,0);
  store.insertDiagnosis({printer_id:'u1',timestamp:'fixture',overall_severity:'ok',issues:[],raw_response:'{}',auto_triggered:false});
  assert.equal(store.getHistory(50,'qidi').length,1);
  assert.equal(store.getHistory(50,'u1').length,1);
  assert.equal(store.getSlicerJobs('u1').length,0);
  assert.equal(store.getSlicerJob('old','u1'),null);
  store.deleteSlicerJob('old','u1'); assert.ok(store.getSlicerJob('old','qidi'));
  store.setConfig({moonraker_url:qidi.url},'qidi');
  store.setConfig({moonraker_url:u1.url},'u1');
  await import(`../server/db.js?repeat=1`);
  assert.equal(store.getConfig('qidi').printer_ip,'qidi-old.local');
  assert.equal(store.getConfig('u1').moonraker_url,u1.url);
});
let base;
test('scoped routes cannot leak targets or enable unverified U1 controls',async()=>{
  // Reserve an available port, then start the real application against fixture data.
  const reserve=http.createServer(); await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
  const port=reserve.address().port; await new Promise(r=>reserve.close(r)); base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let output=''; child.stdout.on('data',b=>output+=b); child.stderr.on('data',b=>output+=b);
  await new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(output.includes('running on port')){clearInterval(timer);resolve();}else if(++n>100 || child.exitCode!==null){clearInterval(timer);reject(new Error(output));}},30);});
  const json=async(url,opts)=>{const r=await fetch(base+url,opts);return {status:r.status,data:await r.json()};};
  assert.equal((await json('/api/printers/qidi/slicer/jobs')).data.length,1);
  assert.equal((await json('/api/printers/u1/slicer/jobs')).data.length,0);
  assert.equal((await json('/api/printers/u1/slicer/jobs/old/stl')).status,404);
  const configs=await json('/api/printers'); assert.equal(configs.data.length,2);
  const [a,b]=await Promise.all([json('/api/printers/qidi/printer/status'),json('/api/printers/u1/printer/status')]);
  assert.equal(a.data.print_stats.filename,'qidi-device.gcode'); assert.equal(b.data.print_stats.filename,'u1-device.gcode');
  assert.equal((await json('/api/printers/missing/config')).status,404);
  const lightOptions = on => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on})});
  assert.deepEqual((await json('/api/printers/qidi/printer/light')).data,{supported:true,on:true});
  assert.deepEqual((await json('/api/printers/u1/printer/light')).data,{supported:false});
  assert.equal((await json('/api/printers/qidi/printer/light',lightOptions('false'))).status,400);
  assert.equal((await json('/api/printers/u1/printer/light',lightOptions(false))).status,409);
  assert.equal((await json('/api/printers/qidi/printer/light',lightOptions(false))).status,200);
  assert.equal((await json('/api/printers/qidi/printer/light')).data.on,false);
  assert.equal((await json('/api/printers/qidi/printer/light',lightOptions(true))).status,200);
  assert.deepEqual(qidi.scripts,['SET_PIN PIN=caselight VALUE=0','SET_PIN PIN=caselight VALUE=1']);
  for (const on of [false,true,false,true]) {
    const result = await json('/api/printers/qidi/printer/light',lightOptions(on));
    assert.equal(result.status,200); assert.equal(result.data.on,on);
    assert.equal((await json('/api/printers/qidi/printer/light')).data.on,on);
  }
  assert.deepEqual(u1.scripts,[]);

  assert.equal((await json('/api/printers/u1/files/print/pause',{method:'POST'})).status,409);
  assert.equal(u1.actions.filter(x=>x==='/printer/print/pause').length,0);
  assert.equal((await json('/api/printers/u1/slicer/slice',{method:'POST'})).status,409);
  const context=await json('/api/printers/u1/printer/context');
  assert.equal(context.data.toolheads.length,4); assert.equal(context.data.active_extruder,'extruder2'); assert.equal(context.data.nozzle_temp,202); assert.equal(context.data.material_profile,null);
  const opts={method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'My U1',printer_ip:'new-u1.local'})};
  assert.equal((await json('/api/printers/u1/config',opts)).status,200);
  assert.equal((await json('/api/printers/qidi/config')).data.printer_ip,'qidi-old.local');
  assert.equal((await json('/api/config')).data.id,'qidi');
  assert.equal((await json('/api/printers/u1/config',{...opts,body:JSON.stringify({camera_url:'file:///etc/passwd'})})).status,400);
  const before=(await json('/api/printers/u1/config')).data;
  const check=await json('/api/printers/u1/test',{method:'POST'});assert.equal(check.data.hostname,'u1-device');assert.equal(check.data.webcams.length,1);assert.equal(check.data.webcams[0].stream_url,u1.url+'/camera');
  assert.deepEqual((await json('/api/printers/u1/config')).data,before);
  assert.equal((await json('/api/printers/u1/config',{...opts,body:JSON.stringify({controls_enabled:'1'})})).status,200);
  assert.equal((await json('/api/printers/u1/printer/light',lightOptions(true))).status,409);
  assert.deepEqual(u1.scripts,[]);
  assert.equal((await json('/api/printers/u1/files/print/pause',{method:'POST'})).status,200);
  assert.ok(u1.actions.includes('/printer/print/pause'));
  assert.ok(!qidi.actions.includes('/printer/print/pause'));
  assert.equal((await json('/api/printers/qidi/printer/discover',{method:'POST'})).status,409);
  assert.equal((await json('/api/printers/qidi/config')).data.printer_ip,'qidi-old.local');
});
test('simultaneous monitoring isolates failures and blocks overlap per printer',async()=>{
  const {createMonitor}=await import('../server/monitor.js');
  let release; const gate=new Promise(r=>release=r);const seen=[];
  const printers=()=>['qidi','u1'].map(id=>({id,model:id,moonraker_url:`http://${id}`,camera_url:`http://${id}/snapshot`,auto_enabled:'1',auto_interval_min:'10'}));
  const request=async url=>url.endsWith('snapshot')?{ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}:{ok:true,json:async()=>({result:{status:{print_stats:{state:'printing'}}}})};
  const tick=createMonitor({printers,request,now:()=>1000000,diagnose:async({config})=>{seen.push(config.id);if(config.id==='qidi')throw new Error('fixture offline'); await gate;}});
  const first=tick();await new Promise(r=>setTimeout(r,20));await tick();assert.deepEqual(seen,['qidi','u1']);release();await first;await tick();assert.equal(seen.length,2);
});
test.after(async()=>{
  child?.kill();
  await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));
  store.default.close();rmSync(dir,{recursive:true,force:true});
});
