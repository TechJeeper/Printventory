'use strict';

/**
 * LAN discovery and live status for onboarded printers.
 * Klipper is identified through Moonraker (port 7125, or a Mainsail/Fluidd proxy).
 * Prusa Buddy printers are identified through PrusaLink on port 80.
 * Bambu Lab printers are identified through SSDP and the LAN MQTT certificate,
 * then read with the printer access code.
 */

const crypto = require('crypto');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const tls = require('tls');

const SSDP_ADDRESS = '239.255.255.250';
const BAMBU_MQTT_PORT = 8883;
const MOONRAKER_PORT = 7125;

const BAMBU_MODEL_NAMES = {
  N1: 'A1 mini',
  N2S: 'A1',
  C11: 'P1P',
  C12: 'P1S',
  C13: 'X1E',
  'BL-P001': 'X1 Carbon',
  'BL-P002': 'X1',
  O1D: 'H2D',
  O1S: 'H2S',
  O1C: 'P2S',
  '3DPrinter-X1-Carbon': 'X1 Carbon',
  '3DPrinter-X1': 'X1',
  '3DPrinter-P1P': 'P1P',
  '3DPrinter-P1S': 'P1S'
};

function normalizePrinterHost(value) {
  if (value == null) return null;
  let host = String(value).trim();
  if (!host) return null;
  host = host.replace(/^https?:\/\//i, '').split('/')[0].trim();
  host = host.replace(/:\d+$/, '');
  return host || null;
}

function bambuModelLabel(code) {
  const key = String(code || '').trim();
  if (!key) return '';
  if (BAMBU_MODEL_NAMES[key]) return BAMBU_MODEL_NAMES[key];
  const stripped = key.replace(/^3DPrinter-/i, '').replace(/-/g, ' ').trim();
  return stripped || key;
}

function parseSsdpPayload(text) {
  const raw = String(text || '');
  if (!/bambulab|devmodel\.bambu\.com|3dprinter/i.test(raw)) return null;
  const headers = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  const devModel = headers['devmodel.bambu.com'] || '';
  const devName = headers['devname.bambu.com'] || '';
  const usn = String(headers.usn || '').split('::')[0].replace(/^uuid:/i, '').trim();
  let location = headers.location || '';
  location = location.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].trim();
  if (!devModel && !devName && !/bambulab/i.test(raw)) return null;
  return {
    devModel,
    devName,
    serial: usn,
    host: location
  };
}

function isBambuCertificate(cert) {
  if (!cert || typeof cert !== 'object') return null;
  const cn = String(cert.subject?.CN || '').trim();
  const issuerCn = String(cert.issuer?.CN || '');
  const issuerBlob = `${issuerCn} ${JSON.stringify(cert.issuer || {})}`;
  if (!/bbl|bambu/i.test(issuerBlob)) return null;
  const serial = /^[0-9A-Za-z]{12,20}$/.test(cn) ? cn : '';
  return { serial };
}

function mapBambuGcodeState(raw) {
  const state = String(raw || '').trim().toUpperCase();
  switch (state) {
    case 'RUNNING':
      return { state: 'printing', label: 'Printing' };
    case 'PREPARE':
    case 'SLICING':
    case 'INIT':
      return { state: 'printing', label: 'Preparing' };
    case 'PAUSE':
      return { state: 'paused', label: 'Paused' };
    case 'FINISH':
      return { state: 'complete', label: 'Complete' };
    case 'FAILED':
      return { state: 'error', label: 'Error' };
    case 'OFFLINE':
      return { state: 'offline', label: 'Offline' };
    case 'IDLE':
      return { state: 'online', label: 'Online' };
    default:
      return state
        ? { state: 'online', label: 'Online' }
        : { state: 'offline', label: 'Offline' };
  }
}

