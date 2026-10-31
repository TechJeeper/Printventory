'use strict';

/**
 * In-memory undo stack for reversible tag/metadata ops (toast undo).
 */

function createUndoStack({ max = 50 } = {}) {
  const stack = [];

  function recordUndo(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const undoFn = entry.undo || entry.apply;
    if (typeof undoFn !== 'function' && entry.data == null) return false;
    const item = {
      id: `${Date.now()}-${stack.length}`,
      label: entry.label != null ? String(entry.label) : 'Edit',
      createdAt: new Date().toISOString(),
      undo: typeof undoFn === 'function' ? undoFn : null,
      data: entry.data != null ? entry.data : null
    };
    stack.push(item);
    while (stack.length > max) stack.shift();
    return item.id;
  }

  function peekUndo() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  function popUndo() {
    return stack.length ? stack.pop() : null;
  }

  async function applyLast() {
    const item = popUndo();
    if (!item) return { ok: false, reason: 'empty', empty: true };
    if (typeof item.undo === 'function') {
      const result = await item.undo(item.data);
      return { ok: true, id: item.id, label: item.label, result };
    }
    return { ok: true, id: item.id, label: item.label, data: item.data };
  }

  function clear() {
    stack.length = 0;
  }

  function size() {
    return stack.length;
  }

  return {
    recordUndo,
    record: recordUndo,
    peekUndo,
    peek: peekUndo,
    popUndo,
    pop: popUndo,
    applyLast,
    undoLast: applyLast,
    clear,
    size
  };
}

const globalStack = createUndoStack();

module.exports = {
  createUndoStack,
  recordUndo: (...args) => globalStack.recordUndo(...args),
  peekUndo: (...args) => globalStack.peekUndo(...args),
  popUndo: (...args) => globalStack.popUndo(...args),
  applyLast: (...args) => globalStack.applyLast(...args),
  clear: (...args) => globalStack.clear(...args),
  size: (...args) => globalStack.size(...args)
};
