/**
 * Perf-test DB setup: clear (fast) or compress+store large images (full Electron for nativeImage).
 * Usage: electron scripts/thumbnail-perf-db.js <clear|single|triple> [imagePath]
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { compressDataUrl } = require('../../thumbnail-compress');

const mode = process.argv[2];
const imagePath = process.argv[3] || 'C:\\Users\\cld\\Downloads\\10mb-example-jpg.jpg';
const dbPath = path.join(__dirname, '..', '..', 'printventory.db');

function loadImageAsDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const mime = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function writeResult(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
}

function runClear() {
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found:', dbPath);
    process.exit(1);
  }
  const db = new Database(dbPath);
  const changes = db.prepare("UPDATE models SET thumbnail = '3d.png'").run().changes;
  const modelCount = db.prepare('SELECT COUNT(*) AS count FROM models').get().count;
  db.close();
  writeResult({ mode: 'clear', changes, modelCount, dbSizeBytes: fs.statSync(dbPath).size, imagePath: null });
  process.exit(0);
}

function runCompressedInsert() {
  if (!mode || !['single', 'triple'].includes(mode)) {
    console.error('Usage: electron scripts/thumbnail-perf-db.js <clear|single|triple> [imagePath]');
    process.exit(1);
  }
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found:', dbPath);
    process.exit(1);
  }
  if (!fs.existsSync(imagePath)) {
    console.error('Image not found:', imagePath);
    process.exit(1);
  }

  const rawDataUrl = loadImageAsDataUrl(imagePath);
  const compressed = compressDataUrl(rawDataUrl);
  const thumbnailValue =
    mode === 'triple' ? `${compressed}::${compressed}::${compressed}` : compressed;

  const db = new Database(dbPath);
  const changes = db.prepare('UPDATE models SET thumbnail = ?').run(thumbnailValue).changes;
  const modelCount = db.prepare('SELECT COUNT(*) AS count FROM models').get().count;
  db.close();

  writeResult({
    mode,
    changes,
    modelCount,
    dbSizeBytes: fs.statSync(dbPath).size,
    imagePath,
    rawDataUrlChars: rawDataUrl.length,
    compressedDataUrlChars: compressed.length
  });
}

if (mode === 'clear') {
  try {
    runClear();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
} else {
  const { app } = require('electron');
  app.commandLine.appendSwitch('disable-gpu');
  app.whenReady().then(() => {
    try {
      runCompressedInsert();
    } catch (err) {
      console.error(err.message || err);
      process.exitCode = 1;
    } finally {
      app.exit(process.exitCode || 0);
    }
  });
}