function mapKlipperState(printState, klippyState) {
  const printing = String(printState || '').trim().toLowerCase();
  if (printing === 'printing') return { state: 'printing', label: 'Printing' };
  if (printing === 'paused') return { state: 'paused', label: 'Paused' };
  if (printing === 'complete') return { state: 'complete', label: 'Complete' };
  if (printing === 'error') return { state: 'error', label: 'Error' };
  if (printing === 'standby' || printing === 'cancelled') return { state: 'online', label: 'Online' };

  const klippy = String(klippyState || '').trim().toLowerCase();
  if (klippy === 'ready') return { state: 'online', label: 'Online' };
  if (klippy === 'startup') return { state: 'printing', label: 'Starting' };
  if (klippy === 'shutdown' || klippy === 'disconnected') return { state: 'offline', label: 'Offline' };
  if (klippy === 'error') return { state: 'error', label: 'Error' };
  if (printing || klippy) return { state: 'online', label: 'Online' };
  return { state: 'offline', label: 'Offline' };
}

function isMoonrakerInfo(json) {
  const result = json && json.result;
  if (!result || typeof result !== 'object') return false;
  return result.moonraker_version != null || result.klippy_state != null || result.api_version != null;
}

function extractKlipperStatus(json) {
  const status = json?.result?.status;
  if (!status || typeof status !== 'object') return null;
  const printState = status.print_stats?.state || '';
  const klippyState = status.webhooks?.state || '';
  if (!printState && !klippyState) return null;
  const mapped = mapKlipperState(printState, klippyState);
  const filename = String(status.print_stats?.filename || '').trim();
  if (filename && (mapped.state === 'printing' || mapped.state === 'paused')) {
    mapped.detail = filename;
  }
  return mapped;
}

function liveStatusKind(printer) {
  const firmware = String(printer?.firmware_type || printer?.firmwareType || '').trim().toLowerCase();
  const webUrl = String(printer?.web_url || printer?.webUrl || '').trim();
  const host = String(printer?.host || '').trim();
  if (firmware === 'klipper' || printer?.is_klipper || printer?.isKlipper) {
    if (webUrl || host) return 'klipper';
  }
  if (firmware === 'bambu os') {
    const serial = String(printer?.bambu_serial || printer?.bambuSerial || '').trim();
    const code = String(printer?.bambu_access_code || printer?.bambuAccessCode || '').trim();
    if (host && serial && code) return 'bambu';
  }
  if (firmware === 'prusa buddy' && (webUrl || host)) return 'prusa';
  return null;
}

function mapPrusaState(raw) {
  const state = String(raw || '').trim().toUpperCase();
  switch (state) {
    case 'PRINTING':
      return { state: 'printing', label: 'Printing' };
    case 'BUSY':
      return { state: 'printing', label: 'Preparing' };
    case 'PAUSED':
      return { state: 'paused', label: 'Paused' };
    case 'FINISHED':
      return { state: 'complete', label: 'Complete' };
    case 'ERROR':
    case 'ATTENTION':
      return { state: 'error', label: 'Error' };
    case 'IDLE':
    case 'READY':
    case 'STOPPED':
      return { state: 'online', label: 'Online' };
    default:
      return state
        ? { state: 'online', label: 'Online' }
        : { state: 'offline', label: 'Offline' };
  }
}

function looksLikePrusa(response) {
  const json = response?.json;
  const fromBody = `${json?.text || ''} ${json?.hostname || ''} ${json?.server || ''} ${json?.firmware || ''}`.toLowerCase();
  if (fromBody.includes('prusa')) return true;
  const headerBlob = `${response?.headers?.server || ''} ${response?.headers?.['www-authenticate'] || ''}`.toLowerCase();
  return headerBlob.includes('prusa');
}

function prusaDisplayName(json) {
  const hostname = String(json?.hostname || '').trim();
  const text = String(json?.text || '').trim();
  if (hostname && !/^prusalink$/i.test(hostname)) return hostname;
  if (text && !/^prusalink$/i.test(text)) return text;
  return '';
}

function prusaModelName(json) {
  const text = String(json?.text || '').trim();
  if (/prusa/i.test(text) && !/^prusalink$/i.test(text)) return text;
  return '';
}

function extractPrusaStatus(json) {
  const printerState = json?.printer?.state || json?.state;
  if (!printerState) return null;
  const mapped = mapPrusaState(printerState);
  const file = String(json?.job?.file?.display_name || json?.job?.file?.name || '').trim();
  if (file && (mapped.state === 'printing' || mapped.state === 'paused')) mapped.detail = file;
  return mapped;
}

