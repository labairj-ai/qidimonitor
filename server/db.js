import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'qidimonitor.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode = WAL`);

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS diagnoses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    image_path TEXT,
    print_file TEXT,
    issues TEXT,
    overall_severity TEXT,
    raw_response TEXT,
    auto_triggered INTEGER DEFAULT 0,
    printer_context TEXT
  );
`);

// Add printer_context column to existing DBs that predate this schema
try { db.exec(`ALTER TABLE diagnoses ADD COLUMN printer_context TEXT`); } catch { /* already exists */ }

// Seed defaults
const defaults = {
  printer_ip: '192.168.4.41',
  camera_url: '',
  moonraker_url: '',
  ollama_url: process.env.OLLAMA_URL || 'http://100.73.128.40:11434',
  ollama_model: 'qwen2.5-vl:7b',
  auto_enabled: '0',
  auto_interval_min: '10',
};

const upsertDefault = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) {
  upsertDefault.run(k, v);
}

// Backfill printer_ip if still empty
const currentIp = db.prepare("SELECT value FROM config WHERE key = 'printer_ip'").get();
if (!currentIp?.value) {
  db.prepare("UPDATE config SET value = '192.168.4.41' WHERE key = 'printer_ip'").run();
}

export function getConfig() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function setConfig(updates) {
  const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(updates)) {
    stmt.run(k, String(v));
  }
}

export function insertDiagnosis(record) {
  return db.prepare(`
    INSERT INTO diagnoses (timestamp, image_path, print_file, issues, overall_severity, raw_response, auto_triggered, printer_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.timestamp,
    record.image_path || null,
    record.print_file || null,
    JSON.stringify(record.issues || []),
    record.overall_severity,
    record.raw_response,
    record.auto_triggered ? 1 : 0,
    record.printer_context ? JSON.stringify(record.printer_context) : null,
  );
}

export function getHistory(limit = 50) {
  return db.prepare('SELECT * FROM diagnoses ORDER BY id DESC LIMIT ?').all(limit).map(r => ({
    ...r,
    issues: JSON.parse(r.issues || '[]'),
    auto_triggered: !!r.auto_triggered,
    printer_context: r.printer_context ? JSON.parse(r.printer_context) : null,
  }));
}

export default db;
