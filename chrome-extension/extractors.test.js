#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const extract = require(path.join(__dirname, 'extractors.js'));

let failed = 0;

function ok(name) {
  console.log('ok ' + name);
}

function fail(name, err) {
  failed += 1;
  console.error('FAIL ' + name + ':', err && err.message ? err.message : err);
}

function test(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      return ret.then(() => ok(name)).catch((err) => fail(name, err));
    }
    ok(name);
    return Promise.resolve();
  } catch (err) {
    fail(name, err);
    return Promise.resolve();
  }
}

function el(attrs, text) {
  return {
    textContent: text || '',
    getAttribute: function (name) {
      return attrs && attrs[name] != null ? attrs[name] : null;
    }
  };
}

function makeDoc(spec) {
  spec = spec || {};
  const metas = spec.metas || [];
  const jsonLd = spec.jsonLd || [];
  const nextData = spec.nextData || null;
  const nodes = spec.nodes || {};
  return {
    title: spec.title || '',
    querySelector: function (sel) {
      if (sel === '#__NEXT_DATA__' || sel === 'script#__NEXT_DATA__') {
        return nextData ? el({}, JSON.stringify(nextData)) : null;
      }
      const metaMatch = sel.match(/^meta\[(\w+)="([^"]+)"\]$/);
      if (metaMatch) {
        const hit = metas.find((m) => m[metaMatch[1]] === metaMatch[2]);
        return hit ? el({ content: hit.content }) : null;
      }
      if (nodes[sel]) return el({}, nodes[sel]);
      return null;
    },
    querySelectorAll: function (sel) {
      if (sel === 'script[type="application/ld+json"]') {
        return jsonLd.map((j) => el({}, JSON.stringify(j)));
      }
      return [];
    }
  };
}