function parseDigestChallenge(header) {
  const fields = {};
  const pattern = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g;
  let match = pattern.exec(String(header || ''));
  while (match) {
    fields[match[1].toLowerCase()] = match[2] != null ? match[2] : match[3];
    match = pattern.exec(String(header || ''));
  }
  return fields;
}

function buildDigestAuthorization({ username, password, method, uri, challenge, nc, cnonce }) {
  const realm = challenge.realm || '';
  const nonce = challenge.nonce || '';
  const qop = String(challenge.qop || '').split(',')[0].trim();
  const opaque = challenge.opaque;
  const count = nc || '00000001';
  const clientNonce = cnonce || crypto.randomBytes(8).toString('hex');
  const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
  const response = qop
    ? crypto.createHash('md5').update(`${ha1}:${nonce}:${count}:${clientNonce}:${qop}:${ha2}`).digest('hex')
    : crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
  const parts = [
    `Digest username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${count}`, `cnonce="${clientNonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  return parts.join(', ');
}

function isVirtualInterface(name) {
  return /vethernet|wsl|hyper-v|virtualbox|vmware|docker|vbox|bluetooth|tunnel/i.test(String(name || ''));
}

function ipv4ToInt(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function intToIpv4(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join('.');
}

function prefixLength(netmask) {
  const mask = ipv4ToInt(netmask);
  if (mask == null) return null;
  const bits = mask.toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bits)) return null;
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
}

function hostsInSubnet(address, netmask) {
  const prefix = prefixLength(netmask);
  const ip = ipv4ToInt(address);
  // /22 is 1,022 hosts. Wider ranges, such as a /16 or a WSL /20, are too large to sweep.
  if (prefix == null || ip == null || prefix < 22 || prefix > 30) return [];
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ((~mask) >>> 0)) >>> 0;
  const hosts = [];
  for (let current = network + 1; current < broadcast; current += 1) {
    hosts.push(intToIpv4(current >>> 0));
  }
  return hosts;
}

const MAX_SCAN_HOSTS = 1022;

function parseOneScanRange(part) {
  const cidr = part.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})$/);
  if (cidr) {
    const address = cidr[1];
    const prefix = Number(cidr[2]);
    const ip = ipv4ToInt(address);
    if (ip == null) throw new Error(`Invalid address ${address}`);
    if (prefix === 32) {
      const host = intToIpv4(ip);
      return { label: `${host}/32`, hosts: [host] };
    }
    if (!Number.isInteger(prefix) || prefix < 22 || prefix > 30) {
      throw new Error('Use a /22 through /30, a single address, or a start-end range of at most 1,022 addresses.');
    }
    const mask = intToIpv4((0xffffffff << (32 - prefix)) >>> 0);
    return { label: networkCidr(address, mask), hosts: hostsInSubnet(address, mask) };
  }

  const span = part.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*[-–—]\s*(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (span) {
    const start = ipv4ToInt(span[1]);
    const end = ipv4ToInt(span[2]);
    if (start == null || end == null) throw new Error('Enter a valid IPv4 range');
    if (end < start) throw new Error('The range end address comes before the start');
    const count = (end - start) + 1;
    if (count > MAX_SCAN_HOSTS) {
      throw new Error(`That range has ${count} addresses. Use ${MAX_SCAN_HOSTS} or fewer.`);
    }
    const hosts = [];
    for (let current = start; current <= end; current += 1) hosts.push(intToIpv4(current));
    return { label: `${intToIpv4(start)}-${intToIpv4(end)}`, hosts };
  }

  throw new Error('Enter a start and end address like 192.168.68.1 and 192.168.71.254');
}

function parseScanRange(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const parts = raw.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  const hosts = [];
  const networks = [];
  const seen = new Set();
  for (const part of parts) {
    const piece = parseOneScanRange(part);
    if (piece.label) networks.push(piece.label);
    for (const host of piece.hosts) {
      if (seen.has(host)) continue;
      seen.add(host);
      hosts.push(host);
    }
  }
  if (hosts.length > MAX_SCAN_HOSTS) {
    throw new Error(`That range has ${hosts.length} addresses. Use ${MAX_SCAN_HOSTS} or fewer.`);
  }
  return { hosts, networks };
}

function networkCidr(address, netmask) {
  const prefix = prefixLength(netmask);
  const ip = ipv4ToInt(address);
  if (prefix == null || ip == null) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return `${intToIpv4((ip & mask) >>> 0)}/${prefix}`;
}

function listScanSubnets() {
  const hosts = [];
  const networks = [];
  const ownIps = new Set();
  const seenHosts = new Set();
  const nets = os.networkInterfaces();
  for (const [name, entries] of Object.entries(nets)) {
    if (isVirtualInterface(name)) continue;
    for (const entry of entries || []) {
      const family = entry.family;
      if (family !== 'IPv4' && family !== 4) continue;
      if (entry.internal) continue;
      const address = String(entry.address || '');
      if (!ipv4ToInt(address) || address.startsWith('169.254.')) continue;
      ownIps.add(address);
      const netmask = entry.netmask || '255.255.255.0';
      const range = hostsInSubnet(address, netmask);
      if (!range.length) continue;
      const cidr = networkCidr(address, netmask);
      if (cidr && !networks.includes(cidr)) networks.push(cidr);
      for (const host of range) {
        if (ownIps.has(host) || seenHosts.has(host)) continue;
        seenHosts.add(host);
        hosts.push(host);
      }
    }
  }
  return { hosts, networks, ownIps };
}

function bambuCandidateFromSsdp(parsed, fallbackHost) {
  const host = normalizePrinterHost(parsed.host || fallbackHost);
  const model = bambuModelLabel(parsed.devModel);
  const name = parsed.devName || model || (host ? `Bambu Lab @ ${host}` : 'Bambu Lab');
  return {
    kind: 'bambu',
    host: host || '',
    serial: parsed.serial || '',
    name,
    model,
    manufacturer: 'Bambu Lab',
    firmwareType: 'Bambu OS',
    printerType: 'FDM',
    discoveredVia: 'ssdp'
  };
}

function mergeDiscoveredPrinters(items) {
  const merged = [];
  const indexByKey = new Map();
  for (const item of items) {
    if (!item) continue;
    const keys = [];
    if (item.kind === 'bambu' && item.serial) keys.push(`b-serial:${item.serial}`);
    if (item.kind === 'bambu' && item.host) keys.push(`b-host:${item.host}`);
    if (item.kind === 'klipper' && item.host) keys.push(`k-host:${item.host}`);
    if (item.kind === 'prusa' && item.host) keys.push(`p-host:${item.host}`);
    const existingKey = keys.find((key) => indexByKey.has(key));
    if (existingKey) {
      const existing = merged[indexByKey.get(existingKey)];
      if (!existing.serial && item.serial) existing.serial = item.serial;
      if (!existing.host && item.host) existing.host = item.host;
      if (!existing.model && item.model) existing.model = item.model;
      if ((!existing.name || /^Bambu Lab @/.test(existing.name)) && item.name) existing.name = item.name;
      if (item.discoveredVia === 'ssdp') existing.discoveredVia = 'ssdp';
      for (const key of keys) indexByKey.set(key, indexByKey.get(existingKey));
      continue;
    }
    const index = merged.length;
    merged.push({ ...item });
    for (const key of keys) indexByKey.set(key, index);
  }
  return merged;
}

function encodeRemainingLength(length) {
  const bytes = [];
  let value = length;
  do {
    let encoded = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) encoded |= 0x80;
    bytes.push(encoded);
  } while (value > 0);
  return Buffer.from(bytes);
}

function mqttString(value) {
  const body = Buffer.from(String(value), 'utf8');
  const header = Buffer.alloc(2);
  header.writeUInt16BE(body.length, 0);
  return Buffer.concat([header, body]);
}

function buildMqttConnect(clientId, username, password) {
  const payload = Buffer.concat([
    mqttString(clientId),
    mqttString(username),
    mqttString(password)
  ]);
  const variable = Buffer.concat([
    mqttString('MQTT'),
    Buffer.from([0x04, 0xc2, 0x00, 0x3c])
  ]);
  const remaining = Buffer.concat([variable, payload]);
  return Buffer.concat([Buffer.from([0x10]), encodeRemainingLength(remaining.length), remaining]);
}

function buildMqttSubscribe(topic, packetId) {
  const body = Buffer.concat([
    Buffer.from([(packetId >> 8) & 0xff, packetId & 0xff]),
    mqttString(topic),
    Buffer.from([0x00])
  ]);
  return Buffer.concat([Buffer.from([0x82]), encodeRemainingLength(body.length), body]);
}

function buildMqttPublish(topic, message) {
  const body = Buffer.concat([mqttString(topic), Buffer.from(String(message), 'utf8')]);
  return Buffer.concat([Buffer.from([0x30]), encodeRemainingLength(body.length), body]);
}

function readMqttFrame(buffer) {
  if (!buffer || buffer.length < 2) return null;
  let multiplier = 1;
  let length = 0;
  let offset = 1;
  let encoded = 0;
  do {
    if (offset >= buffer.length) return null;
    encoded = buffer[offset++];
    length += (encoded & 127) * multiplier;
    multiplier *= 128;
    if (multiplier > 128 ** 4) return null;
  } while ((encoded & 128) !== 0);
  if (buffer.length < offset + length) return null;
  return {
    type: buffer[0] >> 4,
    flags: buffer[0] & 0x0f,
    payload: buffer.subarray(offset, offset + length),
    total: offset + length
  };
}

function parseMqttPublish(frame) {
  const payload = frame.payload;
  if (!payload || payload.length < 2) return null;
  const topicLength = payload.readUInt16BE(0);
  const topicEnd = 2 + topicLength;
  if (payload.length < topicEnd) return null;
  let start = topicEnd;
  const qos = (frame.flags >> 1) & 0x03;
  if (qos > 0) start += 2;
  if (payload.length < start) return null;
  return {
    topic: payload.subarray(2, topicEnd).toString('utf8'),
    body: payload.subarray(start)
  };
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let req;
    try {
      const lib = url.startsWith('https:') ? https : http;
      req = lib.get(url, {
        family: 4,
        timeout: timeoutMs,
        headers: { Accept: 'application/json' }
      }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 256 * 1024) {
            req.destroy();
            done(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {
            json = null;
          }
          done({ status: res.statusCode || 0, json });
        });
      });
    } catch (_) {
      done(null);
      return;
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
  });
}

function httpExchange(url, { timeoutMs = 2000, headers = {} } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let req;
    try {
      const lib = url.startsWith('https:') ? https : http;
      const parsed = new URL(url);
      req = lib.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        family: 4,
        timeout: timeoutMs,
        headers: { Accept: 'application/json', ...headers }
      }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 256 * 1024) {
            req.destroy();
            done(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) { json = null; }
          done({ status: res.statusCode || 0, headers: res.headers || {}, json });
        });
      });
    } catch (_) {
      done(null);
      return;
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
    req.end();
  });
}

async function httpGetDigest(url, { username, password, timeoutMs = 4000 } = {}) {
  const first = await httpExchange(url, { timeoutMs });
  if (!first || first.status !== 401 || !password) return first;
  const challengeHeader = first.headers?.['www-authenticate'] || '';
  if (!/digest/i.test(String(challengeHeader))) return first;
  const parsed = new URL(url);
  const authorization = buildDigestAuthorization({
    username: username || 'maker',
    password,
    method: 'GET',
    uri: `${parsed.pathname}${parsed.search}`,
    challenge: parseDigestChallenge(challengeHeader)
  });
  return httpExchange(url, { timeoutMs, headers: { Authorization: authorization } });
}

function tcpOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, family: 4 });
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(open);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function probeKlipperHost(host) {
  const [moonrakerOpen, webOpen] = await Promise.all([
    tcpOpen(host, MOONRAKER_PORT, 350),
    tcpOpen(host, 80, 350)
  ]);
  let via = null;
  if (moonrakerOpen) {
    const info = await httpGetJson(`http://${host}:${MOONRAKER_PORT}/server/info`, 800);
    if (isMoonrakerInfo(info?.json)) via = MOONRAKER_PORT;
  }
  if (!via && webOpen) {
    const info = await httpGetJson(`http://${host}/server/info`, 800);
    if (isMoonrakerInfo(info?.json)) via = 80;
  }
  if (!via && webOpen) {
    const version = await httpExchange(`http://${host}/api/version`, { timeoutMs: 1000 });
    if (looksLikePrusa(version)) {
      const named = prusaDisplayName(version?.json);
      return {
        kind: 'prusa',
        host,
        serial: '',
        name: named || `Prusa @ ${host}`,
        model: prusaModelName(version?.json),
        manufacturer: 'Prusa Research',
        firmwareType: 'Prusa Buddy',
        printerType: 'FDM',
        webUrl: `http://${host}`,
        discoveredVia: 'prusalink'
      };
    }
  }
  if (!via) return null;

  const infoUrl = via === MOONRAKER_PORT
    ? `http://${host}:${MOONRAKER_PORT}/printer/info`
    : `http://${host}/printer/info`;
  const printerInfo = await httpGetJson(infoUrl, 800);
  const hostname = String(printerInfo?.json?.result?.hostname || '').trim();
  const name = hostname && hostname.toLowerCase() !== 'unknown' ? hostname : `Klipper @ ${host}`;
  return {
    kind: 'klipper',
    host,
    serial: '',
    name,
    model: '',
    manufacturer: '',
    firmwareType: 'Klipper',
    printerType: 'FDM',
    webUrl: `http://${host}`,
    discoveredVia: via === MOONRAKER_PORT ? 'moonraker' : 'web'
  };
}

