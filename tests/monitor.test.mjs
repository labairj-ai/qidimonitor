import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'qidi-monitor-test-'));
process.env.DB_PATH=path.join(dir,'test.db');process.env.SNAPSHOTS_DIR=path.join(dir,'snapshots');
const {createMonitor,monitorSetup}=await import('../server/monitor.js');
const {default:db}=await import('../server/db.js');
const settle=()=>new Promise(r=>setImmediate(r));
const config=()=>({id:'qidi',model:'qidi',printer_ip:'device',camera_url:'http://device/snapshot',moonraker_url:'http://device',auto_enabled:'1',auto_interval_min:'10'});
function fixture() {
  let clock=1000000, printState='standby', filename='part.gcode', duration=100, cameraError=false;
  const cfg=config(),seen=[],requests=[];
  const request=async url=>{
    requests.push(url);
    if(url.endsWith('/snapshot')) return {ok:!cameraError,status:503,arrayBuffer:async()=>new Uint8Array([1]).buffer};
    return {ok:true,json:async()=>({result:{status:{print_stats:{state:printState,filename,print_duration:duration}}}})};
  };
  const tick=createMonitor({printers:()=>[cfg],request,now:()=>clock,diagnose:async()=>{seen.push(clock);return {id:seen.length,overall_severity:'ok'};}});
  return {cfg,tick,seen,requests,set state(v){printState=v;},set file(v){filename=v;},set duration(v){duration=v;},set cameraError(v){cameraError=v;},advance(ms){clock+=ms;},get clock(){return clock;}};
}

test('idle polling never consumes the diagnosis interval; a new print is checked promptly',async()=>{
  const f=fixture();await f.tick();assert.equal(f.tick.status('qidi').phase,'waiting_for_print');assert.equal(f.tick.status('qidi').last_attempt_at,null);
  f.advance(15000);f.state='printing';await f.tick();assert.equal(f.seen.length,1);assert.equal(f.tick.status('qidi').phase,'scheduled');assert.equal(f.tick.status('qidi').next_check_at,f.clock+600000);
  f.advance(15000);await f.tick();assert.equal(f.seen.length,1);
  f.state='complete';f.advance(15000);await f.tick();assert.equal(f.tick.status('qidi').next_check_at,null);
  f.state='printing';f.file='new.gcode';f.advance(15000);await f.tick();assert.equal(f.seen.length,2);
});

test('camera failure is visible, preserves interval, and explicit Check now retries once',async()=>{
  const f=fixture();f.state='printing';f.cameraError=true;await f.tick();assert.equal(f.seen.length,0);assert.equal(f.tick.status('qidi').phase,'error');assert.match(f.tick.status('qidi').last_error,/Camera snapshot/);
  const count=f.requests.filter(u=>u.endsWith('/snapshot')).length;
  f.advance(15000);await f.tick();assert.equal(f.requests.filter(u=>u.endsWith('/snapshot')).length,count);
  f.cameraError=false;f.tick.check('qidi');f.tick.check('qidi');await settle();assert.equal(f.seen.length,1);assert.equal(f.tick.status('qidi').last_error,null);
});

test('saving an interval reschedules without a duplicate; enabling starts immediately',async()=>{
  const f=fixture();f.state='printing';await f.tick();
  const before={...f.cfg};f.cfg.auto_interval_min='2';f.tick.configurationChanged('qidi',before,f.cfg);await settle();assert.equal(f.seen.length,1);assert.equal(f.tick.status('qidi').next_check_at,f.clock+120000);
  f.advance(120000);await f.tick();assert.equal(f.seen.length,2);
  const enabled={...f.cfg};f.cfg.auto_enabled='0';f.tick.configurationChanged('qidi',enabled,f.cfg);assert.equal(f.tick.status('qidi').phase,'disabled');
  assert.throws(()=>f.tick.check('qidi'),/Enable automatic/);
  const disabled={...f.cfg};f.cfg.auto_enabled='1';f.tick.configurationChanged('qidi',disabled,f.cfg);await settle();assert.equal(f.seen.length,3);
});

test('disabling during camera fetch prevents a new analysis; in-flight analysis can finish',async()=>{
  let releaseCamera;const cameraGate=new Promise(r=>releaseCamera=r);let seen=0;
  const cfg=config();
  const request=async url=>url.endsWith('/snapshot')?await cameraGate:{ok:true,json:async()=>({result:{status:{print_stats:{state:'printing'}}}})};
  const tick=createMonitor({printers:()=>[cfg],request,diagnose:async()=>{seen++;}});
  const run=tick();await settle();const before={...cfg};cfg.auto_enabled='0';tick.configurationChanged('qidi',before,cfg);
  releaseCamera({ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer});await run;assert.equal(seen,0);assert.equal(tick.status('qidi').phase,'disabled');
  let releaseAI;const aiGate=new Promise(r=>releaseAI=r);cfg.auto_enabled='1';
  const tick2=createMonitor({printers:()=>[cfg],request,diagnose:async()=>{seen++;await aiGate;}});
  const running=tick2();await settle();const on={...cfg};cfg.auto_enabled='0';tick2.configurationChanged('qidi',on,cfg);assert.equal(tick2.status('qidi').phase,'finishing');
  releaseAI();await running;await tick2();assert.equal(seen,1);assert.equal(tick2.status('qidi').phase,'disabled');
});

test('interval starts after analysis finishes, and unconfigured printers cannot start checks',async()=>{
  let clock=1000000;const cfg=config();let seen=0;
  const request=async url=>url.endsWith('/snapshot')?{ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer}:{ok:true,json:async()=>({result:{status:{print_stats:{state:'printing',filename:'part',print_duration:100}}}})};
  const tick=createMonitor({printers:()=>[cfg],request,now:()=>clock,diagnose:async()=>{seen++;clock+=120000;}});
  await tick();assert.equal(tick.status('qidi').next_check_at,clock+600000);await tick();assert.equal(seen,1);
  cfg.printer_ip='';cfg.moonraker_url='';assert.match(monitorSetup(cfg),/printer address/);assert.throws(()=>tick.check('qidi'),/printer address/);
});

test.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
