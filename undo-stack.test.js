#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { createUndoStack } = require('./undo-stack');

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log(`ok ${name}`),
        (err) => {
          console.error(`FAIL ${name}:`, err.message);
          process.exitCode = 1;
        }
      );
    }
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

(async () => {
  await test('recordUndo / applyLast reverses last edit', async () => {
    const stack = createUndoStack();
    let value = 'a';
    stack.recordUndo({
      label: 'tag',
      undo: () => { value = 'b'; }
    });
    assert.strictEqual(stack.size(), 1);
    const result = await stack.applyLast();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(value, 'b');
    assert.strictEqual(stack.size(), 0);
  });
})();