function probeBambuTls(host, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) { /* already closed */ }
      resolve(value);
    };
    const socket = tls.connect({
      host,
      port: BAMBU_MQTT_PORT,
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, () => {
      try {
        const cert = socket.getPeerCertificate(false);
        const match = isBambuCertificate(cert);
        finish(match ? { serial: match.serial } : null);
      } catch (_) {
        finish(null);
      }
    });
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on('error', () => finish(null));
  });
}

async function probeBambuHost(host) {
  const open = await tcpOpen(host, BAMBU_MQTT_PORT, 350);
  if (!open) return null;
  const cert = await probeBambuTls(host, 1200);
  if (!cert) return null;
  return {
    kind: 'bambu',
    host,
    serial: cert.serial || '',
    name: `Bambu Lab @ ${host}`,
    model: '',
    manufacturer: 'Bambu Lab',
    firmwareType: 'Bambu OS',
    printerType: 'FDM',
    discoveredVia: 'mqtt'
  };
}

function discoverBambuSsdp(timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch (_) { /* already closed */ }
      resolve(found);
    };
    const search = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDRESS}:1990\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: urn:bambulab-com:device:3dprinter:1\r\n' +
      '\r\n'
    );

    socket.on('message', (msg, rinfo) => {
      const parsed = parseSsdpPayload(msg.toString('utf8'));
      if (!parsed) return;
      found.push(bambuCandidateFromSsdp(parsed, rinfo.address));
    });
    socket.on('error', () => finish());

    socket.bind(0, () => {
      try { socket.setBroadcast(true); } catch (_) { /* broadcast unavailable */ }
      const { ownIps } = listScanSubnets();
      for (const ip of ownIps) {
        try { socket.addMembership(SSDP_ADDRESS, ip); } catch (_) { /* interface cannot join */ }
      }
      const targets = [
        [SSDP_ADDRESS, 1990],
        [SSDP_ADDRESS, 2021],
        ['255.255.255.255', 1990],
        ['255.255.255.255', 2021]
      ];
      for (const [host, port] of targets) {
        try { socket.send(search, port, host); } catch (_) { /* send failed */ }
      }
    });

    setTimeout(finish, timeoutMs);
  });
}

