/**
 * Site-specific scrapers for designer, title (parent model), description (notes), license.
 * Selectors may need updating when sites change.
 */

/**
 * MakerWorld model URLs: /en/models/12345-slug-here — use slug if DOM titles are wrong (e.g. first h1 is a related model).
 */
function makerWorldTitleFromUrl() {
  const m = window.location.pathname.match(/\/models\/\d+-([^/?#]+)/i);
  if (!m || !m[1]) return null;
  const raw = m[1].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw.replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
  } catch (e) {
    return raw.replace(/-/g, ' ').trim();
  }
}

function metaContent(sel) {
  const el = document.querySelector(sel);
  const t = el && el.getAttribute('content');
  return t && t.trim() ? t.trim() : null;
}

const SCRAPERS = {
  'makerworld.com': {
    isModelPage: () => /\/models\/\d+/i.test(window.location.pathname),
    designer: () => {
      const inMain =
        document.querySelector('main a[href*="/user/"]') ||
        document.querySelector('[class*="ModelHeader"] a[href*="/user/"]') ||
        document.querySelector('[class*="ModelInfo"] a[href*="/user/"]') ||
        document.querySelector('article a[href*="/user/"]');
      const el = inMain ||
        document.querySelector('a[href*="/user/"]') ||
        document.querySelector('[class*="Designer"] a') ||
        document.querySelector('a[class*="ProfileLink"]');
      return el ? el.textContent.trim() : null;
    },
    title: () => {
      // URL slug is the only reliable anchor for the *current* model: og/h1 can be stale (SPA) or
      // point at a promoted/related model (e.g. "SVG to Stencil generator") while the path is correct.
      const fromUrl = makerWorldTitleFromUrl();
      if (fromUrl) return fromUrl;
      const og = metaContent('meta[property="og:title"]') || metaContent('meta[name="twitter:title"]');
      if (og) {
        const strip = og.replace(/\s*[\|–-]\s*MakerWorld.*$/i, '').replace(/\s*·\s*MakerWorld.*$/i, '').trim();
        if (strip) return strip;
      }
      const scoped =
        document.querySelector('main h1') ||
        document.querySelector('[role="main"] h1') ||
        document.querySelector('article h1') ||
        document.querySelector('h1[class*="ModelTitle"]') ||
        document.querySelector('[class*="ModelHeader"] h1') ||
        document.querySelector('[class*="modelDetail"] h1') ||
        document.querySelector('[class*="ModelTitle"]') ||
        document.querySelector('h1[class*="title"]');
      if (scoped) {
        const t = scoped.textContent.trim();
        if (t) return t;
      }
      if (document.title) {
        const d = document.title
          .replace(/\s*[\|–-]\s*MakerWorld.*$/i, '')
          .replace(/\s*·\s*MakerWorld.*$/i, '')
          .trim();
        if (d) return d;
      }
      return null;
    },
    description: () => {
      const el =
        document.querySelector('main [class*="ModelDescription"]') ||
        document.querySelector('main [class*="Description"]') ||
        document.querySelector('article [class*="Description"]') ||
        document.querySelector('[class*="ModelDetail"] [class*="Description"]') ||
        document.querySelector('[class*="Description"]') ||
        document.querySelector('[class*="description"]') ||
        document.querySelector('.description, [data-testid="description"]');
      return el ? el.textContent.trim().slice(0, 5000) : null;
    },
    license: () => {
      const main = document.querySelector('main');
      const text = (main && main.innerText) ? main.innerText.toLowerCase() : ((document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '');
      if (text.includes('personal use') || text.includes('non-commercial')) return 'For Personal Use';
      if (text.includes('creative commons')) return 'Creative Commons';
      if (text.includes('commercial use') || text.includes('commercial license')) return 'Commercial Use Allowed';
      return 'Unknown';
    }
  },
  'thangs.com': {
    isModelPage: () => /\/model\//i.test(window.location.pathname) || /\/design\//i.test(window.location.pathname) || /\/3d-model\//i.test(window.location.pathname) || /\/designer\/[^/]+\/3d-model\//i.test(window.location.pathname),
    designer: () => {
      const el = document.querySelector('a[class*="ModelDesigner_ProfileLink"]') ||
        document.querySelector('a[href*="/user/"]') ||
        document.querySelector('[class*="designer"] a');
      return el ? el.textContent.trim() : null;
    },
    title: () => {
      const el = document.querySelector('div[class*="ModelTitle_Text"]') ||
        document.querySelector('h1') ||
        document.querySelector('[class*="model-title"]');
      return el ? el.textContent.trim() : document.title || null;
    },
    description: () => {
      const el = document.querySelector('div[class*="ModelDescription"]') ||
        document.querySelector('[class*="description"]');
      return el ? el.textContent.trim().slice(0, 5000) : null;
    },
    license: () => {
      const desc = document.querySelector('div[class*="ModelDescription"]');
      const text = desc ? desc.textContent.toLowerCase() : (document.body ? document.body.innerText.toLowerCase() : '');
      if (text.includes('personal use')) return 'For Personal Use';
      if (text.includes('creative commons')) return 'Creative Commons';
      if (text.includes('commercial use')) return 'Commercial Use Allowed';
      return 'Unknown';
    }
  },
  'printables.com': {
    isModelPage: () => /\/prints\/\d+/i.test(window.location.pathname) || /\/model\/\d+/i.test(window.location.pathname),
    designer: () => {
      const el = document.querySelector('a[href*="/user/"]') ||
        document.querySelector('[class*="author"] a') ||
        document.querySelector('[class*="creator"] a');
      return el ? el.textContent.trim() : null;
    },
    title: () => {
      const el = document.querySelector('h1') ||
        document.querySelector('[class*="title"]');
      return el ? el.textContent.trim() : document.title || null;
    },
    description: () => {
      const el = document.querySelector('[class*="description"]') ||
        document.querySelector('.description, [itemprop="description"]');
      return el ? el.textContent.trim().slice(0, 5000) : null;
    },
    license: () => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      if (text.includes('non-commercial') || text.includes('personal use')) return 'For Personal Use';
      if (text.includes('creative commons')) return 'Creative Commons';
      if (text.includes('commercial')) return 'Commercial Use Allowed';
      return 'Unknown';
    }
  },
  'thingiverse.com': {
    isModelPage: () => /\/thing:\d+/i.test(window.location.pathname) || /\/thing\/\d+/i.test(window.location.pathname),
    designer: () => {
      const el = document.querySelector('a[href*="/users/"]') ||
        document.querySelector('[class*="Creator"] a') ||
        document.querySelector('.creator a');
      return el ? el.textContent.trim() : null;
    },
    title: () => {
      const el = document.querySelector('h1') ||
        document.querySelector('[class*="ThingPageHeader"] h1') ||
        document.querySelector('.thing-header h1');
      return el ? el.textContent.trim() : document.title || null;
    },
    description: () => {
      const el = document.querySelector('[class*="description"]') ||
        document.querySelector('.description, .thing-description');
      return el ? el.textContent.trim().slice(0, 5000) : null;
    },
    license: () => {
      const el = document.querySelector('[class*="license"]') ||
        document.querySelector('a[href*="creativecommons"]');
      if (el) {
        const t = el.textContent.toLowerCase();
        if (t.includes('cc') || t.includes('creative commons')) return 'Creative Commons';
        if (t.includes('non-commercial')) return 'For Personal Use';
        if (t.includes('commercial')) return 'Commercial Use Allowed';
      }
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      if (text.includes('non-commercial')) return 'For Personal Use';
      if (text.includes('creative commons')) return 'Creative Commons';
      if (text.includes('commercial')) return 'Commercial Use Allowed';
      return 'Unknown';
    }
  },
  'cults3d.com': {
    isModelPage: () => /\/3d-model\//i.test(window.location.pathname) || /\/design\//i.test(window.location.pathname),
    designer: () => {
      const el = document.querySelector('a[href*="/users/"]') ||
        document.querySelector('[class*="creator"] a') ||
        document.querySelector('.creator a, [class*="designer"] a');
      return el ? el.textContent.trim() : null;
    },
    title: () => {
      const el = document.querySelector('h1') ||
        document.querySelector('[class*="title"]');
      return el ? el.textContent.trim() : document.title || null;
    },
    description: () => {
      const el = document.querySelector('[class*="description"]') ||
        document.querySelector('.description');
      return el ? el.textContent.trim().slice(0, 5000) : null;
    },
    license: () => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      if (text.includes('personal use') || text.includes('non-commercial')) return 'For Personal Use';
      if (text.includes('creative commons')) return 'Creative Commons';
      if (text.includes('commercial')) return 'Commercial Use Allowed';
      return 'Unknown';
    }
  },
  'myminifactory.com': {
    isModelPage: () => /\/object\//i.test(window.location.pathname),
    designer: () => {
      const el = document.querySelector('a[href*="/user/"]') ||
        document.querySelector('[class*="creator"] a') ||
        document.querySelector('.creator a');
      return el ? el.textContent.trim() : null;
    },
    title: () => {
      const el = document.querySelector('h1') ||
        document.querySelector('[class*="title"]');
      return el ? el.textContent.trim() : document.title || null;
    },
    description: () => {
      const el = document.querySelector('[class*="description"]') ||
        document.querySelector('.description');
      return el ? el.textContent.trim().slice(0, 5000) : null;
    },
    license: () => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      if (text.includes('personal use') || text.includes('non-commercial')) return 'For Personal Use';
      if (text.includes('creative commons')) return 'Creative Commons';
      if (text.includes('commercial')) return 'Commercial Use Allowed';
      return 'Unknown';
    }
  }
};

function getScraperForHost() {
  const host = window.location.hostname.toLowerCase();
  for (const domain of Object.keys(SCRAPERS)) {
    if (host.includes(domain)) return SCRAPERS[domain];
  }
  return null;
}

function scrapePage() {
  const scraper = getScraperForHost();
  if (!scraper || !scraper.isModelPage()) return null;
  // Use current page URL for source so the model page URL is always correct (canonical can differ or be stale)
  const pageUrl = window.location.href;
  const designer = scraper.designer();
  const title = scraper.title();
  const description = scraper.description();
  const license = scraper.license();
  const out = {
    url: pageUrl,
    designer: designer || null,
    parentModel: title || 'Unknown',
    notes: description || null,
    license: license || 'Unknown',
    source: pageUrl
  };
  if (typeof self !== 'undefined' && typeof self.pvLog === 'function') {
    self.pvLog('scrapePage', {
      href: pageUrl,
      parentModel: out.parentModel,
      designer: out.designer,
      license: out.license,
      notes: typeof self.pvShort === 'function' ? self.pvShort(out.notes, 150) : out.notes
    });
  }
  return out;
}
