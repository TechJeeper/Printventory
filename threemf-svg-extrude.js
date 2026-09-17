/**
 * Rebuild coarse Bambu screenshot-extrusions from the embedded SVG.
 */

function attr(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : '';
}

function collectSvgPartSources(unzipped) {
  const sources = new Map();
  if (!unzipped) return sources;
  const decoder = new TextDecoder();
  for (const key of Object.keys(unzipped)) {
    if (!/model_settings\.config$/i.test(key)) continue;
    let xml = '';
    try {
      xml = decoder.decode(unzipped[key]);
    } catch (_) {
      continue;
    }
    const partRe = /<part\b([^>]*)>([\s\S]*?)<\/part>/gi;
    let match;
    while ((match = partRe.exec(xml))) {
      const partId = attr(match[1], 'id');
      const subtype = String(attr(match[1], 'subtype') || '').toLowerCase();
      if (!partId || (subtype && subtype !== 'normal_part' && subtype !== 'model_part')) continue;
      const shape = /<(?:\w+:)?shape\b([^>]*)\/?>/i.exec(match[2]);
      if (!shape) continue;
      const svgPath = attr(shape[1], 'filepath3mf') || attr(shape[1], 'filepath');
      if (!svgPath) continue;
      const zipKey = svgPath.replace(/^\//, '');
      if (!unzipped[zipKey]) continue;
      let svg = '';
      try {
        svg = decoder.decode(unzipped[zipKey]);
      } catch (_) {
        continue;
      }
      sources.set(String(partId), {
        svg,
        depth: parseFloat(attr(shape[1], 'depth') || '0') || 0
      });
    }
  }
  return sources;
}

function tokenizePath(d) {
  return String(d || '')
    .replace(/,/g, ' ')
    .replace(/([AaCcHhLlMmQqSsTtVvZz])/g, ' $1 ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function nextNums(tokens, i, count) {
  const out = [];
  for (let n = 0; n < count; n++) {
    const v = parseFloat(tokens[i + n]);
    if (Number.isNaN(v)) return { values: null, next: i };
    out.push(v);
  }
  return { values: out, next: i + count };
}

function sampleCubic(p0, p1, p2, p3, steps) {
  const pts = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
    });
  }
  return pts;
}

function sampleQuadratic(p0, p1, p2, steps) {
  const pts = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
    });
  }
  return pts;
}

function arcToCenter(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < 1e-8 || ry < 1e-8) return null;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let x1p = cos * dx + sin * dy;
  let y1p = -sin * dx + cos * dy;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const lambda = x1p2 / rx2 + y1p2 / ry2;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
    rx2 = rx * rx;
    ry2 = ry * ry;
  }
  const sign = fa === fs ? -1 : 1;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const den = rx2 * y1p2 + ry2 * x1p2;
  const coef = sign * Math.sqrt(num / den);
  const cxp = coef * (rx * y1p) / ry;
  const cyp = coef * -(ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const start = Math.atan2(uy, ux);
  let delta = Math.atan2(uy * vx - ux * vy, ux * vx + uy * vy);
  if (!fs && delta > 0) delta -= Math.PI * 2;
  if (fs && delta < 0) delta += Math.PI * 2;
  return { cx, cy, rx, ry, start, delta, phi };
}

function sampleArc(p0, rx, ry, phiDeg, fa, fs, p1, steps) {
  const phi = (phiDeg * Math.PI) / 180;
  const spec = arcToCenter(p0.x, p0.y, rx, ry, phi, fa, fs, p1.x, p1.y);
  if (!spec) return [{ x: p1.x, y: p1.y }];
  const count = Math.max(steps, Math.ceil(Math.abs(spec.delta) / (Math.PI / 12)));
  const cos = Math.cos(spec.phi);
  const sin = Math.sin(spec.phi);
  const pts = [];
  for (let s = 1; s <= count; s++) {
    const t = spec.start + spec.delta * (s / count);
    const x = spec.rx * Math.cos(t);
    const y = spec.ry * Math.sin(t);
    pts.push({
      x: cos * x - sin * y + spec.cx,
      y: sin * x + cos * y + spec.cy
    });
  }
  return pts;
}