function getLocalScanRange() {
  const networks = listScanSubnets().networks;
  for (const network of networks) {
    try {
      const parsed = parseScanRange(network);
      if (parsed?.hosts?.length) {
        return {
          start: parsed.hosts[0],
          end: parsed.hosts[parsed.hosts.length - 1]
        };
      }
    } catch (_) { /* try the next interface */ }
  }
  return { start: '', end: '' };
}

async function discoverPrinters(options = {}) {
  const local = listScanSubnets();
  const requested = parseScanRange(options.range);
  const hosts = (requested ? requested.hosts : local.hosts).filter((host) => !local.ownIps.has(host));
  const networks = requested ? requested.networks : local.networks;
  const budget = Math.min(30000, Math.max(12000, Math.ceil(hosts.length / 64) * 500 + 6000));

  const scan = Promise.all([
    discoverBambuSsdp(4000),
    mapLimit(hosts, 64, (host) => probeKlipperHost(host).catch(() => null)),
    mapLimit(hosts, 32, (host) => probeBambuHost(host).catch(() => null))
  ]).then(([ssdp, klipper, bambuTls]) => {
    const printers = mergeDiscoveredPrinters([
      ...ssdp,
      ...bambuTls.filter(Boolean),
      ...klipper.filter(Boolean)
    ]);
    printers.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return { printers, networks, scannedHosts: hosts.length };
  });

  return withTimeout(scan, budget, { printers: [], networks, scannedHosts: hosts.length });
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, () => {
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

function parseWebUrl(webUrl) {
  const raw = String(webUrl || '').trim();
  if (!raw) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const url = new URL(withProtocol);
    return {
      hostname: url.hostname,
      port: url.port,
      origin: url.origin
    };
  } catch (_) {
    return null;
  }
}

async function queryKlipperStatus(printer) {
  const parsed = parseWebUrl(printer?.web_url || printer?.webUrl || '');
  const host = parsed?.hostname || normalizePrinterHost(printer?.host);
  if (!host) return { supported: false };

  const candidates = [];
  if (parsed?.port === String(MOONRAKER_PORT)) {
    candidates.push(`${parsed.origin}/printer/objects/query?print_stats&webhooks`);
  }
  candidates.push(`http://${host}:${MOONRAKER_PORT}/printer/objects/query?print_stats&webhooks`);
  if (parsed?.origin && parsed.port !== String(MOONRAKER_PORT)) {
    candidates.push(`${parsed.origin}/printer/objects/query?print_stats&webhooks`);
  }

  const seen = new Set();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    const response = await httpGetJson(url, 2000);
    if (!response) continue;
    if (response.status === 401 || response.status === 403) {
      return {
        supported: true,
        state: 'online',
        label: 'Online',
        detail: 'Moonraker requires authentication'
      };
    }
    const extracted = extractKlipperStatus(response.json);
    if (extracted) return { supported: true, ...extracted };
  }

  const info = await httpGetJson(`http://${host}:${MOONRAKER_PORT}/server/info`, 1500);
  if (isMoonrakerInfo(info?.json)) {
    return { supported: true, ...mapKlipperState('', info.json.result.klippy_state) };
  }
  if (parsed?.origin) {
    const proxied = await httpGetJson(`${parsed.origin}/server/info`, 1500);
    if (isMoonrakerInfo(proxied?.json)) {
      return { supported: true, ...mapKlipperState('', proxied.json.result.klippy_state) };
    }
  }
  return { supported: true, state: 'offline', label: 'Offline' };
}

