const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Determine data directory
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'printventory.db');
console.log('Database path:', dbPath);

let db;

try {
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
} catch (err) {
  console.error('Error opening database:', err);
  process.exit(1);
}

function initializeDatabase() {
  db.transaction(() => {
    // Create models table
    db.prepare(`CREATE TABLE IF NOT EXISTS models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE,
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
        isZipArchive INTEGER
    )`).run();

    // Create tags table
    db.prepare(`CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )`).run();

    // Create model_tags table
    db.prepare(`CREATE TABLE IF NOT EXISTS model_tags (
        model_id INTEGER,
        tag_id INTEGER,
        FOREIGN KEY(model_id) REFERENCES models(id),
        FOREIGN KEY(tag_id) REFERENCES tags(id),
        PRIMARY KEY(model_id, tag_id)
    )`).run();

    // Create settings table
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`).run();

    // Create slicers table
    db.prepare(`CREATE TABLE IF NOT EXISTS slicers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL
    )`).run();

    // Create indexes
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_uuid ON models(uuid)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_filepath ON models(filePath)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_filename ON models(fileName)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_designer ON models(designer)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_model_tags_tag_id ON model_tags(tag_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_model_tags_model_id ON model_tags(model_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_size ON models(size)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_modifieddate ON models(modifiedDate)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_license ON models(license)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_parentmodel ON models(parentModel)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_printed ON models(printed)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_hash ON models(hash)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_thumbnail ON models(thumbnail)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_designer_filename ON models(designer, fileName)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_license_modifieddate ON models(license, modifiedDate)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_printed_modifieddate ON models(printed, modifiedDate)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_parentmodel_modifieddate ON models(parentModel, modifiedDate)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_dateadded ON models(dateAdded)').run();
  })();

  // Migration: Add uuid to existing rows if null
  // Also add isZipArchive column if it doesn't exist
  migrateDatabase();
  initializeDefaultSettings();
}

function migrateDatabase() {
  try {
    // Check for uuid column
    const tableInfo = db.prepare("PRAGMA table_info(models)").all();
    const hasUuid = tableInfo.some(col => col.name === 'uuid');
    if (!hasUuid) {
      console.log('Adding uuid column to models table...');
      db.prepare('ALTER TABLE models ADD COLUMN uuid TEXT UNIQUE').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_uuid ON models(uuid)').run();
    }

    // Check for isZipArchive column
    const hasIsZipArchive = tableInfo.some(col => col.name === 'isZipArchive');
    if (!hasIsZipArchive) {
      console.log('Adding isZipArchive column to models table...');
      db.prepare('ALTER TABLE models ADD COLUMN isZipArchive INTEGER').run();
    }

    // Populate missing UUIDs
    const modelsWithoutUuid = db.prepare('SELECT id FROM models WHERE uuid IS NULL').all();
    if (modelsWithoutUuid.length > 0) {
      console.log(`Generating UUIDs for ${modelsWithoutUuid.length} models...`);
      const updateStmt = db.prepare('UPDATE models SET uuid = ? WHERE id = ?');
      db.transaction(() => {
        for (const model of modelsWithoutUuid) {
          updateStmt.run(crypto.randomUUID(), model.id);
        }
      })();
    }
  } catch (error) {
    console.error('Error migrating database:', error);
  }
}

function initializeDefaultSettings() {
    const defaultSettings = [
      { key: 'theme', value: 'light' },
      { key: 'maxThumbnailSize', value: '300' },
      { key: 'maxConcurrentRenders', value: '3' },
      { key: 'enableZipArchives', value: '0' },
      { key: 'aiTagMaxTags', value: '10' },
      { key: 'aiTagUseCategories', value: '0' },
      { key: 'aiTagMergeStrategy', value: 'merge' },
      { key: 'aiTagAllowRetagging', value: '0' },
      { key: 'aiTagConcurrency', value: '3' },
      { key: 'maxFileSizeMB', value: '50' }
    ];

    const insertStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const setting of defaultSettings) {
      insertStmt.run(setting.key, setting.value);
    }
}

module.exports = { db, initializeDatabase };
