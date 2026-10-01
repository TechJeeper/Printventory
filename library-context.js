'use strict';

const NOTES_CONTEXT_MAX = 600;
const DEFAULT_FOLDER_LEVELS = 2;
const MAX_FOLDER_LEVELS = 6;

const GENERIC_FOLDER_NAMES = new Set([
  'stl', '3mf', 'obj', 'ply', 'step', 'stp', 'files', 'file', 'models', 'model',
  'library', 'prints', 'print', '3d', '3dmodels', 'downloads', 'download',
  'documents', 'desktop', 'users', 'mnt', 'media', 'volume', 'volumes'
]);

function clampFolderLevels(value, fallback = DEFAULT_FOLDER_LEVELS) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_FOLDER_LEVELS, n));
}

function tidyFolderName(name) {
  return String(name || '')
    .replace(/[+_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parent folder names above a model file, outermost to closest.
 * levels 0 returns none. Zip paths use the archive location, not the entry inside it.
 */
function folderNamesFromPath(filePath, levels) {
  const n = clampFolderLevels(levels, 0);
  if (!n || !filePath) return [];
  let raw = String(filePath);
  const zipIdx = raw.indexOf('::');
  if (zipIdx !== -1) raw = raw.slice(0, zipIdx);
  const parts = raw.split(/[/\\]/).filter(Boolean);
  if (parts.length) parts.pop();
  const folders = [];
  for (const part of parts) {
    if (/^[a-zA-Z]:$/.test(part)) continue;
    if (part === '.' || part === '..' || part.startsWith('.')) continue;
    folders.push(part);
  }
  return folders.slice(-n);
}

function folderTagsFromPath(filePath, levels) {
  const seen = new Set();
  const tags = [];
  for (const raw of folderNamesFromPath(filePath, levels)) {
    const name = tidyFolderName(raw);
    if (name.length < 2 || name.length > 50) continue;
    if (/^\d+$/.test(name)) continue;
    if (GENERIC_FOLDER_NAMES.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(name);
  }
  return tags;
}

function notesContextSnippet(notes) {
  if (notes == null) return '';
  let text = String(notes).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length > NOTES_CONTEXT_MAX) {
    text = text.slice(0, NOTES_CONTEXT_MAX).trimEnd() + '...';
  }
  return `The designer's description is: "${text}". Use it when it names the model's purpose or subject. `;
}

function libraryContextSnippet(filePath, options = {}) {
  const levels = options.folderLevels == null ? DEFAULT_FOLDER_LEVELS : options.folderLevels;
  const parts = [];
  const folders = folderNamesFromPath(filePath, levels);
  if (folders.length) {
    parts.push(
      `Parent folders, from outermost to closest, are: ${folders.join(' / ')}. ` +
      `Use a folder name as a tag when it names the category or subject. `
    );
  }
  const notes = notesContextSnippet(options.notes);
  if (notes) parts.push(notes);
  return parts.join('');
}

module.exports = {
  NOTES_CONTEXT_MAX,
  DEFAULT_FOLDER_LEVELS,
  MAX_FOLDER_LEVELS,
  clampFolderLevels,
  folderNamesFromPath,
  folderTagsFromPath,
  notesContextSnippet,
  libraryContextSnippet
};