function queryBambuStatus(printer, timeoutMs = 7000) {
  const host = normalizePrinterHost(printer?.host);
  const serial = String(printer?.bambu_serial || printer?.bambuSerial || '').trim();
  const accessCode = String(printer?.bambu_access_code || printer?.bambuAccessCode || '').trim();
  if (!host || !serial || !accessCode) return Promise.resolve({ supported: false });

  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) { /* already closed */ }
      resolve(result);
    };

    const socket = tls.connect({
      host,
      port: BAMBU_MQTT_PORT,
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, () => {
      const clientId = `pv${Math.random().toString(36).slice(2, 10)}`;
      socket.write(buildMqttConnect(clientId, 'bblp', accessCode));
    });

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const frame = readMqttFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.total);
        if (frame.type === 2) {
          const returnCode = frame.payload.length > 1 ? frame.payload[1] : 0;
          if (returnCode !== 0) {
            finish({
              supported: true,
              state: 'error',
              label: 'Auth failed',
              detail: 'Check the LAN access code'
            });
            return;
          }
          connected = true;
          socket.write(buildMqttSubscribe(`device/${serial}/report`, 1));
        } else if (frame.type === 9) {
          const payload = JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } });
          socket.write(buildMqttPublish(`device/${serial}/request`, payload));
        } else if (frame.type === 3) {
          const published = parseMqttPublish(frame);
          if (!published) continue;
          let json = null;
          try {
            json = JSON.parse(published.body.toString('utf8'));
          } catch (_) {
            json = null;
          }
          const gcodeState = json?.print?.gcode_state;
          if (!gcodeState) continue;
          const mapped = mapBambuGcodeState(gcodeState);
          const detail = String(json.print.subtask_name || json.print.gcode_file || '').trim();
          if (detail && (mapped.state === 'printing' || mapped.state === 'paused')) mapped.detail = detail;
          finish({ supported: true, ...mapped });
          return;
        }
      }
    });

    socket.on('error', () => finish({ supported: true, state: 'offline', label: 'Offline' }));
    socket.setTimeout(timeoutMs, () => {
      if (connected) finish({ supported: true, state: 'online', label: 'Online' });
      else finish({ supported: true, state: 'offline', label: 'Offline' });
    });
  });
}

