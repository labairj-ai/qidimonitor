import { AUTO_FLAGS } from './diagnosisFixes.js';
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

db.exec(`
  CREATE TABLE IF NOT EXISTS slicer_jobs (
    id TEXT PRIMARY KEY,
    stl_name TEXT NOT NULL,
    stl_path TEXT NOT NULL,
    gcode_name TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export function insertSlicerJob(job) {
  db.prepare(`
    INSERT OR REPLACE INTO slicer_jobs (id, stl_name, stl_path, gcode_name, settings, created_at, printer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(job.id, job.stl_name, job.stl_path, job.gcode_name, JSON.stringify(job.settings), job.created_at, job.printer_id || 'qidi');
}

export function getSlicerJobs(printerId = 'qidi') {
  return db.prepare('SELECT * FROM slicer_jobs WHERE printer_id=? ORDER BY created_at DESC').all(printerId).map(r => ({
    ...r, settings: JSON.parse(r.settings),
  }));
}

export function getSlicerJob(id, printerId = 'qidi') {
  const r = db.prepare('SELECT * FROM slicer_jobs WHERE id = ? AND printer_id=?').get(id, printerId);
  return r ? { ...r, settings: JSON.parse(r.settings) } : null;
}

export function deleteSlicerJob(id, printerId = 'qidi') {
  db.prepare('DELETE FROM slicer_jobs WHERE id = ? AND printer_id=?').run(id, printerId);
}

// Seed defaults
const defaults = {
  printer_ip: '192.168.4.41',
  camera_url: '',
  moonraker_url: '',
  ollama_url: process.env.OLLAMA_URL || 'http://100.73.128.40:11434',
  ollama_model: 'llava:13b',
  chat_llm_url: 'http://100.73.128.40:8080',
  chat_llm_model: 'mlx-community/Llama-3.3-70B-Instruct-4bit',
  auto_enabled: '0',
  auto_interval_min: '10',
};

const upsertDefault = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) {
  upsertDefault.run(k, v);
}

// One-time, transactional migration; existing records belong to the QIDI.
db.exec('BEGIN IMMEDIATE');
try {
  db.exec(`CREATE TABLE IF NOT EXISTS printers (id TEXT PRIMARY KEY, settings TEXT NOT NULL)`);
  const legacy = Object.fromEntries(db.prepare('SELECT key,value FROM config').all().map(r => [r.key,r.value]));
  const seed = db.prepare('INSERT OR IGNORE INTO printers VALUES (?,?)');
  seed.run('qidi', JSON.stringify({ ...legacy, name: 'QIDI X-Plus 3', model: 'qidi', camera_stream_url: '' }));
  seed.run('u1', JSON.stringify({ name: 'Snapmaker U1', model: 'u1', printer_ip: '', moonraker_url: '', camera_url: '', camera_stream_url: '', auto_enabled: '0', auto_interval_min: '10', controls_enabled: '0', ollama_url: legacy.ollama_url, ollama_model: legacy.ollama_model, chat_llm_url: legacy.chat_llm_url, chat_llm_model: legacy.chat_llm_model }));
  for (const table of ['diagnoses','slicer_jobs']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(c => c.name === 'printer_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN printer_id TEXT NOT NULL DEFAULT 'qidi'`);
  }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

export function getConfig(id = 'qidi') {
  const row = db.prepare('SELECT settings FROM printers WHERE id=?').get(id);
  if (!row) throw new Error('Unknown printer');
  return { ...Object.fromEntries(Object.values(AUTO_FLAGS).map(key => [key, '0'])), ...JSON.parse(row.settings), id };
}
export function listPrinters() {
  return db.prepare('SELECT id FROM printers ORDER BY rowid').all().map(r => getConfig(r.id));
}
export function setConfig(updates, id = 'qidi') {
  const { id: _, ...settings } = { ...getConfig(id), ...updates };
  db.prepare('UPDATE printers SET settings=? WHERE id=?').run(JSON.stringify(settings), id);
}

export function insertDiagnosis(record) {
  return db.prepare(`
    INSERT INTO diagnoses (timestamp, image_path, print_file, issues, overall_severity, raw_response, auto_triggered, printer_context, printer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.timestamp,
    record.image_path || null,
    record.print_file || null,
    JSON.stringify(record.issues || []),
    record.overall_severity,
    record.raw_response,
    record.auto_triggered ? 1 : 0,
    record.printer_context ? JSON.stringify(record.printer_context) : null,
    record.printer_id || 'qidi',
  );
}

export function getHistory(limit = 50, printerId = 'qidi', offset = 0, matches = null) {
  const query = 'SELECT * FROM diagnoses WHERE printer_id=? ORDER BY id DESC';
  const read = row => ({
    ...row,
    followup: getFollowup(row.id, printerId),
    issues: JSON.parse(row.issues || '[]'),
    auto_triggered: !!row.auto_triggered,
    printer_context: row.printer_context ? JSON.parse(row.printer_context) : null,
  });
  if (!matches) return db.prepare(`${query} LIMIT ? OFFSET ?`).all(printerId, limit, offset).map(read);

  const results = [];
  for (const row of db.prepare(query).iterate(printerId)) {
    const context = row.printer_context ? JSON.parse(row.printer_context) : null;
    if (!matches({ ...row, printer_context: context })) continue;
    if (offset > 0) {
      offset--;
      continue;
    }
    results.push(read(row));
    if (results.length === limit) break;
  }
  return results;
}

export default db;

export function getDiagnosis(id, printerId = 'qidi') {
  const row = db.prepare('SELECT * FROM diagnoses WHERE id=? AND printer_id=?').get(id,printerId);
  if (!row) return null;
  let parsed = {}; try { parsed = JSON.parse(row.raw_response || '{}'); } catch {}
  return { ...row, followup:getFollowup(row.id,printerId), issues: JSON.parse(row.issues || '[]'), printer_context: row.printer_context ? JSON.parse(row.printer_context) : null, summary: parsed?.summary || '' };
}

db.exec(`CREATE TABLE IF NOT EXISTS diagnosis_followups (diagnosis_id INTEGER PRIMARY KEY,printer_id TEXT NOT NULL,payload TEXT NOT NULL)`);
export function saveFollowup(id,printerId,data) { db.prepare('INSERT OR REPLACE INTO diagnosis_followups VALUES (?,?,?)').run(id,printerId,JSON.stringify(data)); }
export function getFollowup(id,printerId) {const r=db.prepare('SELECT payload FROM diagnosis_followups WHERE diagnosis_id=? AND printer_id=?').get(id,printerId);return r?JSON.parse(r.payload):null;}