function parseSvgPathContours(d, steps = 10) {
  const tokens = tokenizePath(d);
  const contours = [];
  let current = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let prevCmd = '';
  let cx = 0;
  let cy = 0;

  const push = (pt) => {
    const last = current[current.length - 1];
    if (last && Math.abs(last.x - pt.x) < 1e-6 && Math.abs(last.y - pt.y) < 1e-6) return;
    current.push(pt);
  };

  const close = () => {
    if (current.length > 2) contours.push(current);
    current = [];
  };

  while (i < tokens.length) {
    let cmd = tokens[i];
    if (/^[0-9.+-]$/.test(cmd[0])) {
      cmd = prevCmd === 'M' ? 'L' : prevCmd === 'm' ? 'l' : prevCmd;
    } else {
      i += 1;
    }
    const rel = cmd === cmd.toLowerCase();
    const abs = cmd.toUpperCase();
    if (abs === 'Z') {
      push({ x: sx, y: sy });
      close();
      x = sx;
      y = sy;
      prevCmd = abs;
      continue;
    }
    if (abs === 'M') {
      const nums = nextNums(tokens, i, 2);
      if (!nums.values) break;
      i = nums.next;
      x = rel ? x + nums.values[0] : nums.values[0];
      y = rel ? y + nums.values[1] : nums.values[1];
      close();
      current = [{ x, y }];
      sx = x;
      sy = y;
      prevCmd = abs;
      continue;
    }
    if (abs === 'L' || abs === 'H' || abs === 'V') {
      const count = abs === 'L' ? 2 : 1;
      const nums = nextNums(tokens, i, count);
      if (!nums.values) break;
      i = nums.next;
      if (abs === 'H') x = rel ? x + nums.values[0] : nums.values[0];
      else if (abs === 'V') y = rel ? y + nums.values[0] : nums.values[0];
      else {
        x = rel ? x + nums.values[0] : nums.values[0];
        y = rel ? y + nums.values[1] : nums.values[1];
      }
      push({ x, y });
      prevCmd = abs;
      continue;
    }
    if (abs === 'C') {
      const nums = nextNums(tokens, i, 6);
      if (!nums.values) break;
      i = nums.next;
      const p0 = { x, y };
      const p1 = {
        x: rel ? x + nums.values[0] : nums.values[0],
        y: rel ? y + nums.values[1] : nums.values[1]
      };
      const p2 = {
        x: rel ? x + nums.values[2] : nums.values[2],
        y: rel ? y + nums.values[3] : nums.values[3]
      };
      const p3 = {
        x: rel ? x + nums.values[4] : nums.values[4],
        y: rel ? y + nums.values[5] : nums.values[5]
      };
      sampleCubic(p0, p1, p2, p3, steps).forEach(push);
      cx = p2.x;
      cy = p2.y;
      x = p3.x;
      y = p3.y;
      prevCmd = abs;
      continue;
    }
    if (abs === 'Q') {
      const nums = nextNums(tokens, i, 4);
      if (!nums.values) break;
      i = nums.next;
      const p0 = { x, y };
      const p1 = {
        x: rel ? x + nums.values[0] : nums.values[0],
        y: rel ? y + nums.values[1] : nums.values[1]
      };
      const p2 = {
        x: rel ? x + nums.values[2] : nums.values[2],
        y: rel ? y + nums.values[3] : nums.values[3]
      };
      sampleQuadratic(p0, p1, p2, steps).forEach(push);
      cx = p1.x;
      cy = p1.y;
      x = p2.x;
      y = p2.y;
      prevCmd = abs;
      continue;
    }
    if (abs === 'S') {
      const nums = nextNums(tokens, i, 4);
      if (!nums.values) break;
      i = nums.next;
      const p0 = { x, y };
      const p1 = prevCmd === 'C' || prevCmd === 'S'
        ? { x: 2 * x - cx, y: 2 * y - cy }
        : { x, y };
      const p2 = {
        x: rel ? x + nums.values[0] : nums.values[0],
        y: rel ? y + nums.values[1] : nums.values[1]
      };
      const p3 = {
        x: rel ? x + nums.values[2] : nums.values[2],
        y: rel ? y + nums.values[3] : nums.values[3]
      };
      sampleCubic(p0, p1, p2, p3, steps).forEach(push);
      cx = p2.x;
      cy = p2.y;
      x = p3.x;
      y = p3.y;
      prevCmd = abs;
      continue;
    }
    if (abs === 'A') {
      const nums = nextNums(tokens, i, 7);
      if (!nums.values) break;
      i = nums.next;
      const p0 = { x, y };
      const p1 = {
        x: rel ? x + nums.values[5] : nums.values[5],
        y: rel ? y + nums.values[6] : nums.values[6]
      };
      sampleArc(p0, nums.values[0], nums.values[1], nums.values[2], nums.values[3], nums.values[4], p1, steps)
        .forEach(push);
      x = p1.x;
      y = p1.y;
      prevCmd = abs;
      continue;
    }
    i += 1;
  }
  close();
  return contours.filter((c) => c.length > 3);
}

function extractSvgPathData(svg) {
  const match = /<path\b[^>]*\bd="([^"]+)"/i.exec(svg);
  return match ? match[1] : '';
}

function ringArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return a / 2;
}

