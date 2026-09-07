/**
 * Model-page metadata extraction. Prefers catalog ID, embedded JSON, and
 * JSON-LD over CSS selectors (those go stale on MakerWorld/Thangs SPAs).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.PrintventoryExtract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function trimText(value, max) {
    if (value == null) return null;
    const t = String(value).replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return max && t.length > max ? t.slice(0, max) : t;
  }

  function normalizeLicense(text) {
    const t = trimText(text, 400);
    if (!t) return null;
    const lower = t.toLowerCase();
    if (/standard digital file|personal use|non[-\s]?commercial/.test(lower)) return 'For Personal Use';
    if (/creative commons|cc[-\s]?by|cc0/.test(lower)) return 'Creative Commons';
    if (/commercial/.test(lower)) return 'Commercial Use Allowed';
    return t;
  }

  function parseCatalog(href) {
    let u;
    try {
      u = new URL(href);
    } catch (e) {
      return null;
    }
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    const out = { href: u.href, host, path, site: null, id: null, slugTitle: null, isModelPage: false, canonicalHref: u.href };

    if (host.includes('makerworld.com')) {
      out.site = 'makerworld';
      const m = path.match(/^((?:\/[a-z]{2})?\/models\/(\d+)(?:-([^/?#]+))?)/i);
      if (m) {
        out.id = m[2];
        out.slugTitle = slugToTitle(m[3]);
        out.isModelPage = true;
        out.canonicalHref = u.origin + m[1];
      }
      return out;
    }
    if (host.includes('printables.com')) {
      out.site = 'printables';
      const m = path.match(/^((?:\/[a-z]{2})?\/(?:prints|model)\/(\d+)(?:-([^/?#]+))?)/i);
      if (m) {
        out.id = m[2];
        out.slugTitle = slugToTitle(m[3]);
        out.isModelPage = true;
        out.canonicalHref = u.origin + m[1];
      }
      return out;
    }
    if (host.includes('thingiverse.com')) {
      out.site = 'thingiverse';
      const m = path.match(/\/thing[:/](\d+)/i);
      if (m) {
        out.id = m[1];
        out.isModelPage = true;
        out.canonicalHref = u.origin + '/thing:' + m[1];
      }
      return out;
    }
    if (host.includes('thangs.com')) {
      out.site = 'thangs';
      out.isModelPage = /\/(model|design|3d-model)\//i.test(path);
      const m = path.match(/\/(?:model|design|3d-model)\/([^/?#]+)/i);
      if (m) out.slugTitle = slugToTitle(m[1]);
      return out;
    }
    if (host.includes('cults3d.com')) {
      out.site = 'cults3d';
      out.isModelPage = /\/(3d-model|design)\//i.test(path);
      const m = path.match(/\/(?:3d-model|design)\/([^/?#]+)/i);
      if (m) out.slugTitle = slugToTitle(m[1]);
      return out;
    }
    if (host.includes('myminifactory.com')) {
      out.site = 'myminifactory';
      out.isModelPage = /\/object\//i.test(path);
      const m = path.match(/\/object\/([^/?#]+)/i);
      if (m) out.slugTitle = slugToTitle(m[1]);
      return out;
    }
    return out;
  }

  function slugToTitle(slug) {
    if (!slug) return null;
    let raw = String(slug).replace(/\+/g, ' ');
    try {
      raw = decodeURIComponent(raw);
    } catch (e) { /* keep raw */ }
    const t = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t || null;
  }

  function attr(el, name) {
    if (!el) return null;
    if (typeof el.getAttribute === 'function') {
      const v = el.getAttribute(name);
      if (v) return v;
    }
    return el[name] || null;
  }

  function metaContent(doc, key, value) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    const el =
      doc.querySelector('meta[' + key + '="' + value + '"]') ||
      doc.querySelector("meta[" + key + "='" + value + "']");
    return trimText(attr(el, 'content'), 2000);
  }

  function readJsonLd(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    const nodes = [];
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    const list = scripts && scripts.length != null ? scripts : [];
    for (let i = 0; i < list.length; i++) {
      const text = list[i] && list[i].textContent;
      if (!text) continue;
      try {
        const data = JSON.parse(text);
        const arr = Array.isArray(data) ? data : [data];
        for (let j = 0; j < arr.length; j++) {
          const item = arr[j];
          if (!item) continue;
          if (item['@graph'] && Array.isArray(item['@graph'])) {
            for (let k = 0; k < item['@graph'].length; k++) nodes.push(item['@graph'][k]);
          } else {
            nodes.push(item);
          }
        }
      } catch (e) { /* ignore bad JSON-LD */ }
    }
    return nodes;
  }

  function typeIncludes(node, name) {
    const t = node && node['@type'];
    if (!t) return false;
    if (typeof t === 'string') return t.toLowerCase() === name.toLowerCase();
    if (Array.isArray(t)) return t.some((x) => String(x).toLowerCase() === name.toLowerCase());
    return false;
  }

  function personName(value) {
    if (!value) return null;
    if (typeof value === 'string') return trimText(value, 200);
    if (Array.isArray(value)) return personName(value[0]);
    return trimText(value.name || value.alternateName || value.nickname, 200);
  }

  function fromJsonLd(nodes) {
    const product = nodes.find((n) => typeIncludes(n, 'Product') || typeIncludes(n, '3DModel'))
      || nodes.find((n) => n && n.name && !typeIncludes(n, 'WebSite') && !typeIncludes(n, 'Organization'));
    if (!product) return {};
    return {
      parentModel: trimText(product.name, 300),
      notes: trimText(product.description, 5000),
      designer: personName(product.author || product.creator || product.brand),
      license: normalizeLicense(product.license)
    };
  }

  function readNextData(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    const el = doc.querySelector('#__NEXT_DATA__') || doc.querySelector('script#__NEXT_DATA__');
    if (!el || !el.textContent) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  function findObjectById(obj, id, depth) {
    if (!obj || depth > 14) return null;
    if (typeof obj !== 'object') return null;
    if (!Array.isArray(obj) && String(obj.id) === String(id) && (obj.title || obj.name || obj.designTitle || obj.modelName)) {
      return obj;
    }
    const values = Array.isArray(obj) ? obj : Object.keys(obj).map((k) => obj[k]);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v && typeof v === 'object') {
        const found = findObjectById(v, id, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function fromModelObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const creator = obj.designCreator || obj.designer || obj.author || obj.user || obj.creator || obj.profile;
    return {
      parentModel: trimText(obj.designTitle || obj.modelName || obj.title || obj.name || obj.printName, 300),
      designer: personName(creator) || trimText(obj.authorName || obj.designerName || obj.nickname, 200),
      notes: trimText(obj.summary || obj.description || obj.desc || obj.modelDescription, 5000),
      license: normalizeLicense(obj.licenseTitle || obj.licenseName || obj.license)
    };
  }

  function fromNextData(nextData, catalog) {
    if (!nextData) return {};
    if (catalog && catalog.id) {
      const hit = findObjectById(nextData, catalog.id, 0);
      if (hit) return fromModelObject(hit);
    }
    const pageProps = nextData.props && nextData.props.pageProps;
    if (pageProps) {
      const candidate = pageProps.designDetail || pageProps.model || pageProps.print || pageProps.thing || pageProps.data;
      const fromProps = fromModelObject(candidate);
      if (fromProps.parentModel || fromProps.designer) return fromProps;
    }
    return {};
  }

  function ogBlock(doc, catalog) {
    const ogTitle = metaContent(doc, 'property', 'og:title') || metaContent(doc, 'name', 'twitter:title');
    const ogDesc = metaContent(doc, 'property', 'og:description') || metaContent(doc, 'name', 'twitter:description');
    const ogUrl = metaContent(doc, 'property', 'og:url');
    const ogSite = metaContent(doc, 'property', 'og:site_name');
    if (catalog && catalog.id && ogUrl && !String(ogUrl).includes(catalog.id)) {
      return {};
    }
    let title = trimText(ogTitle, 300);
    if (title && ogSite) {
      const stripped = title.replace(new RegExp('\\s*[|–·-]\\s*' + ogSite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'i'), '').trim();
      if (stripped) title = stripped;
    }
    if (title && /^(makerworld|printables|thingiverse|thangs|cults3d|myminifactory)$/i.test(title)) {
      title = null;
    }
    return {
      parentModel: title,
      notes: trimText(ogDesc, 5000)
    };
  }

  function firstText(doc, selectors) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    for (let i = 0; i < selectors.length; i++) {
      const el = doc.querySelector(selectors[i]);
      const t = el && trimText(el.textContent, 5000);
      if (t) return t;
    }
    return null;
  }

  function fromDom(doc, site) {
    const titleSels = ['main h1', '[role="main"] h1', 'article h1', 'h1'];
    const designerSels = site === 'thingiverse'
      ? ['main a[href*="/users/"]', 'a[href*="/users/"]']
      : site === 'printables'
        ? ['a[href*="/social/"]', 'a[href*="/@"]', 'main a[href*="/user/"]', 'a[href*="/user/"]']
        : ['main a[href*="/user/"]', 'main a[href*="/users/"]', 'a[href*="/user/"]', 'a[href*="/users/"]'];
    const descSels = [
      'main [class*="Description"]',
      'article [class*="description"]',
      '[itemprop="description"]',
      '.thing-description'
    ];
    return {
      parentModel: firstText(doc, titleSels),
      designer: firstText(doc, designerSels),
      notes: firstText(doc, descSels)
    };
  }

  function mergeFields() {
    const out = {};
    for (let i = 0; i < arguments.length; i++) {
      const part = arguments[i];
      if (!part) continue;
      ['parentModel', 'designer', 'notes', 'license'].forEach((key) => {
        if (out[key] == null && part[key]) out[key] = part[key];
      });
    }
    return out;
  }

  function extractFromDocument(href, doc) {
    const catalog = parseCatalog(href) || { href: href, isModelPage: false };
    if (!catalog.isModelPage) return null;
    const merged = mergeFields(
      fromNextData(readNextData(doc), catalog),
      fromJsonLd(readJsonLd(doc)),
      ogBlock(doc, catalog),
      { parentModel: catalog.slugTitle },
      fromDom(doc, catalog.site)
    );
    const pageUrl = catalog.canonicalHref || catalog.href;
    return {
      url: pageUrl,
      source: pageUrl,
      catalogId: catalog.id || null,
      site: catalog.site,
      designer: merged.designer || null,
      parentModel: merged.parentModel || 'Unknown',
      notes: merged.notes || null,
      license: merged.license || 'Unknown'
    };
  }

  function unwrapJson(data) {
    if (!data || typeof data !== 'object') return data;
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
    return data;
  }

  async function tryFetchJson(fetchFn, url) {
    if (!fetchFn) return null;
    try {
      const res = await fetchFn(url, { credentials: 'include' });
      if (!res || !res.ok) return null;
      return unwrapJson(await res.json());
    } catch (e) {
      return null;
    }
  }

  function stripHtml(html) {
    if (!html) return null;
    return trimText(String(html).replace(/<[^>]+>/g, ' '), 5000);
  }

  function fromPrintablesPrint(print) {
    if (!print || typeof print !== 'object') return {};
    const user = print.user || {};
    const license = print.license || {};
    return {
      parentModel: trimText(print.name, 300),
      designer: trimText(user.publicUsername || user.handle || user.displayName, 200),
      notes: stripHtml(print.description) || stripHtml(print.summary),
      license: trimText(license.name, 240) || normalizeLicense(license.name)
    };
  }

  function fromMakerWorldDesign(design) {
    if (!design || typeof design !== 'object') return {};
    const mapped = fromModelObject(design);
    return {
      parentModel: mapped.parentModel || trimText(design.title, 300),
      designer: mapped.designer || personName(design.designCreator),
      notes: stripHtml(design.summary) || mapped.notes,
      license: trimText(design.license, 240) || mapped.license
    };
  }

  async function fetchMakerWorldDesign(id, fetchFn, origin) {
    const urls = [
      (origin || 'https://makerworld.com') + '/api/v1/design-service/design/' + id,
      'https://makerworld.com/api/v1/design-service/design/' + id,
      'https://api.bambulab.com/v1/design-service/design/' + id
    ];
    const seen = {};
    for (let i = 0; i < urls.length; i++) {
      if (seen[urls[i]]) continue;
      seen[urls[i]] = true;
      const data = await tryFetchJson(fetchFn, urls[i]);
      if (data && (data.title || data.designCreator || data.license)) return data;
    }
    return null;
  }

  async function fetchPrintablesPrint(id, fetchFn) {
    const query = 'query PrintProfile($id: ID!) { print(id: $id) { id name slug summary description user { handle publicUsername } license { id name } } }';
    try {
      const res = await fetchFn('https://api.printables.com/graphql/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: 'PrintProfile',
          query: query,
          variables: { id: String(id) }
        })
      });
      if (!res || !res.ok) return null;
      const json = await res.json();
      return json && json.data && json.data.print ? json.data.print : null;
    } catch (e) {
      return null;
    }
  }

  async function enrichFromApi(catalog, fetchFn) {
    if (!catalog || !catalog.isModelPage || !fetchFn) return {};
    let origin;
    try {
      origin = new URL(catalog.href || catalog.canonicalHref || 'https://example.com').origin;
    } catch (e) {
      origin = '';
    }
    if (catalog.site === 'printables' && catalog.id) {
      const print = await fetchPrintablesPrint(catalog.id, fetchFn);
      return fromPrintablesPrint(print);
    }
    if (catalog.site === 'makerworld' && catalog.id) {
      const design = await fetchMakerWorldDesign(catalog.id, fetchFn, origin);
      return fromMakerWorldDesign(design);
    }
    return {};
  }

  async function extractPage(href, doc, fetchFn) {
    const catalog = parseCatalog(href);
    if (!catalog || !catalog.isModelPage) return null;
    const pageUrl = catalog.canonicalHref || catalog.href;
    const base = extractFromDocument(href, doc) || {
      url: pageUrl,
      source: pageUrl,
      catalogId: catalog.id || null,
      site: catalog.site,
      designer: null,
      parentModel: catalog.slugTitle || 'Unknown',
      notes: null,
      license: 'Unknown'
    };
    const api = await enrichFromApi(catalog, fetchFn);
    const merged = mergeFields(api, {
      parentModel: base.parentModel === 'Unknown' ? null : base.parentModel,
      designer: base.designer,
      notes: base.notes,
      license: base.license === 'Unknown' ? null : base.license
    });
    return {
      url: pageUrl,
      source: pageUrl,
      catalogId: catalog.id || null,
      site: catalog.site,
      designer: merged.designer || null,
      parentModel: merged.parentModel || base.parentModel || 'Unknown',
      notes: merged.notes || null,
      license: merged.license || 'Unknown'
    };
  }

  function metadataFromUrl(href) {
    const catalog = parseCatalog(href);
    if (!catalog || !catalog.isModelPage) return null;
    const pageUrl = catalog.canonicalHref || catalog.href;
    return {
      url: pageUrl,
      source: pageUrl,
      catalogId: catalog.id || null,
      site: catalog.site,
      designer: null,
      parentModel: catalog.slugTitle || 'Unknown',
      notes: null,
      license: 'Unknown'
    };
  }

  return {
    parseCatalog: parseCatalog,
    slugToTitle: slugToTitle,
    normalizeLicense: normalizeLicense,
    extractFromDocument: extractFromDocument,
    extractPage: extractPage,
    enrichFromApi: enrichFromApi,
    metadataFromUrl: metadataFromUrl,
    fromJsonLd: fromJsonLd,
    fromNextData: fromNextData,
    fromModelObject: fromModelObject,
    fromPrintablesPrint: fromPrintablesPrint,
    fromMakerWorldDesign: fromMakerWorldDesign
  };
});
