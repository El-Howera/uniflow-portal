/**
 * Phase 12 — pg_dump-driven database backups.
 *
 *   • Spawns `pg_dump` in `--format=custom` (.dump) which is what
 *     `pg_restore` consumes. Compressed by default.
 *   • Writes the file to `backend/backups/` and records a `SystemBackup`
 *     row at start (status='pending') + completion (success | failed +
 *     bytes/path).
 *   • node-cron schedule honours `SystemSettings.backupFrequency`:
 *       'daily'    → 02:00 server time every day
 *       'weekly'   → Sunday 02:00
 *       'monthly'  → 1st day of month 02:00
 *       anything else (incl. 'off' / 'never') → no scheduled run.
 *   • Retention: deletes any backup files older than 30 days when a new
 *     run completes successfully.
 *
 * Usage:
 *   const backup = require('../../lib/backup');
 *   await backup.runBackup({ prisma, triggeredBy: 'manual', userId });
 *   backup.startScheduler({ prisma });
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');

// Resolve the backups directory once at module load. Lives outside the
// servers/ tree so it isn't confused with anything served by Express.
const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// 30 days in ms. Anything older that lives in BACKUP_DIR after a successful
// run is deleted (file + DB row gets the 'failed_retention' tag).
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function parseDatabaseUrl(rawUrl) {
  // postgresql://user:pass@host:port/db?...
  const u = new URL(rawUrl);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port || '5432',
    database: u.pathname.replace(/^\//, ''),
  };
}

/**
 * Resolve which Postgres client binary to spawn. Order:
 *   1. process.env[`${name.toUpperCase()}_PATH`] — explicit override
 *      (e.g. PG_DUMP_PATH, PG_RESTORE_PATH).
 *   2. The bare command if on PATH (Linux/Mac happy path).
 *   3. Common Windows install locations (PostgreSQL bin dirs + the one this
 *      project's owner happens to use).
 * Returns the absolute path or the bare command. Returns null on Windows
 * when no candidate is found, so the caller can surface a friendly error.
 */
function resolvePgBinary(name) {
  const envKey = `${name.toUpperCase()}_PATH`;
  if (process.env[envKey] && fs.existsSync(process.env[envKey])) {
    return process.env[envKey];
  }
  if (process.platform !== 'win32') {
    return name; // Linux/Mac — let PATH resolve it
  }

  const candidates = [];
  for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
    try {
      if (fs.existsSync(root)) {
        for (const v of fs.readdirSync(root)) {
          candidates.push(path.join(root, v, 'bin', `${name}.exe`));
        }
      }
    } catch { /* skip */ }
  }
  // Project-specific fallback: the owner of this repo installed Postgres at
  // E:\College\Postgre\bin\. Cheap to check; harmless on machines that don't
  // have it.
  candidates.push(`E:\\College\\Postgre\\bin\\${name}.exe`);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Backwards-compat shim — used by spawnPgDump and a couple of older callers.
function resolvePgDumpPath() {
  return resolvePgBinary('pg_dump');
}

/**
 * Spawn pg_dump and stream stderr to a buffer for the audit log.
 * Returns { code, stderr, sizeBytes } on completion.
 */
function spawnPgDump({ pgDumpBin, env, args, outFile }) {
  return new Promise((resolve) => {
    const child = spawn(pgDumpBin, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      // Most common error here is "pg_dump not on PATH"; surface as a
      // failed run with a useful message instead of crashing the caller.
      const friendly = err.code === 'ENOENT'
        ? `pg_dump not found at "${pgDumpBin}". Set PG_DUMP_PATH env var (e.g. PG_DUMP_PATH=E:\\College\\Postgre\\bin\\pg_dump.exe) or add the PostgreSQL bin directory to PATH.`
        : err.message;
      resolve({ code: -1, stderr: friendly, sizeBytes: 0 });
    });
    child.on('close', (code) => {
      let sizeBytes = 0;
      try {
        if (fs.existsSync(outFile)) sizeBytes = fs.statSync(outFile).size;
      } catch { /* ignore */ }
      resolve({ code, stderr, sizeBytes });
    });
  });
}

/** Trim files in BACKUP_DIR older than 30 days. Best-effort. */
function pruneOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const cutoff = Date.now() - RETENTION_MS;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      const full = path.join(BACKUP_DIR, f);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* skip */ }
    }
  } catch { /* swallow — retention is best-effort */ }
}