async function queryPrusaStatus(printer) {
  const parsed = parseWebUrl(printer?.web_url || printer?.webUrl || '');
  const host = parsed?.hostname || normalizePrinterHost(printer?.host);
  if (!host) return { supported: false };
  const origin = parsed?.origin || `http://${host}`;
  const username = String(printer?.prusa_username || printer?.prusaUsername || 'maker').trim() || 'maker';
  const password = String(printer?.prusa_password || printer?.prusaPassword || '');

  if (!password) {
    const version = await httpExchange(`${origin}/api/version`, { timeoutMs: 2000 });
    if (looksLikePrusa(version) || version?.status === 401) {
      return {
        supported: true,
        state: 'online',
        label: 'Online',
        detail: 'Add the PrusaLink password for print status'
      };
    }
    return { supported: true, state: 'offline', label: 'Offline' };
  }

  const response = await httpGetDigest(`${origin}/api/v1/status`, { username, password, timeoutMs: 4000 });
  if (!response) return { supported: true, state: 'offline', label: 'Offline' };
  if (response.status === 401 || response.status === 403) {
    return {
      supported: true,
      state: 'error',
      label: 'Auth failed',
      detail: 'Check the PrusaLink username and password'
    };
  }
  const extracted = extractPrusaStatus(response.json);
  if (extracted) return { supported: true, ...extracted };
  if (looksLikePrusa(response) || response.status === 200) {
    return { supported: true, state: 'online', label: 'Online' };
  }
  return { supported: true, state: 'offline', label: 'Offline' };
}

