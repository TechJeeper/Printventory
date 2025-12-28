const express = require('express');
const router = express.Router();
const { db } = require('./db');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const crypto = require('crypto');

// Helper to get UUID from filePath (if needed)
function getUuidByPath(filePath) {
  const row = db.prepare('SELECT uuid FROM models WHERE filePath = ?').get(filePath);
  return row ? row.uuid : null;
}

// POST /api/models/lookup
router.post('/models/lookup', (req, res) => {
  const { filePath } = req.body;
  try {
    const row = db.prepare('SELECT uuid FROM models WHERE filePath = ?').get(filePath);
    if (row) {
      res.json({ uuid: row.uuid });
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/models
router.get('/models', (req, res) => {
  const sortOption = req.query.sort || 'date-desc';
  let orderClause = "ORDER BY modifiedDate DESC";

  switch (sortOption) {
      case "name-asc": orderClause = "ORDER BY fileName ASC"; break;
      case "name-desc": orderClause = "ORDER BY fileName DESC"; break;
      case "size-asc": orderClause = "ORDER BY size ASC"; break;
      case "size-desc": orderClause = "ORDER BY size DESC"; break;
      case "date-asc": orderClause = "ORDER BY modifiedDate ASC"; break;
      case "date-desc": orderClause = "ORDER BY modifiedDate DESC"; break;
      case "dateadded-asc": orderClause = "ORDER BY dateAdded ASC"; break;
      case "dateadded-desc": orderClause = "ORDER BY dateAdded DESC"; break;
  }

  try {
    const models = db.prepare(`SELECT * FROM models ${orderClause}`).all();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/models/filter
router.post('/models/filter', (req, res) => {
  const filters = req.body;
  try {
    const conditions = [];
    const params = [];

    if (filters.designer) {
      if (filters.designer === '__none__') {
        conditions.push("(designer IS NULL OR designer = '')");
      } else {
        conditions.push("LOWER(TRIM(designer)) = LOWER(TRIM(?))");
        params.push(filters.designer);
      }
    }

    if (filters.license) {
        if (filters.license === '__none__') {
            conditions.push("(license IS NULL OR license = '')");
        } else {
            conditions.push("license = ?");
            params.push(filters.license);
        }
    }

    if (filters.parentModel) {
        if (filters.parentModel === '__none__') {
            conditions.push("(parentModel IS NULL OR parentModel = '')");
        } else {
            conditions.push("parentModel = ?");
            params.push(filters.parentModel);
        }
    }

    if (filters.printed !== undefined && filters.printed !== 'all') {
        if (filters.printed === 'printed') conditions.push("printed = 1");
        else if (filters.printed === 'not-printed') conditions.push("printed = 0");
    }

    if (filters.search) {
        const searchTerm = `%${filters.search.toLowerCase()}%`;
        conditions.push(`(
            LOWER(fileName) LIKE ? OR
            LOWER(designer) LIKE ? OR
            LOWER(parentModel) LIKE ? OR
            LOWER(notes) LIKE ? OR
            LOWER(filePath) LIKE ?
        )`);
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT * FROM models ${whereClause} ORDER BY modifiedDate DESC`;

    const models = db.prepare(query).all(...params);

    // Tag filter (post-processing as per original implementation)
    if (filters.tag) {
        const tagFiltered = [];
        for (const model of models) {
            const tags = db.prepare(`SELECT t.name FROM tags t JOIN model_tags mt ON t.id = mt.tag_id WHERE mt.model_id = ?`).all(model.id);
            if (tags.some(t => t.name === filters.tag)) {
                tagFiltered.push(model);
            }
        }
        res.json(tagFiltered);
    } else {
        res.json(models);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/models/:uuid
router.get('/models/:uuid', (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE uuid = ?').get(req.params.uuid);
  if (model) {
    // Get tags
    const tags = db.prepare(`
      SELECT t.name
      FROM tags t
      JOIN model_tags mt ON mt.tag_id = t.id
      WHERE mt.model_id = ?
    `).all(model.id).map(t => t.name);
    res.json({ ...model, tags });
  } else {
    res.status(404).json({ error: 'Model not found' });
  }
});

// POST /api/scan
router.post('/scan', (req, res) => {
  const { directoryPath } = req.body;
  if (!directoryPath) return res.status(400).json({ error: 'Directory path required' });

  // Start worker
  const worker = new Worker(path.join(__dirname, 'scan-worker.js'));

  // Get socket.io instance from req.app
  const io = req.app.get('io');

  worker.on('message', (message) => {
    if (message.type === 'progress') {
      io.emit('scan-progress', { processed: message.processed });
    } else if (message.type === 'done') {
      const { files } = message.result;
      // Process files (DB update)
      // This is CPU intensive, maybe do it in chunks
      // For now, simple implementation

      const insertNew = db.prepare(`
        INSERT INTO models (
          uuid, filePath, fileName, hash, size, modifiedDate, dateAdded
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const updateExisting = db.prepare(`
        UPDATE models SET hash = ?, size = ?, modifiedDate = ? WHERE filePath = ?
      `);

      db.transaction(() => {
        for (const file of files) {
          const exists = db.prepare('SELECT 1 FROM models WHERE filePath = ?').get(file.filePath);
          if (exists) {
            updateExisting.run(file.hash || '', file.size, file.mtime, file.filePath);
          } else {
            insertNew.run(
              crypto.randomUUID(),
              file.filePath,
              file.fileName,
              file.hash || '',
              file.size,
              file.mtime,
              new Date().toISOString()
            );
          }
        }
      })();

      io.emit('scan-complete', { count: files.length });
      worker.terminate();
    }
  });

  worker.postMessage({ directoryPath, maxFileSize: 50 * 1024 * 1024, enableZipArchives: false }); // Todo: get settings

  res.json({ status: 'scanning_started' });
});

// GET /api/files/:uuid/content
router.get('/files/:uuid/content', (req, res) => {
  const model = db.prepare('SELECT filePath FROM models WHERE uuid = ?').get(req.params.uuid);
  if (!model) return res.status(404).send('Not found');

  // Handle zip entries
  if (model.filePath.includes('::')) {
      // Extract logic needed
      // For now, just error or handle regular files
      return res.status(501).send('Zip extraction not implemented in simple server yet');
  }

  res.sendFile(model.filePath);
});

// Helper for metadata
router.get('/metadata/designers', (req, res) => {
    const rows = db.prepare("SELECT DISTINCT designer FROM models WHERE designer IS NOT NULL AND designer != ''").all();
    res.json(rows.map(r => r.designer));
});

// ... other metadata endpoints ...

module.exports = router;