/**
 * Execute one backup run. Writes a SystemBackup row at the start so a long-
 * running dump still shows up in the admin History table immediately, then
 * updates it on completion. Returns the final SystemBackup row.
 */
async function runBackup({ prisma, triggeredBy = 'manual', userId = null } = {}) {
  ensureBackupDir();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL not set — cannot run pg_dump');
  }
  const conn = parseDatabaseUrl(dbUrl);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `uniflow-${stamp}-${triggeredBy}.dump`;
  const outFile = path.join(BACKUP_DIR, filename);

  // Insert the pending row first so the admin History view can show "in
  // progress" while the dump runs.
  const startRow = await prisma.systemBackup.create({
    data: {
      kind: triggeredBy === 'scheduled' ? 'scheduled' : 'manual',
      status: 'pending',
      path: filename,
      createdById: userId,
    },
  });

  const args = [
    '-h', conn.host,
    '-p', String(conn.port),
    '-U', conn.user,
    '-d', conn.database,
    '-F', 'c',           // custom format → .dump
    '-Z', '6',           // medium compression
    '-f', outFile,
  ];
  const env = { ...process.env, PGPASSWORD: conn.password };

  const pgDumpBin = resolvePgDumpPath();
  if (!pgDumpBin) {
    const failed = await prisma.systemBackup.update({
      where: { id: startRow.id },
      data: {
        status: 'failed',
        path: `${filename} | ERROR: pg_dump not found. Set PG_DUMP_PATH env var (e.g. PG_DUMP_PATH=E:\\College\\Postgre\\bin\\pg_dump.exe) or add PostgreSQL bin to PATH.`,
      },
    });
    try { fs.unlinkSync(outFile); } catch { /* ignore */ }
    return failed;
  }

  let result;
  try {
    result = await spawnPgDump({ pgDumpBin, env, args, outFile });
  } catch (err) {
    result = { code: -1, stderr: err.message || 'spawn error', sizeBytes: 0 };
  }

  if (result.code === 0 && result.sizeBytes > 0) {
    const finished = await prisma.systemBackup.update({
      where: { id: startRow.id },
      data: { status: 'success', bytes: BigInt(result.sizeBytes) },
    });
    pruneOldBackups();
    return finished;
  }

  // Non-zero exit OR empty file → mark failed and remove the partial file.
  try { fs.unlinkSync(outFile); } catch { /* file may not exist */ }
  const failed = await prisma.systemBackup.update({
    where: { id: startRow.id },
    data: {
      status: 'failed',
      // SystemBackup has no errorMessage column; pin the stderr tail onto
      // `path` for visibility. Bytes stays null.
      path: `${filename} | ERROR: ${(result.stderr || '').slice(-300)}`,
    },
  });
  return failed;
}

let activeJob = null;
let activeFrequency = null;

function frequencyToCron(freq) {
  switch (String(freq).toLowerCase()) {
    case 'daily':   return '0 2 * * *';     // 02:00 every day
    case 'weekly':  return '0 2 * * 0';     // Sunday 02:00
    case 'monthly': return '0 2 1 * *';     // 1st of month 02:00
    default:        return null;            // 'off' / 'never' / unset
  }
}

/**
 * Start (or replace) the cron schedule based on the current
 * SystemSettings.backupFrequency. Safe to call multiple times — stopping
 * the existing job first.
 *
 * The schedule is checked again whenever an admin saves Settings; that
 * caller should invoke `restartScheduler({ prisma })` to pick up the new
 * frequency without a server restart.
 */
async function restartScheduler({ prisma }) {
  if (activeJob) {
    try { activeJob.stop(); } catch { /* ignore */ }
    activeJob = null;
    activeFrequency = null;
  }

  let frequency = 'off';
  try {
    const s = await prisma.systemSettings.findFirst({ select: { backupFrequency: true } });
    frequency = s?.backupFrequency || 'off';
  } catch { /* fall back to off */ }

  const expr = frequencyToCron(frequency);
  if (!expr) {
    console.log(`[backup] cron disabled (frequency='${frequency}')`);
    return;
  }

  activeJob = cron.schedule(expr, async () => {
    console.log(`[backup] scheduled run starting (frequency='${frequency}')`);
    try {
      const row = await runBackup({ prisma, triggeredBy: 'scheduled', userId: null });
      console.log(`[backup] scheduled run complete -> ${row.status}`);
    } catch (err) {
      console.error('[backup] scheduled run failed:', err);
    }
  });
  activeFrequency = frequency;
  console.log(`[backup] cron scheduled - frequency='${frequency}', cron='${expr}'`);
}

