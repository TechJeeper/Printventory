'use strict';

/**
 * Build a folder-only forest from catalogued model paths (no disk walk).
 * Roots are STL Home / last scan dir plus inferred clusters for everything else.
 */

function normalizeDir(input) {
  if (!input || typeof input !== 'string') return '';
  let p = input.replace(/\\/g, '/').trim();
  if (!p) return '';
  if (p.startsWith('url::') || /^https?:\/\//i.test(p)) return '';
  if (p.startsWith('//')) {
    p = '//' + p.slice(2).replace(/\/+$/, '');
  } else {
    p = p.replace(/\/+$/, '');
  }
  return p;
}

function isUrlModelPath(filePath) {
  return typeof filePath === 'string' && (filePath.startsWith('url::') || /^https?:\/\//i.test(filePath));
}

function basename(normalized) {
  if (!normalized) return '';
  if (normalized.startsWith('//')) {
    const parts = normalized.slice(2).split('/').filter(Boolean);
    return parts[parts.length - 1] || normalized;
  }
  const i = normalized.lastIndexOf('/');
  if (i === -1) return normalized;
  return normalized.slice(i + 1) || normalized;
}

function dirnameNorm(normalized) {
  const n = normalizeDir(normalized);
  if (!n) return '';
  if (n.startsWith('//')) {
    const parts = n.slice(2).split('/').filter(Boolean);
    if (parts.length <= 2) return n;
    return '//' + parts.slice(0, -1).join('/');
  }
  const i = n.lastIndexOf('/');
  if (i <= 0) return n.startsWith('/') ? '/' : n;
  if (/^[a-zA-Z]:$/.test(n.slice(0, 2)) && i === 2) return n.slice(0, 2);
  return n.slice(0, i);
}

function dirAncestors(dir) {
  const out = [];
  let cur = normalizeDir(dir);
  while (cur) {
    out.unshift(cur);
    const parent = dirnameNorm(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return out;
}

function pathIsUnder(child, parent) {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  if (!c || !p) return false;
  if (c === p) return true;
  const cl = c.toLowerCase();
  const pl = p.toLowerCase();
  return cl.startsWith(pl + '/') || cl.startsWith(pl + '::');
}

function matchLongestRoot(path, roots) {
  let best = '';
  for (const root of roots) {
    if (!root) continue;
    if (pathIsUnder(path, root) && root.length >= best.length) best = root;
  }
  return best;
}

function isDriveOnly(path) {
  const n = normalizeDir(path);
  if (!n) return true;
  if (/^[a-zA-Z]:$/.test(n)) return true;
  if (n === '/') return true;
  if (n.startsWith('//')) {
    const parts = n.slice(2).split('/').filter(Boolean);
    return parts.length <= 1;
  }
  return false;
}

function groupKey(dir) {
  const n = normalizeDir(dir);
  if (n.startsWith('//')) {
    const parts = n.slice(2).split('/').filter(Boolean);
    return '//' + parts.slice(0, 2).join('/');
  }
  if (/^[a-zA-Z]:/.test(n)) return n.slice(0, 2).toUpperCase();
  if (n.startsWith('/')) return '/';
  return n.split('/')[0] || n;
}

function longestCommonDirPrefix(dirs) {
  if (!dirs.length) return '';
  const split = dirs.map((d) => {
    const n = normalizeDir(d);
    if (n.startsWith('//')) return ['//', ...n.slice(2).split('/').filter(Boolean)];
    if (n.startsWith('/')) return ['', ...n.split('/').filter(Boolean)];
    return n.split('/').filter(Boolean);
  });
  let i = 0;
  while (split.every((s) => s[i] != null && String(s[i]).toLowerCase() === String(split[0][i]).toLowerCase())) {
    i += 1;
  }
  if (i === 0) return '';
  const parts = split[0].slice(0, i);
  if (parts[0] === '//') return '//' + parts.slice(1).join('/');
  if (parts[0] === '') return '/' + parts.slice(1).join('/');
  return parts.join('/');
}

function firstFolderUnderGroup(dir, key) {
  const n = normalizeDir(dir);
  if (n.startsWith('//')) {
    const parts = n.slice(2).split('/').filter(Boolean);
    if (parts.length <= 2) return n;
    return '//' + parts.slice(0, 3).join('/');
  }
  if (/^[a-zA-Z]:/.test(n)) {
    const rest = n.slice(2).replace(/^\//, '');
    const first = rest.split('/')[0];
    return first ? `${n.slice(0, 2)}/${first}` : n.slice(0, 2);
  }
  if (key === '/' && n.startsWith('/')) {
    const parts = n.split('/').filter(Boolean);
    return parts.length ? '/' + parts[0] : '/';
  }
  return n;
}

function inferOrphanRoots(orphanDirs) {
  const groups = new Map();
  for (const dir of orphanDirs) {
    const key = groupKey(dir);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(dir);
  }
  const inferred = [];
  for (const [key, dirs] of groups) {
    const lcp = longestCommonDirPrefix(dirs);
    if (lcp && !isDriveOnly(lcp)) {
      inferred.push(lcp);
    } else {
      const next = new Set();
      for (const d of dirs) next.add(firstFolderUnderGroup(d, key));
      inferred.push(...next);
    }
  }
  return inferred.map(normalizeDir).filter(Boolean);
}

function ancestorChain(filePath) {
  if (!filePath || isUrlModelPath(filePath)) return [];
  const normalized = filePath.replace(/\\/g, '/');
  let zipPath = null;
  let entryPath = null;
  const zipSep = normalized.indexOf('::');
  if (zipSep !== -1) {
    zipPath = normalizeDir(normalized.slice(0, zipSep));
    entryPath = normalized.slice(zipSep + 2).replace(/\\/g, '/').replace(/\/+$/, '');
  }
  const diskFile = zipPath || normalized;
  const diskDir = zipPath ? dirnameNorm(zipPath) : dirnameNorm(diskFile);
  const chain = dirAncestors(diskDir).map((p) => ({
    path: p,
    label: basename(p),
    isBundle: false
  }));
  if (zipPath) {
    chain.push({ path: zipPath, label: basename(zipPath), isBundle: true });
    if (entryPath) {
      const entryDir = entryPath.replace(/\/[^/]+$/, '');
      if (entryDir && entryDir !== entryPath) {
        const parts = entryDir.split('/').filter(Boolean);
        let acc = '';
        for (const part of parts) {
          acc = acc ? `${acc}/${part}` : part;
          chain.push({
            path: `${zipPath}::${acc}`,
            label: part,
            isBundle: false
          });
        }
      }
    }
  }
  return chain;
}

function toDirectoryFilter(path, isBundle) {
  const n = path || '';
  if (isBundle && n && !n.includes('::')) return `${n}::`;
  return n;
}

function labelForRoot(path, stlHome) {
  const n = normalizeDir(path);
  const home = normalizeDir(stlHome);
  if (home && n.toLowerCase() === home.toLowerCase()) return 'STL Home';
  return basename(n) || n;
}

function serializeNode(node) {
  const children = (node.children || [])
    .slice()
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }))
    .map(serializeNode);
  return {
    path: node.path,
    label: node.label,
    tooltip: node.tooltip,
    count: node.count,
    isBundle: !!node.isBundle,
    children
  };
}

/**
 * @param {string[]} filePaths
 * @param {{ stlHome?: string, roots?: string[] }} [options]
 * @returns {{ roots: object[] }}
 */
function buildFolderForest(filePaths, options = {}) {
  const stlHome = normalizeDir(options.stlHome);
  const knownRoots = [];
  const seenRoot = new Set();
  const addRoot = (value) => {
    const n = normalizeDir(value);
    if (!n) return;
    const key = n.toLowerCase();
    if (seenRoot.has(key)) return;
    seenRoot.add(key);
    knownRoots.push(n);
  };
  addRoot(stlHome);
  for (const r of options.roots || []) addRoot(r);

  const nodes = new Map();
  const nodeKey = (p) => normalizeDir(p).toLowerCase();
  const getNode = (path) => nodes.get(nodeKey(path));
  const orphanDirs = [];

  const list = Array.isArray(filePaths) ? filePaths : [];
  for (const filePath of list) {
    const chain = ancestorChain(filePath);
    if (!chain.length) continue;

    let diskAnchor = '';
    for (const item of chain) {
      if (!item.path.includes('::')) diskAnchor = item.isBundle ? dirnameNorm(item.path) : item.path;
    }
    const matched = matchLongestRoot(diskAnchor, knownRoots);
    if (!matched && diskAnchor) orphanDirs.push(diskAnchor);

    for (const item of chain) {
      let node = getNode(item.path);
      if (!node) {
        node = {
          path: item.path,
          label: item.label,
          tooltip: item.path,
          count: 0,
          isBundle: item.isBundle,
          children: [],
          childSet: new Set()
        };
        nodes.set(nodeKey(item.path), node);
      }
      node.count += 1;
    }
    for (let i = 1; i < chain.length; i++) {
      const parent = getNode(chain[i - 1].path);
      const child = getNode(chain[i].path);
      if (parent && child && !parent.childSet.has(nodeKey(child.path))) {
        parent.childSet.add(nodeKey(child.path));
        parent.children.push(child);
      }
    }
  }

  if (orphanDirs.length) {
    for (const inferred of inferOrphanRoots(orphanDirs)) addRoot(inferred);
  }

  const forest = [];
  const used = new Set();
  for (const rootPath of knownRoots) {
    const node = getNode(rootPath);
    if (!node || node.count < 1) continue;
    node.path = rootPath;
    node.label = labelForRoot(rootPath, stlHome);
    node.tooltip = rootPath;
    forest.push(node);
    used.add(nodeKey(rootPath));
  }

  for (const node of nodes.values()) {
    if (used.has(nodeKey(node.path))) continue;
    if (knownRoots.some((root) => pathIsUnder(root, node.path) && nodeKey(root) !== nodeKey(node.path))) continue;
    if (matchLongestRoot(node.path.split('::')[0], knownRoots)) continue;
    if (node.count < 1) continue;
    forest.push(node);
    used.add(nodeKey(node.path));
  }

  forest.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }));
  return { roots: forest.map(serializeNode) };
}

module.exports = {
  normalizeDir,
  dirnameNorm,
  pathIsUnder,
  ancestorChain,
  toDirectoryFilter,
  buildFolderForest,
  labelForRoot
};
