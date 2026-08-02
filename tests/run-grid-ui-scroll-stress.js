/**
 * Browser UI scroll stress: load library, scroll the virtual grid, watch for
 * IPC timeouts / WS disconnect / container OOM.
 */
const { chromium } = require('@playwright/test');
const { execSync } = require('child_process');

const BASE = process.env.PRINTVENTORY_DOCKER_URL || 'http://127.0.0.1:5000';

function dockerState() {
  try {
    return execSync(
      'docker inspect -f "running={{.State.Running}} oom={{.State.OOMKilled}}" printventory-server',
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return 'missing';
  }
}

function dockerMem() {
  try {
    return execSync(
      'docker stats printventory-server --no-stream --format "{{.MemUsage}}"',
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return 'n/a';
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'
  });
  const page = await browser.newPage();
  const timeouts = [];
  const errors = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('IPC call timeout')) timeouts.push(text);
    if (msg.type() === 'error') errors.push(text);
  });

  console.log('before', dockerState(), dockerMem());
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

  for (const label of ['I Agree', 'Accept', 'Get Started!', 'Close', 'OK']) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    try {
      if (await btn.isVisible({ timeout: 1200 })) await btn.click({ timeout: 2000 });
    } catch (_) {}
  }

  await page.waitForFunction(() => !!(window.electron && window.electron.getModelsFiltered), null, {
    timeout: 60000
  });

  // Ensure library is loaded (grid may already have models from prior session)
  await page.evaluate(async () => {
    try {
      await window.electron.saveSetting?.('hasRunBefore', 'true');
      await window.electron.saveSetting?.('tosAcceptedDate', new Date().toISOString());
    } catch (_) {}
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    } else if (typeof window.loadModels === 'function') {
      await window.loadModels();
    }
  });

  await page.waitForSelector('.file-grid', { timeout: 60000 });
  await page.waitForTimeout(2000);

  const grid = page.locator('.file-grid');
  const scrollHeights = await grid.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight
  }));
  console.log('grid sizes', scrollHeights, 'mem', dockerMem());

  // Rapid scroll through the virtual grid
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    await grid.evaluate((el, step) => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.floor((max * step) / 30);
    }, i);
    await page.waitForTimeout(150);
    if (i % 5 === 0) {
      console.log(`scroll ${i}/${steps} mem=${dockerMem()} state=${dockerState()} timeouts=${timeouts.length}`);
    }
  }

  // Settle
  await page.waitForTimeout(5000);
  console.log('after', dockerState(), dockerMem());
  console.log('IPC timeouts', timeouts.length, timeouts.slice(0, 5));
  console.log(
    'console errors sample',
    errors.filter((e) => /Bridge|timeout|WebSocket|OOM|heap/i.test(e)).slice(0, 10)
  );

  await browser.close();

  if (!/running=true/.test(dockerState()) || /oom=true/.test(dockerState())) {
    console.error('FAIL: container died');
    process.exit(1);
  }
  if (timeouts.length > 5) {
    console.error('FAIL: too many IPC timeouts while scrolling');
    process.exit(1);
  }
  console.log('PASS: UI scroll completed without container crash');
})().catch((e) => {
  console.error('FAIL', e.message || e, dockerState(), dockerMem());
  process.exit(1);
});