function getBackupDir() { return BACKUP_DIR; }

// ============================================================================
// RESTORE  (Phase 12 follow-up — destructive, admin-only)
// ============================================================================

/**
 * Spawn pg_restore against an existing dump file. Streams stderr for the
 * audit log. `pg_restore` exits 0 on full success, 1 on warnings (e.g.
 * "role does not exist" because of `--no-owner`), and >1 on hard errors.
 *
 * We treat exit codes 0 and 1 as success — warnings are common and don't
 * mean the data didn't load.
 */
function spawnPgRestore({ pgRestoreBin, env, args }) {
  return new Promise((resolve) => {
    const child = spawn(pgRestoreBin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', (err) => {
      const friendly = err.code === 'ENOENT'
        ? `pg_restore not found at "${pgRestoreBin}". Set PG_RESTORE_PATH env var or add PostgreSQL bin to PATH.`
        : err.message;
      resolve({ code: -1, stderr: friendly, stdout });
    });
    child.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}

/**
 * Restore the database from a previously-successful SystemBackup row's file.
 * Destructive:
 *   • Uses `--clean --if-exists` so existing tables/types are dropped first.
 *   • `--no-owner --no-acl` so the dump can be loaded as the connecting
 *     role even when it was created under a different superuser.
 *   • `--single-transaction` so a partial-failure rolls back instead of
 *     leaving the DB half-loaded.
 *
 * Caller is expected to have already enabled maintenance mode + audit-logged
 * the trigger. The restore writes a SystemBackup row (kind='restore') so it
 * shows up in History next to the dumps.
 */
async function runRestore({ prisma, backupId, userId = null } = {}) {
  if (!backupId) throw new Error('backupId required');

  const target = await prisma.systemBackup.findUnique({ where: { id: backupId } });
  if (!target) throw new Error('Backup not found');
  if (target.status !== 'success') {
    throw new Error(`Backup is "${target.status}" — only successful backups can be restored.`);
  }
  if (!target.path) throw new Error('Backup has no file on disk');

  const filename = String(target.path).split(' | ')[0];
  const fullPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Backup file ${filename} no longer on disk (retention may have removed it).`);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set — cannot run pg_restore');
  const conn = parseDatabaseUrl(dbUrl);

  const pgRestoreBin = resolvePgBinary('pg_restore');
  if (!pgRestoreBin) {
    throw new Error(
      'pg_restore not found. Set PG_RESTORE_PATH env var (e.g. ' +
      'PG_RESTORE_PATH=E:\\College\\Postgre\\bin\\pg_restore.exe) or add ' +
      'PostgreSQL bin to PATH.'
    );
  }

  // Insert a "pending" restore row in History so the admin sees it in flight.
  const startRow = await prisma.systemBackup.create({
    data: {
      kind: 'restore',
      status: 'pending',
      path: `Restore from ${filename}`,
      createdById: userId,
    },
  });

  const args = [
    '-h', conn.host,
    '-p', String(conn.port),
    '-U', conn.user,
    '-d', conn.database,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '--single-transaction',
    fullPath,
  ];
  const env = { ...process.env, PGPASSWORD: conn.password };

  let result;
  try {
    result = await spawnPgRestore({ pgRestoreBin, env, args });
  } catch (err) {
    result = { code: -1, stderr: err.message || 'spawn error', stdout: '' };
  }

  // pg_restore exits 0 (clean) or 1 (warnings — e.g. "role does not exist"
  // because of --no-owner). Anything else is failure.
  const ok = result.code === 0 || result.code === 1;
  const finished = await prisma.systemBackup.update({
    where: { id: startRow.id },
    data: {
      status: ok ? 'success' : 'failed',
      path: ok
        ? `Restore from ${filename}${result.code === 1 ? ' (with warnings)' : ''}`
        : `Restore from ${filename} | ERROR: ${(result.stderr || '').slice(-400)}`,
    },
  });

  return {
    row: finished,
    restored: ok,
    exitCode: result.code,
    stderr: result.stderr,
  };
}

module.exports = {
  runBackup,
  runRestore,
  restartScheduler,
  getBackupDir,
  // Re-exported so callers can advertise the active schedule on a stat tile.
  getActiveFrequency: () => activeFrequency,
};
