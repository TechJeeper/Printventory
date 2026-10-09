#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  NO_PARENT_FOLDER,
  SPACE_MARGIN_BYTES,
  SKIP,
  directoriesOverlap,
  listChildDirectories,
  planOrganize,
  withFreeSpace,
  relocatePlannedFile
} = require('./organize-library');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function layout() {
  const root = path.join(os.tmpdir(), 'organize-library-plan');
  return {
    root,
    source: path.join(root, 'downloads'),
    dest: path.join(root, 'library')
  };
}

function model(filePath, extra) {
  return Object.assign({
    id: 1,
    filePath,
    fileName: path.basename(filePath),
    parentModel: 'Articulated Dragon',
    size: 12
  }, extra || {});
}

const dirs = layout();

test('nests files as destination / parent model / file name', () => {
  const filePath = path.join(dirs.source, 'loose', 'head.stl');
  const plan = planOrganize([model(filePath)], dirs.source, dirs.dest);
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.moves.length, 1);
  assert.strictEqual(plan.moves[0].action, 'copy');
  assert.strictEqual(
    plan.moves[0].to,
    path.join(dirs.dest, 'Articulated Dragon', 'head.stl')
  );
  assert.strictEqual(plan.noParentCount, 0);
});

test('stacks the folders the user chooses', () => {
  const filePath = path.join(dirs.source, 'head.stl');
  const plan = planOrganize(
    [model(filePath, { designer: 'Alice', parentModel: 'Dragon', license: 'CC-BY' })],
    dirs.source,
    dirs.dest,
    { layers: ['designer', 'parentModel'] }
  );
  assert.strictEqual(
    plan.moves[0].to,
    path.join(dirs.dest, 'Alice', 'Dragon', 'head.stl')
  );
});

test('uses an empty-value folder for a missing layer', () => {
  const filePath = path.join(dirs.source, 'head.stl');
  const plan = planOrganize(
    [model(filePath, { designer: '', parentModel: 'Dragon' })],
    dirs.source,
    dirs.dest,
    { layers: ['designer', 'parentModel'] }
  );
  assert.strictEqual(plan.moves[0].to, path.join(dirs.dest, 'No Designer', 'Dragon', 'head.stl'));
  assert.strictEqual(plan.emptyLayers[0].folder, 'No Designer');
  assert.strictEqual(plan.emptyLayers[0].count, 1);
});

test('puts files in the destination root when no folders are chosen', () => {
  const filePath = path.join(dirs.source, 'head.stl');
  const plan = planOrganize(
    [model(filePath)],
    dirs.source,
    dirs.dest,
    { layers: [] }
  );
  assert.strictEqual(plan.moves[0].to, path.join(dirs.dest, 'head.stl'));
});

test('puts files with no parent model in No Parent Model', () => {
  const filePath = path.join(dirs.source, 'widget.stl');
  const plan = planOrganize(
    [model(filePath, { parentModel: '   ' })],
    dirs.source,
    dirs.dest
  );
  assert.strictEqual(plan.moves[0].to, path.join(dirs.dest, NO_PARENT_FOLDER, 'widget.stl'));
  assert.strictEqual(plan.noParentCount, 1);
});

test('skips zip entries and browser links that live under the source', () => {
  const zipPath = path.join(dirs.source, 'pack.zip') + '::part.stl';
  const urlPath = 'url::https://example.com/model';
  const loose = path.join(dirs.source, 'kept.stl');
  const plan = planOrganize(
    [
      model(zipPath, { fileName: 'part.stl' }),
      model(urlPath, { fileName: 'remote.stl' }),
      model(loose, { fileName: 'kept.stl', parentModel: 'Kept' })
    ],
    dirs.source,
    dirs.dest
  );
  assert.strictEqual(plan.moves.length, 1);
  assert.strictEqual(plan.moves[0].fileName, 'kept.stl');
  assert.ok(plan.skipped.some((item) => item.filePath === zipPath && item.reason === SKIP.ZIP));
  assert.strictEqual(plan.skipped.some((item) => item.reason === SKIP.URL), false);
});

test('moves each zip once and rewrites the entry paths when includeZips is set', () => {
  const zip = path.join(dirs.source, 'pack.zip');
  const plan = planOrganize(
    [
      model(zip + '::a.stl', { id: 1, fileName: 'a.stl', parentModel: 'Dragon', size: 10 }),
      model(zip + '::b.stl', { id: 2, fileName: 'b.stl', parentModel: 'Dragon', size: 20 }),
      model(zip + '::c.stl', { id: 3, fileName: 'c.stl', parentModel: 'Other', size: 4 })
    ],
    dirs.source,
    dirs.dest,
    {
      includeZips: true,
      sourceStat: (target) => (target === zip ? { size: 100, isFile: true } : null)
    }
  );
  assert.strictEqual(plan.moves.length, 1);
  assert.strictEqual(plan.moves[0].kind, 'zip');
  assert.strictEqual(plan.moves[0].to, path.join(dirs.dest, 'Dragon', 'pack.zip'));
  assert.strictEqual(plan.moves[0].bytes, 100);
  assert.strictEqual(plan.copyBytes, 100);
  assert.strictEqual(plan.zipEntryCount, 3);
  assert.deepStrictEqual(
    plan.moves[0].libraryUpdates.map((row) => row.to),
    [
      path.join(dirs.dest, 'Dragon', 'pack.zip') + '::a.stl',
      path.join(dirs.dest, 'Dragon', 'pack.zip') + '::b.stl',
      path.join(dirs.dest, 'Dragon', 'pack.zip') + '::c.stl'
    ]
  );
  assert.strictEqual(plan.skipped.length, 0);
});

