/**
 * Spoolman REST client (main process).
 * Pull-only: health check + paginated filament catalog.
 */

const DEFAULT_PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15000;

function normalizeBaseUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) {
    throw new Error('Spoolman URL is required');
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/api\/v1$/i, '');
  return url;
}

function apiRoot(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/api/v1`;
}

function buildHeaders(apiToken) {
  const headers = { Accept: 'application/json' };
  const token = String(apiToken || '').trim();
  if (token) {
    headers['X-API-Key'] = token;
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function normalizeColorHex(hex) {
  if (!hex) return '';
  let h = String(hex).replace(/^#/, '').trim();
  if (!h) return '';
  if (h.includes(',')) {
    h = h.split(',')[0].trim();
  }
  if (h.length === 3 || h.length === 4) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (h.length === 8) {
    h = h.slice(0, 6);
  }
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : '';
}

function formatFilamentLabel(filament) {
  const vendor = String(filament?.vendor || '').trim();
  const name = String(filament?.name || '').trim();
  const material = String(filament?.material || '').trim();
  const base = [vendor, name].filter(Boolean).join(' ') || 'Unnamed filament';
  return material ? `${base} (${material})` : base;
}

function mapSpoolmanFilament(row) {
  const vendorName = row?.vendor && typeof row.vendor === 'object'
    ? row.vendor.name
    : (row?.vendor || '');
  const color = normalizeColorHex(row?.color_hex) || normalizeColorHex(row?.multi_color_hexes);
  const diameter = row?.diameter == null || row.diameter === '' ? null : Number(row.diameter);
  return {
    spoolman_id: Number(row.id),
    name: String(row?.name || '').trim() || `Filament ${row.id}`,
    vendor: String(vendorName || '').trim() || null,
    material: String(row?.material || '').trim() || null,
    color_hex: color || null,
    diameter: Number.isFinite(diameter) ? diameter : null,
    source: 'spoolman'
  };
}

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Spoolman request failed (${response.status}): ${body.slice(0, 200) || response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Spoolman request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function testConnection(baseUrl, apiToken) {
  const root = apiRoot(baseUrl);
  const headers = buildHeaders(apiToken);
  const health = await fetchJson(`${root}/health`, headers);
  let info = null;
  try {
    info = await fetchJson(`${root}/info`, headers);
  } catch (_) {
    info = null;
  }
  return {
    ok: true,
    status: health?.status || 'healthy',
    version: info?.version || null
  };
}

async function fetchAllFilaments(baseUrl, apiToken, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const root = apiRoot(baseUrl);
  const headers = buildHeaders(apiToken);
  const limit = Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE);
  const mapped = [];
  let offset = 0;

  while (true) {
    const url = `${root}/filament?limit=${limit}&offset=${offset}`;
    const page = await fetchJson(url, headers);
    if (!Array.isArray(page)) {
      throw new Error('Spoolman returned an unexpected filament response');
    }
    for (const row of page) {
      if (row && row.archived) continue;
      mapped.push(mapSpoolmanFilament(row));
    }
    if (page.length < limit) break;
    offset += limit;
    if (offset > 100000) break;
  }

  return mapped;
}

module.exports = {
  normalizeBaseUrl,
  apiRoot,
  buildHeaders,
  normalizeColorHex,
  formatFilamentLabel,
  mapSpoolmanFilament,
  testConnection,
  fetchAllFilaments
};
