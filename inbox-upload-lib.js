'use strict';

/**
 * Pure helpers for upload/drop-in inbox paths (Feature 18).
 * Shared by main process and unit tests.
 */

function normalizeInboxFolderName(name) {
  const raw = name == null ? '' : String(name).trim();
  const cleaned = raw
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/[/\\]+/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || 'Inbox';
}

function resolveInboxPath(stlHomeDir, inboxFolderName) {
  if (!stlHomeDir) return null;
  const path = require('path');
  return path.join(String(stlHomeDir), normalizeInboxFolderName(inboxFolderName));
}

function isAllowedUploadName(fileName) {
  const base = String(fileName || '').split(/[/\\]/).pop() || '';
  if (!base || base === '.' || base === '..') return false;
  return /\.(stl|3mf|obj|ply|step|stp|zip|gcode|bgcode)$/i.test(base);
}

function safeUploadBaseName(fileName) {
  const base = String(fileName || 'model.stl').split(/[/\\]/).pop() || 'model.stl';
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'model.stl';
}

module.exports = {
  normalizeInboxFolderName,
  resolveInboxPath,
  isAllowedUploadName,
  safeUploadBaseName
};