test('still skips zip entries when includeZips is off', () => {
  const zip = path.join(dirs.source, 'pack.zip');
  const plan = planOrganize(
    [model(zip + '::a.stl', { fileName: 'a.stl' })],
    dirs.source,
    dirs.dest,
    { includeZips: false }
  );
  assert.strictEqual(plan.moves.length, 0);
  assert.strictEqual(plan.skipped[0].reason, SKIP.ZIP);
});

test('copies the zip file and leaves it packed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-library-zip-'));
  const source = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(source);
  fs.mkdirSync(dest);
  const zip = path.join(source, 'pack.zip');
  fs.writeFileSync(zip, 'zip-bytes-not-extracted');
  const plan = planOrganize(
    [
      model(zip + '::a.stl', { id: 1, fileName: 'a.stl', parentModel: 'Dragon', size: 4 }),
      model(zip + '::b.stl', { id: 2, fileName: 'b.stl', parentModel: 'Dragon', size: 4 })
    ],
    source,
    dest,
    {
      includeZips: true,
      sourceStat: () => ({ size: Buffer.byteLength('zip-bytes-not-extracted'), isFile: true })
    }
  );
  const updates = [];
  const result = await relocatePlannedFile(plan.moves[0], {
    updateLibrary: async (rows) => {
      updates.push(...rows);
    }
  });
  assert.strictEqual(result.status, 'moved');
  assert.strictEqual(fs.existsSync(zip), false);
  assert.strictEqual(fs.readFileSync(plan.moves[0].to, 'utf8'), 'zip-bytes-not-extracted');
  assert.strictEqual(fs.readdirSync(path.join(dest, 'Dragon')).length, 1);
  assert.strictEqual(updates.length, 2);
  assert.ok(updates[0].to.endsWith('::a.stl'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('gives a unique name when two models want the same file', () => {
  const first = path.join(dirs.source, 'a', 'head.stl');
  const second = path.join(dirs.source, 'b', 'head.stl');
  const plan = planOrganize(
    [
      model(first, { id: 1, size: 4 }),
      model(second, { id: 2, size: 4 })
    ],
    dirs.source,
    dirs.dest
  );
  assert.strictEqual(plan.moves[0].to, path.join(dirs.dest, 'Articulated Dragon', 'head.stl'));
  assert.strictEqual(plan.moves[1].to, path.join(dirs.dest, 'Articulated Dragon', 'head (2).stl'));
});

test('resumes when the destination file already matches, otherwise picks a new name', () => {
  const filePath = path.join(dirs.source, 'head.stl');
  const existing = path.join(dirs.dest, 'Articulated Dragon', 'head.stl');
  const resume = planOrganize(
    [model(filePath, { size: 8 })],
    dirs.source,
    dirs.dest,
    {
      destStat: (target) => (target === existing ? { size: 8, isFile: true } : null)
    }
  );
  assert.strictEqual(resume.moves[0].action, 'resume');
  assert.strictEqual(resume.copyBytes, 0);

  const clash = planOrganize(
    [model(filePath, { size: 8 })],
    dirs.source,
    dirs.dest,
    {
      destStat: (target) => (target === existing ? { size: 3, isFile: true } : null)
    }
  );
  assert.strictEqual(clash.moves[0].action, 'copy');
  assert.strictEqual(path.basename(clash.moves[0].to), 'head (2).stl');
  assert.strictEqual(clash.copyBytes, 8);
});

test('rejects overlapping source and destination folders', () => {
  const same = planOrganize([], dirs.source, dirs.source);
  assert.strictEqual(same.ok, false);
  const inside = planOrganize([], dirs.source, path.join(dirs.source, 'nested'));
  assert.strictEqual(inside.ok, false);
  assert.strictEqual(directoriesOverlap(dirs.dest, path.join(dirs.dest, 'child')), true);
  assert.strictEqual(directoriesOverlap(dirs.source, dirs.dest), false);
});

test('strips parent names that would escape the destination root', () => {
  const filePath = path.join(dirs.source, 'head.stl');
  const plan = planOrganize(
    [model(filePath, { parentModel: '..\\..\\Windows' })],
    dirs.source,
    dirs.dest
  );
  assert.strictEqual(plan.ok, true);
  assert.ok(plan.moves[0].to.startsWith(dirs.dest));
  assert.strictEqual(plan.moves[0].to.includes('..'), false);
});

test('requires copy size plus a 64MB margin of free space', () => {
  const filePath = path.join(dirs.source, 'head.stl');
  const plan = planOrganize([model(filePath, { size: 50 })], dirs.source, dirs.dest);
  const short = withFreeSpace(plan, 50);
  assert.strictEqual(short.enoughSpace, false);
  const enough = withFreeSpace(plan, 50 + SPACE_MARGIN_BYTES);
  assert.strictEqual(enough.enoughSpace, true);
  const resumesOnly = withFreeSpace({ ...plan, copyBytes: 0, ok: true }, 0);
  assert.strictEqual(resumesOnly.enoughSpace, true);
});

test('copies, checks size, then deletes the original', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-library-'));
  const source = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(source);
  fs.mkdirSync(dest);
  const from = path.join(source, 'head.stl');
  const body = 'mesh-bytes';
  fs.writeFileSync(from, body);
  const plan = planOrganize(
    [model(from, { size: Buffer.byteLength(body) })],
    source,
    dest,
    { sourceStat: () => ({ size: Buffer.byteLength(body), isFile: true }) }
  );
  let updated = null;
  const result = await relocatePlannedFile(plan.moves[0], {
    updateFilePath: (fromPath, toPath) => {
      updated = { fromPath, toPath };
    }
  });
  assert.strictEqual(result.status, 'moved');
  assert.strictEqual(fs.existsSync(from), false);
  assert.strictEqual(fs.readFileSync(updated.toPath, 'utf8'), body);
  fs.rmSync(root, { recursive: true, force: true });
});

test('keeps the original when the copy size does not match', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-library-bad-'));
  const source = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(source);
  fs.mkdirSync(dest);
  const from = path.join(source, 'head.stl');
  fs.writeFileSync(from, 'mesh-bytes-longer');
  const plan = planOrganize(
    [model(from, { size: Buffer.byteLength('mesh-bytes-longer') })],
    source,
    dest
  );
  let updated = false;
  const result = await relocatePlannedFile(plan.moves[0], {
    copyFile: async (fromPath, toPath) => {
      await fs.promises.writeFile(toPath, 'x');
    },
    updateFilePath: () => {
      updated = true;
    }
  });
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(updated, false);
  assert.strictEqual(fs.readFileSync(from, 'utf8'), 'mesh-bytes-longer');
  assert.strictEqual(fs.existsSync(plan.moves[0].to), false);
  const leftovers = fs.readdirSync(path.join(dest, 'Articulated Dragon'));
  assert.deepStrictEqual(leftovers, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a source that has not been scanned', () => {
  const dirs = layout();
  const file = path.join(dirs.source, 'head.stl');
  const plan = planOrganize(
    [model(file)],
    dirs.source,
    dirs.dest,
    { allowedRoots: [path.join(dirs.root, 'other-scan')] }
  );
  assert.strictEqual(plan.ok, false);
  assert.match(plan.error, /scanned/);
  assert.strictEqual(plan.moves.length, 0);
});

test('allows a source that matches a scanned directory', () => {
  const dirs = layout();
  const file = path.join(dirs.source, 'head.stl');
  const plan = planOrganize(
    [model(file)],
    dirs.source,
    dirs.dest,
    { allowedRoots: [dirs.source] }
  );
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.copyCount, 1);
});

