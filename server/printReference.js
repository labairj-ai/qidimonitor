import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import fetch from 'node-fetch';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_SEGMENTS = 500_000;
const files = new Map();
const ACTIVE_STATES = new Set(['printing', 'paused']);

function discardFile(printerId, entry) {
  if (!entry || files.get(printerId) !== entry) return;
  files.delete(printerId);
  clearInterval(entry.watch);
  entry.controller.abort();
}

function watchPrint(printerId, entry, base, filename, request) {
  let checking = false;
  entry.watch = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const response = await request(`${base}/printer/objects/query?print_stats`, {
        signal: AbortSignal.any([entry.controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) return;
      const stats = (await response.json()).result?.status?.print_stats;
      if (stats?.state && (!ACTIVE_STATES.has(stats.state) || stats.filename !== filename)) {
        discardFile(printerId, entry);
      }
    } catch {
      // Retain the active cache while printer status is temporarily unavailable.
    } finally {
      checking = false;
    }
  }, 10_000);
  entry.watch.unref();
}

export function depositedPaths(buffer, position) {
  const paths = [];
  const xyz = { X: 0, Y: 0, Z: 0 };
  const origin = { ...xyz };
  let absolute = true;
  let relativeExtrusion = false;
  let extrusion = 0;
  let retracted = 0;

  for (let start = 0; start < position;) {
    const end = buffer.indexOf(10, start);
    if (end === -1 || end >= position) break;
    const line = buffer.toString('utf8', start, end).split(';', 1)[0].trim().toUpperCase();
    start = end + 1;
    const match = /^([GMT]\d+)(?=\s|[A-Z]|$)/.exec(line);
    if (!match) continue;
    const command = match[1];
    if (command === 'G90') absolute = true;
    if (command === 'G91') absolute = false;
    if (command === 'M82') relativeExtrusion = false;
    if (command === 'M83') relativeExtrusion = true;
    if (command === 'G20' || command === 'G92.1') return [];
    if (!['G0', 'G1', 'G2', 'G3', 'G92'].includes(command)) continue;

    const words = {};
    for (const [, axis, value] of line.slice(match[0].length).matchAll(/([XYZE])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))/g)) {
      words[axis] = Number(value);
    }
    if (command === 'G92') {
      for (const axis of ['X', 'Y', 'Z']) {
        if (words[axis] != null) origin[axis] = xyz[axis] - words[axis];
      }
      if (words.E != null) extrusion = words.E;
      continue;
    }

    const next = { ...xyz };
    for (const axis of ['X', 'Y', 'Z']) {
      if (words[axis] != null) next[axis] = words[axis] + (absolute ? origin[axis] : xyz[axis]);
    }
    if (words.E != null) {
      const delta = absolute && !relativeExtrusion ? words.E - extrusion : words.E;
      extrusion += delta;
      const deposited = delta - retracted;
      retracted = Math.max(0, retracted - delta);
      if (deposited > 0.00001) {
        if (command === 'G2' || command === 'G3') return [];
        if (next.X !== xyz.X || next.Y !== xyz.Y) {
          const fraction = Math.max(0, 1 - deposited / delta);
          paths.push([
            xyz.X + fraction * (next.X - xyz.X),
            xyz.Y + fraction * (next.Y - xyz.Y),
            xyz.Z + fraction * (next.Z - xyz.Z),
            next.X, next.Y, next.Z,
          ]);
          if (paths.length > MAX_SEGMENTS) return [];
        }
      }
    }
    Object.assign(xyz, next);
  }
  return paths;
}

const SIZE = 512;
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let checksum = 0xffffffff;
  for (const byte of body) checksum = (checksum >>> 8) ^ CRC_TABLE[(checksum ^ byte) & 255];
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(data.length);
  body.copy(chunk, 4);
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, body.length + 4);
  return chunk;
}

