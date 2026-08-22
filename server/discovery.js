import net from 'net';
import os from 'os';
import { setConfig } from './db.js';

let discovering = false;

function getSubnetInfo() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const addr of ifaces) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const maskParts = addr.netmask.split('.').map(Number);
      const hostBits = maskParts.reduce((acc, m) => {
        let b = 0, n = ~m & 0xff;
        while (n) { b++; n >>= 1; }
        return acc + b;
      }, 0);
      if (hostBits < 4 || hostBits > 16) continue; // skip loopback-like or too-large
      const ipParts = addr.address.split('.').map(Number);
      const base = ipParts.map((p, i) => p & maskParts[i]);
      const baseInt = (base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3];
      return { baseInt, total: Math.pow(2, hostBits) - 2 };
    }
  }
  return null;
}

function probePort(ip, port, timeoutMs = 600) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(timeoutMs);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
    s.connect(port, ip);
  });
}

export function isDiscovering() {
  return discovering;
}

export async function discoverPrinter(currentIp = null) {
  if (discovering) return null;
  discovering = true;

  try {
    const subnet = getSubnetInfo();
    if (!subnet) return null;

    const { baseInt, total } = subnet;
    const ips = [];
    for (let i = 1; i <= total; i++) {
      const n = baseInt + i;
      const ip = [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].join('.');
      if (ip !== currentIp) ips.push(ip);
    }

    console.log(`[discovery] Scanning ${ips.length} hosts for Moonraker on port 7125...`);

    const BATCH = 80;
    for (let i = 0; i < ips.length; i += BATCH) {
      const batch = ips.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async ip => {
        const open = await probePort(ip, 7125);
        if (!open) return null;
        // Verify it's actually Moonraker
        try {
          const r = await fetch(`http://${ip}:7125/api/version`, { signal: AbortSignal.timeout(2000) });
          return r.ok ? ip : null;
        } catch { return null; }
      }));
      const found = results.find(ip => ip != null);
      if (found) {
        console.log(`[discovery] Found printer at ${found}`);
        setConfig({ printer_ip: found });
        return found;
      }
    }

    console.log('[discovery] No printer found');
    return null;
  } finally {
    discovering = false;
  }
}
