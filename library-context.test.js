#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  folderNamesFromPath,
  folderTagsFromPath,
  libraryContextSnippet
} = require('./library-context');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('folder context uses parent folders and not the filename', () => {
  const file = 'D:/library/Kitchen/Bagel Slicer/obj_1_Lid+8mm.3mf';
  assert.deepStrictEqual(folderNamesFromPath(file, 2), ['Kitchen', 'Bagel Slicer']);
  assert.deepStrictEqual(folderNamesFromPath(file, 0), []);
  assert.deepStrictEqual(folderTagsFromPath(file, 2), ['Kitchen', 'Bagel Slicer']);
  const snippet = libraryContextSnippet(file, {
    folderLevels: 2,
    notes: 'A container that reuses Bambu cardboard spool cores.'
  });
  assert.ok(snippet.includes('Kitchen / Bagel Slicer'));
  assert.ok(snippet.includes('cardboard spool cores'));
  assert.ok(!snippet.includes('obj_1_Lid'));
});

test('notes are collapsed and truncated', () => {
  const snippet = libraryContextSnippet('C:/models/part.stl', {
    folderLevels: 1,
    notes: 'line one\n\n' + 'x'.repeat(800)
  });
  assert.ok(snippet.includes('line one'));
  assert.ok(!snippet.includes('\n'));
  assert.ok(snippet.endsWith('...". Use it when it names the model\'s purpose or subject. ') || snippet.includes('...'));
  assert.ok(snippet.length < 900);
});

test('zip entries use the archive folders', () => {
  const names = folderNamesFromPath('C:/library/Tools/pack.zip::3D/inside/part.stl', 2);
  assert.deepStrictEqual(names, ['library', 'Tools']);
});