export function renderPaths(paths) {
  const project = (x, y, z) => [x - y * 0.58, -z + y * 0.40 + x * 0.19];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (let i = 0; i < 6; i += 3) {
      const [x, y] = project(path[i], path[i + 1], path[i + 2]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(extent) || extent <= 0) return null;
  const scale = (SIZE - 48) / extent;
  const point = (x, y, z) => {
    const [u, v] = project(x, y, z);
    return [Math.round(SIZE / 2 + (u - (minX + maxX) / 2) * scale),
      Math.round(SIZE / 2 + (v - (minY + maxY) / 2) * scale)];
  };
  const stride = 1 + SIZE * 3;
  const pixels = Buffer.alloc(SIZE * stride, 22);
  for (let y = 0; y < SIZE; y++) pixels[y * stride] = 0;
  const latestZ = paths.at(-1)[5];
  let remainingPixels = 4_000_000;
  for (const [x1, y1, z1, x2, y2, z2] of paths) {
    const [ax, ay] = point(x1, y1, z1);
    const [bx, by] = point(x2, y2, z2);
    const steps = Math.max(1, Math.abs(bx - ax), Math.abs(by - ay));
    remainingPixels -= steps + 1;
    if (remainingPixels < 0) return null;
    const recent = Math.abs(z2 - latestZ) < 0.01;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(ax + (bx - ax) * i / steps);
      const y = Math.round(ay + (by - ay) * i / steps);
      const offset = y * stride + x * 3 + 1;
      pixels[offset] = recent ? 248 : 108;
      pixels[offset + 1] = recent ? 181 : 170;
      pixels[offset + 2] = recent ? 77 : 200;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function getPrintReference(ctx, config, request = fetch) {
  if (!ACTIVE_STATES.has(ctx?.print_state)) {
    if (ctx?.print_state) discardFile(config.id, files.get(config.id));
    return null;
  }
  const { filename, gcode_position: position, gcode_size: size, gcode_revision: revision } = ctx;
  const base = (config.moonraker_url || (config.printer_ip && `http://${config.printer_ip}:7125`))?.replace(/\/$/, '');
  if (!base || !filename || !revision || !Number.isSafeInteger(size) || size > MAX_BYTES ||
      !Number.isSafeInteger(position) || position <= 0 || position > size) return null;
  const parts = filename.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return null;

  try {
    const key = JSON.stringify([base, filename, size, revision]);
    let cached = files.get(config.id);
    if (cached?.key !== key) {
      discardFile(config.id, cached);
      if (files.size >= 2) {
        const oldest = files.keys().next().value;
        discardFile(oldest, files.get(oldest));
      }
      const controller = new AbortController();
      const entry = { key, controller };
      files.set(config.id, entry);
      watchPrint(config.id, entry, base, filename, request);
      entry.pending = (async () => {
        const response = await request(`${base}/server/files/gcodes/${parts.map(encodeURIComponent).join('/')}`, {
          redirect: 'error',
          size: MAX_BYTES,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
        });
        if (!response.ok) throw new Error('G-code download failed');
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length !== size) throw new Error('G-code size changed');
        entry.buffer = buffer;
      })().catch(() => {
        discardFile(config.id, entry);
      });
      cached = entry;
    }
    if (!cached.buffer) {
      const wait = new AbortController();
      try {
        const preparing = await Promise.race([
          cached.pending.then(() => false),
          delay(3000, true, { signal: wait.signal, ref: false }),
        ]);
        if (preparing) return { status: 'preparing' };
      } finally {
        wait.abort();
      }
    }
    if (files.get(config.id) !== cached || !cached.buffer) return null;
    const paths = depositedPaths(cached.buffer, position);
    const png = renderPaths(paths);
    return png && { status: 'used', image: png.toString('base64'), z: paths.at(-1)[5] };
  } catch {
    return null;
  }
}

export function filterPrintEvidence(parsed, reference) {
  const issues = parsed.issues.filter(issue => {
    const { evidence, detail } = issue.geometry_evidence || {};
    if (evidence === 'visible_defect') return typeof detail === 'string' && detail.trim().length >= 20;
    return evidence === 'reference_mismatch' && !!reference &&
      typeof detail === 'string' && detail.trim().length >= 20;
  });
  const inconclusive = issues.length === 0 && parsed.issues.length > 0;
  return {
    ...parsed,
    issues,
    control_suggestions: Array.isArray(parsed.control_suggestions) ?
      parsed.control_suggestions.filter(suggestion => issues.some(issue => issue.category === suggestion?.issue_category)) : [],
    ...(inconclusive && {
      overall_severity: 'warning',
      summary: 'The camera view did not provide enough evidence to confirm a print defect.',
    }),
    inconclusive,
  };
}
