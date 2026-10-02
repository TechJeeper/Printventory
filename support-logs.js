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

function resolveDiscordWebhookUrl(webhookUrl = process.env.DISCORD_WEBHOOK_URL) {
  if (!webhookUrl) {
    throw new Error('Discord support webhook is not configured.');
  }
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
    appBuffer: [],
    consoleBuffer: [],
    appBufferBytes: 0,
    consoleBufferBytes: 0,
    directory: null,
    appPath: null,
    consolePath: null,
    appStream: null,
    consoleStream: null,
    appBytes: 0,
    consoleBytes: 0,
    appRotating: false,
    consoleRotating: false,
    appPending: null,
    consolePending: null,
    sending: false,
    attached: new WeakSet()
  };

  function pushBuffer(kind, line) {
    const lines = kind === 'app' ? state.appBuffer : state.consoleBuffer;
    const key = kind === 'app' ? 'appBufferBytes' : 'consoleBufferBytes';
    lines.push(line);
    state[key] += line.length;
    while (state[key] > MAX_BUFFER_BYTES && lines.length > 1) {
      state[key] -= lines.shift().length;
    }
  }

  function writeLine(kind, line) {
    if (!state.directory) {
      pushBuffer(kind, line);
      return;
    }
    if (kind === 'app' ? state.appRotating : state.consoleRotating) {
      const pending = kind === 'app' ? state.appPending : state.consolePending;
      if (pending) pending.push(line);
      return;
    }
    const stream = kind === 'app' ? state.appStream : state.consoleStream;
    if (!stream) return;
    stream.write(line);
    if (kind === 'app') state.appBytes += line.length;
    else state.consoleBytes += line.length;
    const gaveUp = kind === 'app' ? state.appRotateGaveUp : state.consoleRotateGaveUp;
    if (!gaveUp && (kind === 'app' ? state.appBytes : state.consoleBytes) >= MAX_FILE_BYTES) {
      rotate(kind);
    }
  }

  function rotate(kind) {
    const rotatingKey = kind === 'app' ? 'appRotating' : 'consoleRotating';
    if (state[rotatingKey]) return;
    state[rotatingKey] = true;
    const currentPath = kind === 'app' ? state.appPath : state.consolePath;
    const stream = kind === 'app' ? state.appStream : state.consoleStream;
    const pending = [];
    if (kind === 'app') state.appPending = pending;
    else state.consolePending = pending;
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
      if (kind === 'app') {
        state.appStream = next;
        state.appBytes = nextBytes;
        state.appRotating = false;
        state.appPending = null;
        if (!renamed) state.appRotateGaveUp = true;
      } else {
        state.consoleStream = next;
        state.consoleBytes = nextBytes;
        state.consoleRotating = false;
        state.consolePending = null;
        if (!renamed) state.consoleRotateGaveUp = true;
      }
      for (const queued of pending) {
        next.write(queued);
        if (kind === 'app') state.appBytes += queued.length;
        else state.consoleBytes += queued.length;
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
  }

  function openLogDirectory(directory) {
    if (state.directory) return;
    fs.mkdirSync(directory, { recursive: true });
    state.directory = directory;
    state.appPath = path.join(directory, 'app.log');
    state.consolePath = path.join(directory, 'console.log');
    state.appStream = fs.createWriteStream(state.appPath, { flags: 'a' });
    state.consoleStream = fs.createWriteStream(state.consolePath, { flags: 'a' });
    state.appStream.on('error', () => {});
    state.consoleStream.on('error', () => {});
    try {
      state.appBytes = fs.statSync(state.appPath).size;
      state.consoleBytes = fs.statSync(state.consolePath).size;
    } catch (_) {
      state.appBytes = 0;
      state.consoleBytes = 0;
    }
    const header = formatLogLine('info', `--- log session ${process.pid} ---`);
    state.appStream.write(header);
    state.appBytes += header.length;
    if (state.appBuffer.length) {
      const pending = state.appBuffer.join('');
      state.appStream.write(pending);
      state.appBytes += pending.length;
      state.appBuffer = [];
      state.appBufferBytes = 0;
    }
    if (state.consoleBuffer.length) {
      const pending = state.consoleBuffer.join('');
      state.consoleStream.write(pending);
      state.consoleBytes += pending.length;
      state.consoleBuffer = [];
      state.consoleBufferBytes = 0;
    }
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

  async function createLogsZip(version, tailBytes = TAIL_BYTES) {
    const JSZip = require('jszip');
    await Promise.all([flushStream(state.appStream), flushStream(state.consoleStream)]);
    const appLog = [
      readLogTail(state.appPath ? `${state.appPath}.1` : '', tailBytes),
      readLogTail(state.appPath, tailBytes),
      state.appBuffer.join('')
    ].filter(Boolean).join('');
    const consoleLog = [
      readLogTail(state.consolePath ? `${state.consolePath}.1` : '', tailBytes),
      readLogTail(state.consolePath, tailBytes),
      state.consoleBuffer.join('')
    ].filter(Boolean).join('');
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
    zip.file('system.txt', system);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
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
        detail: 'Console logs and app logs will be zipped and uploaded.'
      });
      if (choice.response !== 0) return { sent: false };

      let zipBuffer = await createLogsZip(version, TAIL_BYTES);
      if (zipBuffer.length > MAX_ZIP_BYTES) {
        zipBuffer = await createLogsZip(version, 256 * 1024);
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

  return {
    beginCapture,
    openLogDirectory,
    attachWebContents,
    appendApp,
    appendConsole,
    createLogsZip,
    confirmAndSend
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
