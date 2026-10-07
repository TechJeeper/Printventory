#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createCapture,
  redactLogText,
  readLogTail,
  buildDiscordMultipart,
  resolveDiscordWebhookUrl
} = require('./support-logs');

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL ${name}:`, err);
      process.exitCode = 1;
    });
}

async function main() {
  await test('redacts webhook urls and api keys', () => {
    const input = 'hook https://discord.com/api/webhooks/123/abcdefghijklmnop key sk-proj-abcdefghijklmnopqrstuvwxyz Authorization: Bearer super-secret.token';
    const output = redactLogText(input);
    assert.strictEqual(output.includes('abcdefghijklmnop'), false);
    assert.strictEqual(output.includes('sk-proj-'), false);
    assert.strictEqual(output.includes('super-secret'), false);
    assert.ok(output.includes('[discord-webhook]'));
    assert.ok(output.includes('[api-key]'));
    assert.ok(output.includes('Bearer [redacted]'));
  });

  await test('reads only the tail of a log file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printventory-logs-'));
    const file = path.join(dir, 'app.log');
    fs.writeFileSync(file, `HEAD\n${'x'.repeat(100)}\nTAIL`);
    const tail = readLogTail(file, 20);
    assert.ok(tail.startsWith('[earlier log truncated]'));
    assert.ok(tail.endsWith('TAIL'));
    assert.strictEqual(tail.includes('HEAD'), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('zip contains app logs and console logs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printventory-logs-'));
    const capture = createCapture();
    capture.appendApp('info', ['starting', 'sk-abcdefghijklmnopqrstuvwxyz']);
    capture.appendConsole('warning', 'renderer failed https://discord.com/api/webhooks/9/tokentokentoken', 'renderer.js', 12);
    capture.openLogDirectory(dir);
    const zipBuffer = await capture.createLogsZip('9.9.9');
    assert.ok(zipBuffer.slice(0, 2).toString() === 'PK');
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(zipBuffer);
    const appLog = await zip.file('app.log').async('string');
    const consoleLog = await zip.file('console.log').async('string');
    const system = await zip.file('system.txt').async('string');
    assert.ok(zip.file('server.log'));
    assert.ok(appLog.includes('starting'));
    assert.strictEqual(appLog.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
    assert.ok(appLog.includes('[api-key]'));
    assert.ok(consoleLog.includes('renderer failed'));
    assert.ok(consoleLog.includes('renderer.js:12'));
    assert.strictEqual(consoleLog.includes('tokentokentoken'), false);
    assert.ok(system.includes('Printventory 9.9.9'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('multipart body includes the zip and message', () => {
    const fileBuffer = Buffer.from('PK fake zip');
    const body = buildDiscordMultipart({
      payload: JSON.stringify({ content: 'Printventory support logs' }),
      filename: 'printventory-logs.zip',
      fileBuffer,
      boundary: 'TestBoundary'
    });
    const text = body.toString('utf8');
    assert.ok(text.includes('name="payload_json"'));
    assert.ok(text.includes('Printventory support logs'));
    assert.ok(text.includes('name="files[0]"; filename="printventory-logs.zip"'));
    assert.ok(body.includes(fileBuffer));
  });

  await test('requires a valid configured Discord webhook', () => {
    assert.throws(() => resolveDiscordWebhookUrl(''), /not configured/);
    assert.throws(() => resolveDiscordWebhookUrl('http://discord.com/api/webhooks/123/token'), /invalid/);
    assert.throws(() => resolveDiscordWebhookUrl('https://example.com/api/webhooks/123/token'), /invalid/);
    assert.strictEqual(
      resolveDiscordWebhookUrl('https://discord.com/api/webhooks/123/token_value'),
      'https://discord.com/api/webhooks/123/token_value'
    );
  });

  await test('cancel does not upload', async () => {
    let posted = 0;
    const capture = createCapture({
      postZip: async () => { posted += 1; }
    });
    const result = await capture.confirmAndSend({
      version: '1.0.0',
      dialog: {
        async showMessageBox() {
          return { response: 1 };
        }
      }
    });
    assert.strictEqual(result.sent, false);
    assert.strictEqual(posted, 0);
  });

  await test('confirm uploads the zip and reports success', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printventory-logs-'));
    let posted = null;
    const dialogs = [];
    const capture = createCapture({
      postZip: async (file) => { posted = file; }
    });
    capture.appendApp('error', ['disk full']);
    capture.openLogDirectory(dir);
    const result = await capture.confirmAndSend({
      version: '2.2.11',
      dialog: {
        async showMessageBox(_parent, options) {
          dialogs.push(options);
          return { response: 0 };
        }
      }
    });
    assert.strictEqual(result.sent, true);
    assert.ok(posted.filename.endsWith('.zip'));
    assert.ok(posted.content.includes('Printventory support logs'));
    assert.ok(posted.fileBuffer.slice(0, 2).toString() === 'PK');
    assert.strictEqual(dialogs[0].message, 'This will send the Printventory logs to the support team on Discord.');
    assert.strictEqual(dialogs[1].message, 'Printventory logs were sent to the support team on Discord.');
    assert.ok(dialogs[0].detail.includes('server logs'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('zip includes browser console and server stdout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printventory-logs-'));
    const capture = createCapture();
    capture.beginCapture();
    process.stdout.write('docker-server-marker\n');
    capture.openLogDirectory(dir);
    const zipBuffer = await capture.createLogsZip('3.0.0', undefined, {
      clientConsole: 'page error sk-abcdefghijklmnopqrstuvwxyz'
    });
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(zipBuffer);
    const serverLog = await zip.file('server.log').async('string');
    const consoleLog = await zip.file('console.log').async('string');
    const appLog = await zip.file('app.log').async('string');
    assert.ok(serverLog.includes('docker-server-marker'));
    assert.ok(consoleLog.includes('page error'));
    assert.ok(consoleLog.includes('browser console'));
    assert.strictEqual(consoleLog.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
    assert.ok(appLog.includes('log session') || appLog.length > 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

main();