function ensureWinding(points, ccw) {
  const clockwise = ringArea(points) < 0;
  if (ccw === clockwise) return points.slice().reverse();
  return points;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const hit = ((a.y > pt.y) !== (b.y > pt.y))
      && (pt.x < (b.x - a.x) * (pt.y - a.y) / ((b.y - a.y) || 1e-12) + a.x);
    if (hit) inside = !inside;
  }
  return inside;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function joinHoles(outer, holes) {
  let ring = outer.slice();
  const remaining = holes.slice();
  remaining.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  remaining.forEach((hole) => {
    let best = Infinity;
    let oi = 0;
    let hi = 0;
    for (let i = 0; i < ring.length; i++) {
      for (let j = 0; j < hole.length; j++) {
        const d = dist2(ring[i], hole[j]);
        if (d < best) {
          best = d;
          oi = i;
          hi = j;
        }
      }
    }
    const bridge = [ring[oi]];
    for (let n = 0; n <= hole.length; n++) {
      bridge.push(hole[(hi + n) % hole.length]);
    }
    bridge.push(ring[oi]);
    ring = ring.slice(0, oi).concat(bridge, ring.slice(oi));
  });
  return ring;
}

function isConvex(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) >= -1e-12;
}

function pointInTri(p, a, b, c) {
  const s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return (s1 >= -1e-12 && s2 >= -1e-12 && s3 >= -1e-12)
    || (s1 <= 1e-12 && s2 <= 1e-12 && s3 <= 1e-12);
}

function earclip(points) {
  const verts = points.map((p, i) => ({ ...p, i }));
  const faces = [];
  let guard = verts.length * verts.length;
  while (verts.length > 3 && guard-- > 0) {
    let sliced = false;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[(i + verts.length - 1) % verts.length];
      const b = verts[i];
      const c = verts[(i + 1) % verts.length];
      if (!isConvex(a, b, c)) continue;
      let inside = false;
      for (let k = 0; k < verts.length; k++) {
        if (k === i || k === (i + verts.length - 1) % verts.length || k === (i + 1) % verts.length) continue;
        if (pointInTri(verts[k], a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      faces.push(a.i, b.i, c.i);
      verts.splice(i, 1);
      sliced = true;
      break;
    }
    if (!sliced) break;
  }
  if (verts.length === 3) faces.push(verts[0].i, verts[1].i, verts[2].i);
  return faces;
}

function triangulateContours(contours) {
  if (!contours.length) return { points: [], faces: [] };
  const ranked = contours
    .map((pts) => ensureWinding(pts, true))
    .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const outer = ranked[0];
  const holes = ranked.slice(1)
    .filter((hole) => pointInRing(hole[0], outer))
    .map((hole) => ensureWinding(hole, false));
  const joined = joinHoles(outer, holes);
  return { points: joined, faces: earclip(joined) };
}

function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  return { minX, minY, maxX, maxY };
}

function extrudeSvgToMesh(svgText, targetBox, depthHint) {
  const path = extractSvgPathData(svgText);
  if (!path) return null;
  const contours = parseSvgPathContours(path, 14);
  if (!contours.length) return null;
  const { points, faces } = triangulateContours(contours);
  if (points.length < 3 || faces.length < 3) return null;

  const src = boundsOf(points);
  const sx = (targetBox.maxX - targetBox.minX) / Math.max(src.maxX - src.minX, 1e-6);
  const sy = (targetBox.maxY - targetBox.minY) / Math.max(src.maxY - src.minY, 1e-6);
  const scale = Math.min(sx, sy);
  const ox = (targetBox.minX + targetBox.maxX) / 2;
  const oy = (targetBox.minY + targetBox.maxY) / 2;
  const cx = (src.minX + src.maxX) / 2;
  const cy = (src.minY + src.maxY) / 2;
  const z0 = targetBox.minZ;
  const depth = Math.max(
    Math.abs(targetBox.maxZ - targetBox.minZ),
    depthHint || 0,
    0.2
  );

  const mapped = points.map((p) => ({
    x: (p.x - cx) * scale + ox,
    y: (cy - p.y) * scale + oy
  }));

  const n = mapped.length;
  const positions = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = mapped[i].x;
    positions[i * 3 + 1] = mapped[i].y;
    positions[i * 3 + 2] = z0;
    positions[(n + i) * 3] = mapped[i].x;
    positions[(n + i) * 3 + 1] = mapped[i].y;
    positions[(n + i) * 3 + 2] = z0 + depth;
  }

  const indices = [];
  for (let i = 0; i < faces.length; i += 3) {
    indices.push(faces[i], faces[i + 1], faces[i + 2]);
    indices.push(n + faces[i], n + faces[i + 2], n + faces[i + 1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j);
    indices.push(i, n + j, n + i);
  }

  return {
    positions,
    indices: new Uint32Array(indices)
  };
}

function meshBoundsFromArrays(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

module.exports = {
  collectSvgPartSources,
  extrudeSvgToMesh,
  meshBoundsFromArrays,
  parseSvgPathContours
};