test('allows a folder inside a scanned directory', () => {
  const dirs = layout();
  const nested = path.join(dirs.source, 'thingiverse');
  const file = path.join(nested, 'head.stl');
  const plan = planOrganize(
    [model(file)],
    nested,
    dirs.dest,
    { allowedRoots: [dirs.source] }
  );
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.copyCount, 1);
});

test('removes a verified copy when the library update fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-library-db-'));
  const source = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(source);
  fs.mkdirSync(dest);
  const from = path.join(source, 'head.stl');
  fs.writeFileSync(from, 'mesh-bytes');
  const plan = planOrganize([model(from, { size: 10 })], source, dest);
  const result = await relocatePlannedFile(plan.moves[0], {
    updateFilePath: () => {
      throw new Error('db down');
    }
  });
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(fs.existsSync(from), true);
  assert.strictEqual(fs.existsSync(plan.moves[0].to), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('listChildDirectories returns sorted folders and a parent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-list-'));
  fs.mkdirSync(path.join(root, 'beta'));
  fs.mkdirSync(path.join(root, 'Alpha'));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  const listed = listChildDirectories(root);
  assert.strictEqual(listed.ok, true);
  assert.strictEqual(listed.path, root);
  assert.strictEqual(listed.parent, path.dirname(root));
  assert.deepStrictEqual(listed.dirs.map((dir) => dir.name), ['Alpha', 'beta']);
  assert.strictEqual(listed.truncated, false);
  const missing = listChildDirectories(path.join(root, 'missing'));
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(listChildDirectories('').ok, false);
  const top = listChildDirectories(path.parse(root).root);
  assert.strictEqual(top.ok, true);
  assert.strictEqual(top.parent, null);
  fs.rmSync(root, { recursive: true, force: true });
});

(async () => {
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`ok ${entry.name}`);
    } catch (err) {
      console.error(`FAIL ${entry.name}:`, err && err.stack ? err.stack : err);
      process.exitCode = 1;
    }
  }
})();
