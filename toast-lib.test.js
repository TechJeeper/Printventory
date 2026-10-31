#!/usr/bin/env node
'use strict';

const assert = require('assert');
const lib = require('./shortcuts-lib');
const inbox = require('./inbox-upload-lib');

function test(name, fn) {
  try {
    fn();
    console.log('ok ' + name);
  } catch (err) {
    console.error('FAIL ' + name + ':', err.message);
    process.exitCode = 1;
  }
}

test('parseKeybindings accepts object JSON', () => {
  const parsed = lib.parseKeybindings('{"focus-search":"Mod+F"}');
  assert.strictEqual(parsed['focus-search'], 'Mod+F');
  assert.deepStrictEqual(lib.parseKeybindings('not-json'), {});
  assert.deepStrictEqual(lib.parseKeybindings('[]'), {});
});

test('inbox normalize strips traversal', () => {
  assert.strictEqual(inbox.normalizeInboxFolderName('../evil'), 'evil');
});

console.log(process.exitCode ? 'ux helper tests failed' : 'ux helper tests passed');
