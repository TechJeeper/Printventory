'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const util = require('util');
const crypto = require('crypto');

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const TAIL_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 8 * 1024 * 1024;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_LINE_CHARS = 8000;

const INSPECT_OPTIONS = { depth: 3, maxArrayLength: 20, maxStringLength: 2000, breakLength: 160 };

function redactLogText(text) {
  return String(text)
    .replace(/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+/gi, '[discord-webhook]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
}

function clampLine(text) {
  if (text.length <= MAX_LINE_CHARS) return text;
  return `${text.slice(0, MAX_LINE_CHARS)} …[${text.length - MAX_LINE_CHARS} more chars]`;
}

function formatArgs(args) {
  try {
    return util.format(...args.map((arg) => {
      if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean' || arg == null) {
        return arg;
      }
      if (arg instanceof Error) return arg.stack || arg.message;
      return util.inspect(arg, INSPECT_OPTIONS);
    }));
  } catch (_) {
    return args.map((arg) => {
      try { return String(arg); } catch (err) { return '[unprintable]'; }
    }).join(' ');
  }
}

function formatLogLine(level, message) {
  return `${new Date().toISOString()} [${level}] ${clampLine(redactLogText(message))}\n`;
}

function readLogTail(filePath, maxBytes = TAIL_BYTES) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  if (!stat.size) return '';
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
      text = '[earlier log truncated]\n' + text;
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function buildDiscordMultipart({ payload, filename, fileBuffer, boundary }) {
  const chunks = [];
  const push = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));
  push(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\n\r\n${payload}\r\n`);
  push(`--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`);
  push(fileBuffer);
  push(`\r\n--${boundary}--\r\n`);
  return Buffer.concat(chunks);
}

function readBundledWebhookUrl() {
  const candidates = [path.join(__dirname, 'support-webhook.json')];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'support-webhook.json'));
  }
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) continue;
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.url) return String(parsed.url).trim();
      }
      return raw;
    } catch (_) {
      /* try the next location */
    }
  }
  return '';
}

function resolveDiscordWebhookUrl(webhookUrl) {
  const configured = webhookUrl === undefined
    ? (process.env.DISCORD_WEBHOOK_URL || readBundledWebhookUrl())
    : webhookUrl;
  if (!configured) {
    throw new Error('Discord support webhook is not configured.');
  }
  webhookUrl = configured;
  let url;
  try {
    url = new URL(webhookUrl);
  } catch (_) {
    throw new Error('Discord support webhook is invalid.');
  }
  const isDiscord = url.protocol === 'https:' &&
    (url.hostname === 'discord.com' || url.hostname === 'discordapp.com') &&
    /^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname);
  if (!isDiscord) {
    throw new Error('Discord support webhook is invalid.');
  }
  return url.toString();
}

function postDiscordWebhook(webhookUrl, { filename, fileBuffer, content }) {
  const url = new URL(resolveDiscordWebhookUrl(webhookUrl));
  const boundary = `----PrintventoryLogs${crypto.randomBytes(12).toString('hex')}`;
  const payload = JSON.stringify({ content: String(content || '').slice(0, 2000) });
  const body = buildDiscordMultipart({ payload, filename, fileBuffer, boundary });

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'User-Agent': 'Printventory'
      }
    }, (res) => {
      const parts = [];
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(parts).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: responseBody });
          return;
        }
        const detail = redactLogText(responseBody).slice(0, 300);
        reject(new Error(`Discord returned ${res.statusCode}${detail ? `: ${detail}` : ''}`));
      });
    });
    req.setTimeout(60000, () => {
      req.destroy(new Error('Timed out sending logs to Discord'));
    });
    req.on('error', (error) => reject(error));
    req.write(body);
    req.end();
  });
}

function createCapture(options = {}) {
  const state = {
    installed: false,
    streamsHooked: false,
    appBuffer: [],
    consoleBuffer: [],
    serverBuffer: [],
    appBufferBytes: 0,
    consoleBufferBytes: 0,
    serverBufferBytes: 0,
    directory: null,
    appPath: null,
    consolePath: null,
    serverPath: null,
    appStream: null,
    consoleStream: null,
    serverStream: null,
    appBytes: 0,
    consoleBytes: 0,
    serverBytes: 0,
    appRotating: false,
    consoleRotating: false,
    serverRotating: false,
    appPending: null,
    consolePending: null,
    serverPending: null,
    sending: false,
    attached: new WeakSet()
  };

  function fields(kind) {
    return {
      buffer: `${kind}Buffer`,
      bufferBytes: `${kind}BufferBytes`,
      path: `${kind}Path`,
      stream: `${kind}Stream`,
      bytes: `${kind}Bytes`,
      rotating: `${kind}Rotating`,
      pending: `${kind}Pending`,
      rotateGaveUp: `${kind}RotateGaveUp`
    };
  }

  function pushBuffer(kind, line) {
    const f = fields(kind);
    const lines = state[f.buffer];
    lines.push(line);
    state[f.bufferBytes] += line.length;
    while (state[f.bufferBytes] > MAX_BUFFER_BYTES && lines.length > 1) {
      state[f.bufferBytes] -= lines.shift().length;
    }
  }

  function writeLine(kind, line) {
    const f = fields(kind);
    if (!state.directory) {
      pushBuffer(kind, line);
      return;
    }
    if (state[f.rotating]) {
      const pending = state[f.pending];
      if (pending) pending.push(line);
      return;
    }
    const stream = state[f.stream];
    if (!stream) return;
    stream.write(line);
    state[f.bytes] += line.length;
    if (!state[f.rotateGaveUp] && state[f.bytes] >= MAX_FILE_BYTES) {
      rotate(kind);
    }
  }

  function rotate(kind) {
    const f = fields(kind);
    if (state[f.rotating]) return;
    state[f.rotating] = true;
    const currentPath = state[f.path];
    const stream = state[f.stream];
    const pending = [];
    state[f.pending] = pending;
    const finish = () => {
      const previous = `${currentPath}.1`;
      let renamed = !fs.existsSync(currentPath);
      try { fs.rmSync(previous, { force: true }); } catch (_) { /* ignore */ }
      try {
        if (fs.existsSync(currentPath)) {
          fs.renameSync(currentPath, previous);
          renamed = true;
        }
      } catch (_) { /* keep writing the current file if it is still locked */ }
      const next = fs.createWriteStream(currentPath, { flags: 'a' });
      next.on('error', () => {});
      let nextBytes = 0;
      if (!renamed) {
        try { nextBytes = fs.statSync(currentPath).size; } catch (_) { nextBytes = MAX_FILE_BYTES; }
      }
      state[f.stream] = next;
      state[f.bytes] = nextBytes;
      state[f.rotating] = false;
      state[f.pending] = null;
      if (!renamed) state[f.rotateGaveUp] = true;
      for (const queued of pending) {
        next.write(queued);
        state[f.bytes] += queued.length;
      }
    };
    if (stream) stream.end(finish);
    else finish();
  }

  function appendApp(level, args) {
    writeLine('app', formatLogLine(level, formatArgs(args)));
  }

  function appendConsole(level, message, sourceId, lineNumber) {
    let suffix = '';
    if (sourceId) {
      const base = path.basename(String(sourceId).split('?')[0]);
      suffix = lineNumber != null && lineNumber !== '' ? ` (${base}:${lineNumber})` : ` (${base})`;
    }
    writeLine('console', formatLogLine(level || 'info', `${message || ''}${suffix}`));
  }

  function chunkToText(chunk) {
    if (typeof chunk === 'string') return chunk;
    if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
    if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8');
    return String(chunk ?? '');
  }

  function hookOutputStream(stream, level) {
    if (!stream || stream.__printventoryLogHook || typeof stream.write !== 'function') return;
    const original = stream.write;
    let capturing = false;
    stream.write = function (chunk, encoding, callback) {
      if (!capturing) {
        capturing = true;
        try {
          chunkToText(chunk).split(/\r?\n/).forEach((line) => {
            if (!line) return;
            writeLine('server', formatLogLine(level, line));
          });
        } catch (_) { /* keep logging */ }
        capturing = false;
      }
      return original.apply(stream, arguments);
    };
    stream.__printventoryLogHook = true;
  }

  function beginCapture() {
    if (state.installed) return;
    state.installed = true;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const original = console[level];
      if (typeof original !== 'function') continue;
      console[level] = (...args) => {
        try { appendApp(level === 'log' ? 'info' : level, args); } catch (_) { /* keep logging */ }
        return original.apply(console, args);
      };
    }
    if (!state.streamsHooked) {
      state.streamsHooked = true;
      try {
        hookOutputStream(process.stdout, 'stdout');
        hookOutputStream(process.stderr, 'stderr');
      } catch (_) { /* stdout may be read-only */ }
    }
  }

  function openKindStream(kind, fileName) {
    const f = fields(kind);
    state[f.path] = path.join(state.directory, fileName);
    const stream = fs.createWriteStream(state[f.path], { flags: 'a' });
    stream.on('error', () => {});
    state[f.stream] = stream;
    try {
      state[f.bytes] = fs.statSync(state[f.path]).size;
    } catch (_) {
      state[f.bytes] = 0;
    }
    if (state[f.buffer].length) {
      const pending = state[f.buffer].join('');
      stream.write(pending);
      state[f.bytes] += pending.length;
      state[f.buffer] = [];
      state[f.bufferBytes] = 0;
    }
  }

  function openLogDirectory(directory) {
    if (state.directory) return;
    fs.mkdirSync(directory, { recursive: true });
    state.directory = directory;
    openKindStream('app', 'app.log');
    openKindStream('console', 'console.log');
    openKindStream('server', 'server.log');
    const header = formatLogLine('info', `--- log session ${process.pid} ---`);
    state.appStream.write(header);
    state.appBytes += header.length;
    state.serverStream.write(header);
    state.serverBytes += header.length;
  }

  function attachWebContents(webContents) {
    if (!webContents || state.attached.has(webContents)) return;
    state.attached.add(webContents);
    webContents.on('console-message', (details, level, message, line, sourceId) => {
      try {
        const text = details && typeof details.message === 'string' ? details.message : message;
        const lvl = (details && details.level) || ['debug', 'info', 'warning', 'error'][level] || 'info';
        const src = (details && details.sourceId) || sourceId;
        const lineNo = details && details.lineNumber != null ? details.lineNumber : line;
        appendConsole(lvl, text, src, lineNo);
      } catch (_) { /* ignore */ }
    });
  }

  function flushStream(stream) {
    return new Promise((resolve) => {
      if (!stream || stream.destroyed || stream.writableEnded) {
        resolve();
        return;
      }
      stream.write('', () => resolve());
    });
  }

  function readKindLog(kind, tailBytes) {
    const f = fields(kind);
    return [
      readLogTail(state[f.path] ? `${state[f.path]}.1` : '', tailBytes),
      readLogTail(state[f.path], tailBytes),
      state[f.buffer].join('')
    ].filter(Boolean).join('');
  }

  async function createLogsZip(version, tailBytes = TAIL_BYTES, extra = {}) {
    const JSZip = require('jszip');
    await Promise.all([
      flushStream(state.appStream),
      flushStream(state.consoleStream),
      flushStream(state.serverStream)
    ]);
    const appLog = readKindLog('app', tailBytes);
    let consoleLog = readKindLog('console', tailBytes);
    const clientConsole = extra && extra.clientConsole ? redactLogText(String(extra.clientConsole)).slice(-tailBytes) : '';
    if (clientConsole) {
      consoleLog = [consoleLog, `--- browser console ---\n${clientConsole}`].filter(Boolean).join('\n');
    }
    const serverLog = readKindLog('server', tailBytes);
    const system = [
      `Printventory ${version || 'unknown'}`,
      `Electron ${process.versions.electron || 'unknown'}`,
      `Chrome ${process.versions.chrome || 'unknown'}`,
      `Node ${process.versions.node || 'unknown'}`,
      `Platform ${process.platform} ${process.arch}`,
      `OS ${os.release()}`,
      `Captured ${new Date().toISOString()}`
    ].join('\n') + '\n';
    const zip = new JSZip();
    zip.file('app.log', appLog || '(no app logs captured)\n');
    zip.file('console.log', consoleLog || '(no console logs captured)\n');
    zip.file('server.log', serverLog || '(no server logs captured)\n');
    zip.file('system.txt', system);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  async function uploadLogs({ version, clientConsole } = {}) {
    let zipBuffer = await createLogsZip(version, TAIL_BYTES, { clientConsole });
    if (zipBuffer.length > MAX_ZIP_BYTES) {
      const shorter = clientConsole ? String(clientConsole).slice(-256 * 1024) : '';
      zipBuffer = await createLogsZip(version, 256 * 1024, { clientConsole: shorter });
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const filename = `printventory-logs-${stamp}.zip`;
    const content = [
      'Printventory support logs',
      `Version: ${version || 'unknown'}`,
      `Platform: ${process.platform} ${process.arch} (${os.release()})`,
      `Sent: ${new Date().toISOString()}`
    ].join('\n');
    const post = options.postZip || ((file) => postDiscordWebhook(resolveDiscordWebhookUrl(options.webhookUrl), file));
    await post({ filename, fileBuffer: zipBuffer, content });
  }

  async function confirmAndSend({ dialog, parentWindow, version } = {}) {
    if (state.sending) return { sent: false };
    state.sending = true;
    const parent = parentWindow && !parentWindow.isDestroyed?.() ? parentWindow : undefined;
    try {
      const choice = await dialog.showMessageBox(parent, {
        type: 'question',
        buttons: ['Send Logs', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Send Logs',
        message: 'This will send the Printventory logs to the support team on Discord.',
        detail: 'Console logs, app logs, and server logs will be zipped and uploaded.'
      });
      if (choice.response !== 0) return { sent: false };

      await uploadLogs({ version });
      await dialog.showMessageBox(parent, {
        type: 'info',
        title: 'Send Logs',
        message: 'Printventory logs were sent to the support team on Discord.'
      });
      return { sent: true };
    } catch (error) {
      const detail = redactLogText(error && error.message ? error.message : String(error)).slice(0, 500);
      if (dialog && dialog.showMessageBox) {
        await dialog.showMessageBox(parent, {
          type: 'error',
          title: 'Send Logs',
          message: 'Could not send Printventory logs.',
          detail
        });
      }
      return { sent: false, error: detail };
    } finally {
      state.sending = false;
    }
  }

  async function sendCapturedLogs({ version, clientConsole } = {}) {
    if (state.sending) return { sent: false, error: 'Logs are already being sent.' };
    state.sending = true;
    try {
      await uploadLogs({ version, clientConsole });
      return { sent: true };
    } catch (error) {
      const detail = redactLogText(error && error.message ? error.message : String(error)).slice(0, 500);
      return { sent: false, error: detail };
    } finally {
      state.sending = false;
    }
  }

  return {
    beginCapture,
    openLogDirectory,
    attachWebContents,
    appendApp,
    appendConsole,
    createLogsZip,
    confirmAndSend,
    sendCapturedLogs
  };
}

module.exports = {
  createCapture,
  redactLogText,
  readLogTail,
  formatLogLine,
  buildDiscordMultipart,
  resolveDiscordWebhookUrl
};
