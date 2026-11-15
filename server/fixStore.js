import db from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS diagnosis_fixes (
  id TEXT PRIMARY KEY, diagnosis_id INTEGER NOT NULL, printer_id TEXT NOT NULL,
  payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ready', updated_at INTEGER NOT NULL, applied_at INTEGER, message TEXT
);
CREATE TABLE IF NOT EXISTS diagnosis_fix_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fix_id TEXT NOT NULL, printer_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT
);`);
export function saveFixes(fixes) {
  const insert = db.prepare('INSERT INTO diagnosis_fixes(id,diagnosis_id,printer_id,payload,updated_at) VALUES (?,?,?,?,?)');
  for (const f of fixes) insert.run(f.id,f.diagnosis_id,f.printer_id,JSON.stringify(f),f.created_at);
}
function decode(row) { return row ? { ...JSON.parse(row.payload), state: row.state, updated_at: row.updated_at, applied_at: row.applied_at, message: row.message } : null; }
export function getFix(id, printerId) { return decode(db.prepare('SELECT * FROM diagnosis_fixes WHERE id=? AND printer_id=?').get(id,printerId)); }
export function listFixes(diagnosisId, printerId) { return db.prepare('SELECT * FROM diagnosis_fixes WHERE diagnosis_id=? AND printer_id=?').all(diagnosisId,printerId).map(decode); }
export function fixEvents(diagnosisId, printerId) { return db.prepare('SELECT e.* FROM diagnosis_fix_events e JOIN diagnosis_fixes f ON e.fix_id=f.id WHERE f.diagnosis_id=? AND e.printer_id=? ORDER BY e.id DESC').all(diagnosisId,printerId); }
export function claimFix(fix, action, now = Date.now()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const expected = action === 'apply' ? 'ready' : 'applied';
    const fresh = getFix(fix.id,fix.printer_id);
    if (fresh?.state !== expected) throw new Error('This action was already submitted or is unavailable.');
    const pending = db.prepare("SELECT id FROM diagnosis_fixes WHERE printer_id=? AND state IN ('applying','undoing','unconfirmed')").get(fix.printer_id);
    if (pending) throw new Error('A previous change is still unconfirmed. Inspect the live controls before making further changes.');
    if (action === 'apply') {
      const recent = db.prepare("SELECT id FROM diagnosis_fix_events WHERE printer_id=? AND action='apply' AND timestamp>? LIMIT 1").get(fix.printer_id,now-60000);
      if (recent) throw new Error('Wait at least one minute between fixes, then run a new diagnosis.');
      const newer = db.prepare("SELECT id FROM diagnosis_fix_events WHERE printer_id=? AND action='apply' AND timestamp>=? LIMIT 1").get(fix.printer_id,fix.created_at);
      if (newer) throw new Error('Run a new diagnosis after the previous adjustment before applying another fix.');
    }
    db.prepare('UPDATE diagnosis_fixes SET state=?,updated_at=?,message=NULL WHERE id=?').run(action === 'apply' ? 'applying' : 'undoing',now,fix.id);
    db.prepare('INSERT INTO diagnosis_fix_events(fix_id,printer_id,timestamp,action,outcome) VALUES (?,?,?,?,?)').run(fix.id,fix.printer_id,now,action,'submitted');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function finishFix(fix, action, result, now = Date.now()) {
  const state = result.confirmed ? action === 'apply' ? 'applied' : 'undone' : 'unconfirmed';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE diagnosis_fixes SET state=?,updated_at=?,applied_at=?,message=? WHERE id=? AND printer_id=?').run(state,now,action === 'apply' && result.confirmed ? now : fix.applied_at || null,result.message || null,fix.id,fix.printer_id);
    db.prepare('INSERT INTO diagnosis_fix_events(fix_id,printer_id,timestamp,action,outcome,detail) VALUES (?,?,?,?,?,?)').run(fix.id,fix.printer_id,now,action,state,JSON.stringify(result));
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
// A process restart cannot safely replay an in-flight command.
db.exec("UPDATE diagnosis_fixes SET state='unconfirmed',message='The service restarted during this change. Inspect live controls; this command will not be retried.' WHERE state IN ('applying','undoing')");

export function dismissFix(fix, now = Date.now()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = db.prepare("UPDATE diagnosis_fixes SET state='dismissed',updated_at=? WHERE id=? AND printer_id=? AND state='unconfirmed'").run(now,fix.id,fix.printer_id);
    if (!r.changes) throw new Error('Only unconfirmed changes can be acknowledged.');
    db.prepare('INSERT INTO diagnosis_fix_events(fix_id,printer_id,timestamp,action,outcome) VALUES (?,?,?,?,?)').run(fix.id,fix.printer_id,now,'dismiss','acknowledged');
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

export function recentFixes(printerId) {
  return db.prepare("SELECT * FROM diagnosis_fixes WHERE printer_id=? AND state!='ready' ORDER BY updated_at DESC LIMIT 20").all(printerId).map(decode);
}
export function recentFixEvents(printerId) {
  return db.prepare('SELECT * FROM diagnosis_fix_events WHERE printer_id=? ORDER BY id DESC LIMIT 40').all(printerId);
}
