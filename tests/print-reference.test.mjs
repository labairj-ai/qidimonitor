import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { depositedPaths, getPrintReference } from '../server/printReference.js';

test('reference includes only deposited paths through the reported file position', () => {
  const prefix = [
    'G90', 'M82', 'G1 Z0.2', 'G1 X10 E1',
    'G1 E0.5', 'G1 Y15', 'G1 E1', 'G1 Y20 E2',
    'G92 E0', 'M83', 'G1 Z0.4', 'G1 X4 E1',
  ].join('\n') + '\n';
  const buffer = Buffer.from(prefix + 'G1 Y0 E3\n');
  assert.deepEqual(depositedPaths(buffer, Buffer.byteLength(prefix) + 4), [
    [0, 0, 0.2, 10, 0, 0.2],
    [10, 15, 0.2, 10, 20, 0.2],
    [10, 20, 0.4, 4, 20, 0.4],
  ]);
});

test('the reference cache is cleared on print completion even without another diagnosis', async () => {
  const filename = 'folder/part.gcode';
  const gcode = 'M83\nG1 Z0.2\nG1 X20 E1\n';
  const ctx = {
    print_state: 'printing',
    filename,
    gcode_size: Buffer.byteLength(gcode),
    gcode_position: Buffer.byteLength(gcode),
    gcode_revision: 1,
  };
  const config = { id: 'cache-test', moonraker_url: 'http://printer.test' };
  let state = 'printing';
  let downloads = 0;
  let checkedCompletion;
  const completion = new Promise(resolve => { checkedCompletion = resolve; });
  const request = async url => {
    if (url.endsWith('?print_stats')) {
      if (state === 'complete') checkedCompletion();
      return Response.json({ result: { status: { print_stats: { state, filename } } } });
    }
    assert.equal(url, 'http://printer.test/server/files/gcodes/folder/part.gcode');
    downloads++;
    return new Response(gcode);
  };

  try {
    assert.equal((await getPrintReference(ctx, config, request)).status, 'used');
    assert.equal((await getPrintReference(ctx, config, request)).status, 'used');
    assert.equal(downloads, 1);
    state = 'complete';
    const guard = new AbortController();
    try {
      await Promise.race([completion, delay(12_000, null, { signal: guard.signal }).then(() => assert.fail('Completion was not checked'))]);
    } finally {
      guard.abort();
    }
    await delay(0);
    state = 'printing';
    assert.equal((await getPrintReference(ctx, config, request)).status, 'used');
    assert.equal(downloads, 2);
  } finally {
    await getPrintReference({ print_state: 'complete' }, config, request);
  }
});