async function run() {
  await test('parseCatalog makerworld id and slug', () => {
    const c = extract.parseCatalog('https://makerworld.com/en/models/12345-cool-bracket');
    assert.strictEqual(c.site, 'makerworld');
    assert.strictEqual(c.id, '12345');
    assert.strictEqual(c.slugTitle, 'cool bracket');
    assert.strictEqual(c.isModelPage, true);
  });

  await test('parseCatalog rejects makerworld listing', () => {
    const c = extract.parseCatalog('https://makerworld.com/en/models');
    assert.strictEqual(c.isModelPage, false);
  });

  await test('parseCatalog printables and thingiverse', () => {
    assert.strictEqual(extract.parseCatalog('https://www.printables.com/model/99-hook').id, '99');
    assert.strictEqual(extract.parseCatalog('https://www.thingiverse.com/thing:4242').id, '4242');
  });

  await test('printables /files is still a model page with canonical URL', () => {
    const href = 'https://www.printables.com/model/1810030-removable-cabinet-door-organizer-dishwasher-tablet/files';
    const c = extract.parseCatalog(href);
    assert.strictEqual(c.isModelPage, true);
    assert.strictEqual(c.id, '1810030');
    assert.strictEqual(c.canonicalHref, 'https://www.printables.com/model/1810030-removable-cabinet-door-organizer-dishwasher-tablet');
    const meta = extract.metadataFromUrl(href);
    assert.strictEqual(meta.source, c.canonicalHref);
    assert.ok(meta.parentModel.toLowerCase().includes('cabinet door organizer'));
  });

  await test('normalizeLicense keywords', () => {
    assert.strictEqual(extract.normalizeLicense('For personal use only'), 'For Personal Use');
    assert.strictEqual(extract.normalizeLicense('CC BY 4.0'), 'Creative Commons');
  });

  await test('JSON-LD Product wins over leftover h1', () => {
    const doc = makeDoc({
      jsonLd: [{
        '@type': 'Product',
        name: 'Gridfinity Bin',
        description: 'A useful bin',
        author: { '@type': 'Person', name: 'Jane' },
        license: 'CC BY'
      }],
      nodes: { 'main h1': 'Related model ad' }
    });
    const out = extract.extractFromDocument('https://www.printables.com/model/10-gridfinity-bin', doc);
    assert.strictEqual(out.parentModel, 'Gridfinity Bin');
    assert.strictEqual(out.designer, 'Jane');
    assert.strictEqual(out.license, 'Creative Commons');
    assert.strictEqual(out.notes, 'A useful bin');
  });

  await test('Next data object matching catalog id beats stale og:title', () => {
    const doc = makeDoc({
      metas: [
        { property: 'og:title', content: 'SVG to Stencil generator | MakerWorld' },
        { property: 'og:url', content: 'https://makerworld.com/en/models/999-other' },
        { property: 'og:site_name', content: 'MakerWorld' }
      ],
      nextData: {
        props: {
          pageProps: {
            extra: { id: 555, title: 'Cable Clip', designCreator: { name: 'Alex' }, licenseTitle: 'Standard Digital File License' }
          }
        }
      }
    });
    const out = extract.extractFromDocument('https://makerworld.com/en/models/555-cable-clip', doc);
    assert.strictEqual(out.parentModel, 'Cable Clip');
    assert.strictEqual(out.designer, 'Alex');
    assert.strictEqual(out.license, 'For Personal Use');
  });

  await test('stale og:url with other id is ignored; slug is used', () => {
    const doc = makeDoc({
      metas: [
        { property: 'og:title', content: 'Wrong related model | MakerWorld' },
        { property: 'og:url', content: 'https://makerworld.com/en/models/1-wrong' },
        { property: 'og:site_name', content: 'MakerWorld' }
      ]
    });
    const out = extract.extractFromDocument('https://makerworld.com/en/models/777-my-widget', doc);
    assert.strictEqual(out.parentModel, 'my widget');
  });

  await test('MakerWorld design-service API maps designer license notes', async () => {
    const doc = makeDoc({});
    const fetchFn = async (url) => {
      if (!String(url).includes('/design-service/design/')) return { ok: false };
      return {
        ok: true,
        json: async () => ({
          title: 'Dual blade bed scraper',
          summary: '<p>A door handle scraper.</p>',
          license: 'Standard Digital File License',
          designCreator: { name: 'AndresMakes', handle: 'AndresMakes' }
        })
      };
    };
    const out = await extract.extractPage(
      'https://makerworld.com/en/models/1817533-dual-blade-bed-scraper/files',
      doc,
      fetchFn
    );
    assert.strictEqual(out.parentModel, 'Dual blade bed scraper');
    assert.strictEqual(out.designer, 'AndresMakes');
    assert.ok(out.notes && out.notes.toLowerCase().includes('door handle'));
    assert.ok(out.license && /standard digital|personal use/i.test(out.license));
  });

  await test('Printables GraphQL maps designer license notes', async () => {
    const doc = makeDoc({});
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({
        data: {
          print: {
            name: 'Black Hole Lamp',
            summary: 'Second version is out.',
            description: '<p>A lamp.</p>',
            user: { handle: 'NAM3Designs', publicUsername: 'NAM_3' },
            license: { id: '4', name: 'Creative Commons — Attribution — Noncommercial — Share Alike' }
          }
        }
      })
    });
    const out = await extract.extractPage(
      'https://www.printables.com/model/1817533-black-hole-lamp/files',
      doc,
      fetchFn
    );
    assert.strictEqual(out.parentModel, 'Black Hole Lamp');
    assert.strictEqual(out.designer, 'NAM_3');
    assert.ok(out.notes && out.notes.toLowerCase().includes('a lamp'));
    assert.ok(out.license && /creative commons/i.test(out.license));
    assert.strictEqual(out.source, 'https://www.printables.com/model/1817533-black-hole-lamp');
  });

  await test('extractPage merges API fields first', async () => {
    const doc = makeDoc({});
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({
        data: { title: 'API Title', designCreator: { name: 'API User' }, summary: 'From API' }
      })
    });
    const out = await extract.extractPage('https://makerworld.com/en/models/42-slug', doc, fetchFn);
    assert.strictEqual(out.parentModel, 'API Title');
    assert.strictEqual(out.designer, 'API User');
    assert.strictEqual(out.notes, 'From API');
  });

  if (failed) process.exit(1);
}

run();
