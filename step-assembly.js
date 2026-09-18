'use strict';

/**
 * STEP assemblies (especially CATIA AP214) often contain no solids — only
 * DOCUMENT_FILE / external identification pointing at sibling .stp parts.
 */

const STEP_EXT_RE = /\.(?:step|stp)$/i;
const EXTERNAL_FILE_RE = /(?:DOCUMENT_FILE|APPLIED_EXTERNAL_IDENTIFICATION_ASSIGNMENT)\s*\(\s*'([^']+)'/gi;

function decodeStepText(data) {
  if (typeof data === 'string') return data;
  if (!data) return '';
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return new TextDecoder('latin1').decode(bytes);
}

function listStepExternalFileNames(data) {
  const text = decodeStepText(data);
  const names = [];
  const seen = new Set();
  EXTERNAL_FILE_RE.lastIndex = 0;
  let match;
  while ((match = EXTERNAL_FILE_RE.exec(text))) {
    const raw = String(match[1] || '').trim();
    if (!raw || !STEP_EXT_RE.test(raw)) continue;
    const base = raw.replace(/\\/g, '/').split('/').pop();
    const key = base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(base);
  }
  return names;
}

function siblingStepPath(filePath, fileName) {
  const safeName = String(fileName || '').replace(/\\/g, '/').split('/').pop();
  if (!filePath || !safeName) return null;
  if (filePath.includes('::')) {
    const idx = filePath.indexOf('::');
    const zip = filePath.slice(0, idx);
    const entry = filePath.slice(idx + 2);
    const slash = Math.max(entry.lastIndexOf('/'), entry.lastIndexOf('\\'));
    const dir = slash >= 0 ? entry.slice(0, slash + 1) : '';
    return `${zip}::${dir}${safeName}`;
  }
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (slash < 0) return safeName;
  return filePath.slice(0, slash + 1) + safeName;
}

const api = { listStepExternalFileNames, siblingStepPath };
if (typeof module === 'object' && module.exports) {
  module.exports = api;
}
if (typeof self !== 'undefined') {
  self.StepAssembly = api;
}