async function getPrinterLiveStatus(printer) {
  const kind = liveStatusKind(printer);
  if (!kind) return { supported: false };
  try {
    if (kind === 'bambu') return await queryBambuStatus(printer);
    if (kind === 'prusa') return await queryPrusaStatus(printer);
    return await queryKlipperStatus(printer);
  } catch (_) {
    return { supported: true, state: 'offline', label: 'Offline' };
  }
}

async function getLiveStatuses(printers) {
  const list = Array.isArray(printers) ? printers : [];
  const out = {};
  await mapLimit(list, 3, async (printer) => {
    if (!printer || printer.id == null) return;
    out[printer.id] = await getPrinterLiveStatus(printer);
  });
  return out;
}

module.exports = {
  hostsInSubnet,
  parseScanRange,
  getLocalScanRange,
  isVirtualInterface,
  normalizePrinterHost,
  bambuModelLabel,
  parseSsdpPayload,
  isBambuCertificate,
  mapBambuGcodeState,
  mapKlipperState,
  mapPrusaState,
  looksLikePrusa,
  extractPrusaStatus,
  buildDigestAuthorization,
  isMoonrakerInfo,
  extractKlipperStatus,
  liveStatusKind,
  mergeDiscoveredPrinters,
  readMqttFrame,
  parseMqttPublish,
  buildMqttPublish,
  discoverPrinters,
  getPrinterLiveStatus,
  getLiveStatuses
};
