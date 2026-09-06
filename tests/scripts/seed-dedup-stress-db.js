/**
 * Seed an isolated DB for dedup stress tests (must run under Electron — better-sqlite3 ABI).
 *
 * Usage:
 *   npx electron tests/scripts/seed-dedup-stress-db.js [groups] [filesPerGroup] [dbPath]
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const GROUPS = Math.max(1, Number(process.argv[2] || 25000));
const FILES_PER_GROUP = Math.max(2, Number(process.argv[3] || 2));
const DB_PATH = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(__dirname, '..', 'test-dedup-stress', 'printventory.db');

function removeSqliteFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      if (e.code !== 'EBUSY') throw e;
    }
  }
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    removeSqliteFiles(DB_PATH);

    const total = GROUPS * FILES_PER_GROUP;
    console.log(`Seeding ${GROUPS.toLocaleString()} groups × ${FILES_PER_GROUP} = ${total.toLocaleString()} models → ${DB_PATH}`);
    const t0 = Date.now();

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = OFF');

    db.exec(`
      CREATE TABLE models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filePath TEXT UNIQUE,
        fileName TEXT,
        designer TEXT,
        source TEXT,
        notes TEXT,
        printed INTEGER,
        thumbnail TEXT,
        parentModel TEXT,
        hash TEXT,
        size INTEGER,
        license TEXT,
        modifiedDate DATETIME,
        dateAdded DATETIME,
        isNew INTEGER DEFAULT 1,
        rating INTEGER DEFAULT 0,
        favorite INTEGER DEFAULT 0,
        bundleKey TEXT,
        bundleLabel TEXT,
        bundleKind TEXT
      );
      CREATE INDEX idx_models_hash ON models(hash);
      CREATE INDEX idx_models_filepath ON models(filePath);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
      CREATE TABLE model_tags (
        model_id INTEGER,
        tag_id INTEGER,
        PRIMARY KEY(model_id, tag_id)
      );
      CREATE TABLE slicers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL
      );
    `);

    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('hasRunBefore', 'true');
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('termsAccepted', 'true');

    const insert = db.prepare(`
      INSERT INTO models (filePath, fileName, hash, size, thumbnail, dateAdded, isNew)
      VALUES (?, ?, ?, ?, '3d.png', datetime('now'), 0)
    `);

    db.transaction(() => {
      for (let g = 0; g < GROUPS; g++) {
        const hash = g.toString(16).padStart(32, '0');
        const size = 1000 + (g % 5000);
        for (let f = 0; f < FILES_PER_GROUP; f++) {
          const fileName = `dup_${g}_${f}.stl`;
          const filePath = `C:\\stress\\dedup\\group_${g}\\${fileName}`;
          insert.run(filePath, fileName, hash, size);
        }
      }
    })();

    const count = db.prepare('SELECT COUNT(*) AS c FROM models').get().c;
    const dupGroups = db.prepare(`
      SELECT COUNT(*) AS c FROM (
        SELECT hash FROM models
        WHERE hash IS NOT NULL AND hash != ''
        GROUP BY hash HAVING COUNT(DISTINCT filePath) > 1
      )
    `).get().c;
    db.close();

    const result = {
      ok: true,
      groups: GROUPS,
      filesPerGroup: FILES_PER_GROUP,
      count,
      dupGroups,
      seedMs: Date.now() - t0,
      dbPath: DB_PATH,
      dbBytes: fs.statSync(DB_PATH).size
    };
    console.log(
      `Seeded ${count.toLocaleString()} rows, ${dupGroups.toLocaleString()} dup groups in ${result.seedMs}ms (${formatBytes(result.dbBytes)})`
    );
    // Machine-readable line for the parent stress runner
    console.log('SEED_RESULT ' + JSON.stringify(result));
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
