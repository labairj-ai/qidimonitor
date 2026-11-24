import test from 'node:test';
import assert from 'node:assert/strict';
import { belongsToPrint, currentPrintAdjustments } from '../client/src/diagnosisSession.mjs';

const ctx = { print_state:'printing', filename:'part.gcode', captured_at:1000000,
  print_duration_sec:100, print_total_duration_sec:200 };
const result = (at, filename='part.gcode') => ({ printer_context:{ captured_at:at, filename, print_duration_sec:50 } });

test('new prints reject previous diagnoses including same-file reruns and late AI responses', () => {
  assert.equal(belongsToPrint(result(900000, 'old.gcode'), ctx), false);
  assert.equal(belongsToPrint(result(700000), ctx), false);
  assert.equal(belongsToPrint({...result(700000), timestamp:new Date(1000000).toISOString()}, ctx), false);
  assert.equal(belongsToPrint(result(900000), ctx), true);
  assert.equal(belongsToPrint(result(900000), { filename: ctx.filename }), false);
});

test('pauses and completed prints preserve the current diagnosis', () => {
  assert.equal(belongsToPrint(result(850000), {...ctx, print_state:'paused'}), true);
  assert.equal(belongsToPrint(result(850000), {...ctx, print_state:'complete'}), true);
  assert.equal(belongsToPrint({print_file:'part.gcode', timestamp:new Date(700000).toISOString()}, ctx), false);
});

test('recent adjustments and their log contain only the current print session', () => {
  const fix = (id, at, filename) => ({id, created_at:at, baseline:result(at, filename).printer_context});
  const data = {
    fixes:[fix('current',900000), fix('rerun',700000), fix('other',900000,'old.gcode')],
    events:[{fix_id:'current'}, {fix_id:'rerun'}, {fix_id:'other'}],
  };
  const visible = currentPrintAdjustments(data, ctx);
  assert.deepEqual(visible.fixes.map(f => f.id), ['current']);
  assert.deepEqual(visible.events, [{fix_id:'current'}]);
  assert.deepEqual(currentPrintAdjustments(data, null), {fixes:[],events:[]});
  assert.deepEqual(currentPrintAdjustments(data, {...ctx,print_state:'paused'}), visible);
});
