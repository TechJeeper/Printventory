'use strict';

/**
 * Pull the thumbnail out of Fusion 360 .f3d archives.
 *
 * An .f3d file is a ZIP. Fusion stores the design thumbnail at
 *   FusionAssetName[Active]/Previews/small.png
 * ([Active] preferred). Entries use deflate (method 8) or Zstandard (method 93).
 *
 * Only the ZIP central directory and the one preview entry are read.
 */

const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const td = new TextDecoder('utf-8');

function toSource(input) {
  if (input instanceof Uint8Array) {
    return { size: input.length, read: async (o, n) => input.subarray(o, Math.min(input.length, o + n)) };
  }
  if (input instanceof ArrayBuffer) return toSource(new Uint8Array(input));
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return toSource(new Uint8Array(input));
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return { size: input.size, read: async (o, n) => new Uint8Array(await input.slice(o, o + n).arrayBuffer()) };
  }
  if (input && typeof input.read === 'function' && Number.isFinite(input.size)) return input;
  throw new TypeError('expected Uint8Array, ArrayBuffer, Blob, or { size, read(offset, length) }');
}

async function readExact(src, offset, length, what) {
  if (offset < 0 || offset + length > src.size) throw new Error(`${what} runs past end of file`);
  const b = await src.read(offset, length);
  if (b.length !== length) throw new Error(`short read for ${what}`);
  return b;
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

function inflateRaw(bytes) {
  return new Uint8Array(zlib.inflateRawSync(bytes));
}

function zstdDecompress(bytes, options) {
  if (typeof options?.zstd === 'function') {
    const out = options.zstd(bytes);
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  }
  if (typeof zlib.zstdDecompressSync === 'function') {
    return new Uint8Array(zlib.zstdDecompressSync(bytes));
  }
  throw new Error(
    'preview is Zstandard-compressed (ZIP method 93): needs Node >= 22.15, '
    + 'or pass { zstd: decompressFn }'
  );
}

async function readCentralDirectory(src) {
  const tailLen = Math.min(src.size, 22 + 0xffff);
  const tail = await readExact(src, src.size - tailLen, tailLen, 'end of archive');
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === SIG_EOCD) { e = i; break; }
  }
  if (e < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');

  let count = u16(tail, e + 10);
  let cdSize = u32(tail, e + 12);
  let cdOffset = u32(tail, e + 16);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = e - 20;
    if (loc < 0 || u32(tail, loc) !== SIG_EOCD64_LOC) throw new Error('ZIP64 locator missing');
    const eocd64Off = u64(tail, loc + 8);
    const r = await readExact(src, eocd64Off, 56, 'ZIP64 end record');
    if (u32(r, 0) !== SIG_EOCD64) throw new Error('bad ZIP64 end record');
    count = u64(r, 32);
    cdSize = u64(r, 40);
    cdOffset = u64(r, 48);
  }

  const cd = await readExact(src, cdOffset, cdSize, 'central directory');
  const entries = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== SIG_CEN) throw new Error('corrupt central directory');
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    let compSize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let localOffset = u32(cd, p + 42);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? td.decode(nameBytes) : String.fromCharCode(...nameBytes);

    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    for (let x = 0; x + 4 <= extra.length; ) {
      const id = u16(extra, x);
      const len = u16(extra, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) { size = u64(extra, q); q += 8; }
        if (compSize === 0xffffffff) { compSize = u64(extra, q); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = u64(extra, q); }
      }
      x += 4 + len;
    }
    entries.push({ name, flags, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(src, entry, options) {
  if (entry.flags & 0x1) throw new Error(`${entry.name} is encrypted`);
  const lh = await readExact(src, entry.localOffset, 30, 'local header');
  if (u32(lh, 0) !== SIG_LOC) throw new Error(`bad local header for ${entry.name}`);
  const dataStart = entry.localOffset + 30 + u16(lh, 26) + u16(lh, 28);
  const raw = await readExact(src, dataStart, entry.compSize, entry.name);

  let out;
  if (entry.method === 0) out = raw;
  else if (entry.method === 8) out = inflateRaw(raw);
  else if (entry.method === 93) out = zstdDecompress(raw, options);
  else throw new Error(`unsupported ZIP compression method ${entry.method} for ${entry.name}`);
  if (out.length !== entry.size) throw new Error(`${entry.name}: size mismatch (${out.length} != ${entry.size})`);
  return out;
}

function choosePreview(entries) {
  const files = entries.filter((e) => !e.name.endsWith('/'));
  const rank = (e) => {
    const n = e.name.toLowerCase();
    if (n === 'fusionassetname[active]/previews/small.png') return 0;
    if (/\[active\]\/previews\/[^/]+\.png$/.test(n)) return 1;
    if (/(^|\/)previews\/small\.png$/.test(n)) return 2;
    if (/(^|\/)previews\/[^/]+\.(png|jpe?g)$/.test(n)) return 3;
    return 99;
  };
  const best = files.map((e) => [rank(e), e]).filter(([r]) => r < 99).sort((a, b) => a[0] - b[0])[0];
  return best ? best[1] : null;
}

async function extractF3dPreviewEntry(input, options = {}) {
  const src = toSource(input);
  const entries = await readCentralDirectory(src);
  const entry = choosePreview(entries);
  if (!entry) return null;
  return { name: entry.name, bytes: await readEntry(src, entry, options) };
}

async function extractF3dPreview(input, options) {
  return (await extractF3dPreviewEntry(input, options))?.bytes ?? null;
}

module.exports = {
  extractF3dPreviewEntry,
  extractF3dPreview
};
