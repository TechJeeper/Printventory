/**
 * Live Docker server-mode regression for GitHub #72.
 * Calls parse3MFPreview over the WebSocket bridge and asserts geometry
 * attribute arrays arrive as real arrays (not numeric-key objects).
 */
const { test, expect, chromium } = require('@playwright/test');

const BASE = process.env.PRINTVENTORY_DOCKER_URL || 'http://127.0.0.1:5000';
const MODEL_PATH =
  process.env.PRINTVENTORY_3MF_PATH ||
  '/mnt/test_files/BOB_Knitted_Short_Wide_Bowl - Copy (2).3mf';

test.describe('Docker 3MF preview typed arrays (#72)', () => {
  test.setTimeout(180000);

  test('parse3MFPreview returns Array.isArray geometry buffers', async () => {
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'
    });
    const page = await browser.newPage();

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

    for (const label of ['I Agree', 'Accept', 'Get Started!', 'Close', 'OK']) {
      const btn = page.locator(`button:has-text("${label}")`).first();
      try {
        if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 });
      } catch (_) {}
    }

    await page.waitForFunction(
      () => !!(window.electron && window.electron.parse3MFPreview),
      null,
      { timeout: 60000 }
    );

    const result = await page.evaluate(async (filePath) => {
      const requestId = `issue72_${Date.now()}`;
      const json = await window.electron.parse3MFPreview(filePath, requestId);
      if (!json) return { ok: false, error: 'null result' };
      if (!json.geometries || !json.geometries.length) {
        return { ok: false, error: 'no geometries', keys: Object.keys(json) };
      }

      const geom = json.geometries[0];
      const data = geom && geom.data;
      const position = data && data.attributes && data.attributes.position;
      const normal = data && data.attributes && data.attributes.normal;
      const index = data && data.index;

      const positionArray = position && position.array;
      const rebuilt = positionArray != null ? new Float32Array(positionArray) : null;

      return {
        ok: true,
        positionIsArray: Array.isArray(positionArray),
        positionType: positionArray == null ? null : Object.prototype.toString.call(positionArray),
        positionLength: Array.isArray(positionArray)
          ? positionArray.length
          : positionArray && typeof positionArray === 'object'
            ? Object.keys(positionArray).length
            : 0,
        rebuiltLength: rebuilt ? rebuilt.length : 0,
        normalIsArray: !!(normal && Array.isArray(normal.array)),
        indexIsArray: !!(index && Array.isArray(index.array)),
        indexLength: index && Array.isArray(index.array) ? index.array.length : 0
      };
    }, MODEL_PATH);

    console.log('parse3MFPreview check:', JSON.stringify(result, null, 2));

    expect(result.ok, `parse failed: ${JSON.stringify(result)}`).toBeTruthy();
    expect(result.positionIsArray, 'position.array must be a real Array after WS transport').toBe(true);
    expect(result.rebuiltLength, 'Float32Array(position.array) must be non-empty').toBeGreaterThan(0);
    expect(result.positionLength).toBe(result.rebuiltLength);
    expect(result.normalIsArray).toBe(true);
    expect(result.indexIsArray).toBe(true);
    expect(result.indexLength).toBeGreaterThan(0);

    await browser.close();
  });
});
