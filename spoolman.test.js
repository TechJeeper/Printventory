#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  normalizeBaseUrl,
  apiRoot,
  formatFilamentLabel,
  mapSpoolmanFilament,
  normalizeColorHex
} = require('./spoolman');

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test('normalizes URL with or without /api/v1', () => {
  assert.strictEqual(normalizeBaseUrl('http://localhost:7912/'), 'http://localhost:7912');
  assert.strictEqual(normalizeBaseUrl('http://localhost:7912/api/v1'), 'http://localhost:7912');
  assert.strictEqual(apiRoot('localhost:7912'), 'http://localhost:7912/api/v1');
});

test('maps Spoolman filament rows', () => {
  const mapped = mapSpoolmanFilament({
    id: 7,
    name: 'PolyTerra Charcoal Black',
    vendor: { id: 1, name: 'Polymaker' },
    material: 'PLA',
    color_hex: 'FF0000',
    diameter: 1.75
  });
  assert.strictEqual(mapped.spoolman_id, 7);
  assert.strictEqual(mapped.vendor, 'Polymaker');
  assert.strictEqual(mapped.color_hex, 'FF0000');
  assert.strictEqual(mapped.source, 'spoolman');
  assert.strictEqual(formatFilamentLabel(mapped), 'Polymaker PolyTerra Charcoal Black (PLA)');
});

test('normalizes multi-color hex to first color', () => {
  assert.strictEqual(normalizeColorHex('FF0000,00FF00'), 'FF0000');
  assert.strictEqual(normalizeColorHex('#abc'), 'AABBCC');
});
