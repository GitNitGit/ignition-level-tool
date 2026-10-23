// Custom assets (core): simple bodies (box, sphere, cylinder, cone, pyramid, tetrahedron, plane), combined in order
// by union, subtraction and intersection with a BSP tree (after csg.js by Evan Wallace), built into one low-poly
// mesh in the asset's own coordinates (game axes, y up). Polygons are wound counter-clockwise seen from outside
// (right-handed normal outward), as the faces of the originals' objects are.
//   body: {kind, size: [sx, sy, sz] (full extents), pos: [x, y, z], rot: [rx, ry, rz] (degrees, x first), op:
//         'add' | 'subtract' | 'intersect', segments?, colour: "#rrggbb", faceColours?: {<face index>: "#rrggbb"}}
//   buildAsset(asset) fills asset.verts / asset.faces ([a, b, c, colour, flags, alpha, tile, uv, body, face]).
import { rotationOf, DEG } from './objects.js';
import { projectUV, projectUVBody, bakeFrame } from './texmap.js';

const EPS = 1e-3;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

class Plane {
  constructor(normal, w) { this.normal = normal; this.w = w; }
  static fromPoints(a, b, c) {
    const n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n);
    if (l < 1e-9) return null;
    const u = n.map(x => x / l);
    return new Plane(u, dot(u, a));
  }
  clone() { return new Plane(this.normal.slice(), this.w); }
  flip() { this.normal = this.normal.map(x => -x); this.w = -this.w; }
  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
    let type = 0;
    const types = polygon.vertices.map(v => { const t = dot(this.normal, v) - this.w, k = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR; type |= k; return k; });
    if (type === COPLANAR) (dot(this.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
    else if (type === FRONT) front.push(polygon);
    else if (type === BACK) back.push(polygon);
    else {
      const f = [], b = [], vs = polygon.vertices, n = vs.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ti = types[i], tj = types[j], vi = vs[i], vj = vs[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(ti !== BACK ? vi.slice() : vi);
        if ((ti | tj) === SPANNING) {
          const t = (this.w - dot(this.normal, vi)) / dot(this.normal, sub(vj, vi));
          const v = lerp(vi, vj, t);
          f.push(v); b.push(v.slice());
        }
      }
      if (f.length >= 3) front.push(new Polygon(f, polygon.shared, polygon.plane));
      if (b.length >= 3) back.push(new Polygon(b, polygon.shared, polygon.plane));
    }
  }
}
class Polygon {
  constructor(vertices, shared, plane = null) {
    this.vertices = vertices; this.shared = shared;
    this.plane = Plane.fromPoints(vertices[0], vertices[1], vertices[2]) || (plane && plane.clone()) || new Plane([0, 1, 0], 0);
  }
  clone() { return new Polygon(this.vertices.map(v => v.slice()), this.shared, this.plane); }
  flip() { this.vertices.reverse(); this.plane.flip(); }
}
class Node {
  constructor(polygons) { this.plane = null; this.front = null; this.back = null; this.polygons = []; if (polygons) this.build(polygons); }
  clone() {
    const n = new Node();
    n.plane = this.plane && this.plane.clone(); n.front = this.front && this.front.clone(); n.back = this.back && this.back.clone();
    n.polygons = this.polygons.map(p => p.clone());
    return n;
  }
  invert() {
    for (const p of this.polygons) p.flip();
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    [this.front, this.back] = [this.back, this.front];
  }
  clipPolygons(polygons) {
    if (!this.plane) return polygons.slice();
    let front = [], back = [];
    for (const p of polygons) this.plane.splitPolygon(p, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }
  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }
  allPolygons() {
    let out = this.polygons.slice();
    if (this.front) out = out.concat(this.front.allPolygons());
    if (this.back) out = out.concat(this.back.allPolygons());
    return out;
  }
  build(polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [], back = [];
    for (const p of polygons) this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
    if (front.length) { if (!this.front) this.front = new Node(); this.front.build(front); }
    if (back.length) { if (!this.back) this.back = new Node(); this.back.build(back); }
  }
}
const tree = polys => new Node(polys.map(p => p.clone()));
export function union(A, B) {
  const a = tree(A), b = tree(B);
  a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.allPolygons());
  return a.allPolygons();
}
export function subtract(A, B) {
  const a = tree(A), b = tree(B);
  a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.allPolygons()); a.invert();
  return a.allPolygons();
}
export function intersect(A, B) {
  const a = tree(A), b = tree(B);
  a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.allPolygons()); a.invert();
  return a.allPolygons();
}

// ---------------------------------------------------------------- bodies
export const KINDS = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'tetra', 'plane'];
export const DEFAULT_BODY = { kind: 'box', size: [200, 200, 200], pos: [0, 100, 0], rot: [0, 0, 0], op: 'add', colour: '#9a9a9a' };
const SEGMENTS = { sphere: 8, cylinder: 10, cone: 10 };
// the faces of a body in its unit shape (extent 1, centred): [[x, y, z], ...] polygons, outward winding
function unitFaces(body) {
  const n = Math.max(3, Math.min(24, body.segments || SEGMENTS[body.kind] || 8));
  const ring = (y, r, k = n) => [...Array(k).keys()].map(i => { const a = i / k * 2 * Math.PI; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
  const polys = [];
  const quad = (a, b, c, d) => polys.push([a, b, c, d]);
  switch (body.kind) {
    case 'box': {
      const c = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
      for (const [a, b, d, e] of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]) quad(c[a], c[b], c[d], c[e]);
      break;
    }
    case 'sphere': {
      const stacks = Math.max(3, Math.round(n * 0.6));
      const rings = [];
      for (let s = 1; s < stacks; s++) { const phi = s / stacks * Math.PI; rings.push(ring(0.5 * Math.cos(phi), 0.5 * Math.sin(phi))); }
      const top = [0, 0.5, 0], bottom = [0, -0.5, 0];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        polys.push([top, rings[0][i], rings[0][j]]);
        for (let s = 0; s < rings.length - 1; s++) quad(rings[s][i], rings[s + 1][i], rings[s + 1][j], rings[s][j]);
        polys.push([bottom, rings[rings.length - 1][j], rings[rings.length - 1][i]]);
      }
      break;
    }
    case 'cylinder': {
      const top = ring(0.5, 0.5), bot = ring(-0.5, 0.5);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; quad(bot[i], bot[j], top[j], top[i]); }
      polys.push(top.slice(), bot.slice().reverse());
      break;
    }
    case 'cone': {
      const bot = ring(-0.5, 0.5), apex = [0, 0.5, 0];
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; polys.push([bot[i], bot[j], apex]); }
      polys.push(bot.slice().reverse());
      break;
    }
    case 'pyramid': {
      const b = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], apex = [0, 0.5, 0];
      for (let i = 0; i < 4; i++) polys.push([b[i], b[(i + 1) % 4], apex]);
      polys.push(b.slice().reverse());
      break;
    }
    case 'tetra': {
      const p = [[0, 0.5, 0], [-0.5, -0.5, 0.5 / Math.sqrt(3) * 2 - 0.5 + 0.0], [0.5, -0.5, 0.5 / Math.sqrt(3) * 2 - 0.5], [0, -0.5, -0.5]];
      polys.push([p[0], p[1], p[2]], [p[0], p[2], p[3]], [p[0], p[3], p[1]], [p[1], p[3], p[2]]);
      break;
    }
    case 'plane': quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]); break;
    default: throw new Error('unknown body kind ' + body.kind);
  }
  // outward winding: the right-handed normal points away from the body's centre (all bodies are convex and centred)
  return polys.map(p => {
    const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const c = p.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]).map(x => x / p.length);
    const want = body.kind === 'plane' ? [0, 1, 0] : c;
    return dot(n, want) < 0 ? p.slice().reverse() : p;
  });
}
// the polygons of a body in the asset's coordinates, each tagged {body, face, colour}
export function bodyPolygons(body, index) {
  const R = rotationOf(body.rot || [0, 0, 0]), s = body.size || [1, 1, 1], t = body.pos || [0, 0, 0];
  const place = v => { const x = v[0] * s[0], y = v[1] * s[1], z = v[2] * s[2]; return [0, 1, 2].map(i => R[i][0] * x + R[i][1] * y + R[i][2] * z + t[i]); };
  const mirrored = s.filter(x => x < 0).length % 2 === 1;
  return unitFaces(body).map((p, face) => {
    const vs = p.map(place);
    if (mirrored) vs.reverse();
    return new Polygon(vs, { body: index, face, colour: body.faceColours?.[face] || body.colour || '#9a9a9a' });
  });
}
// build the mesh of an asset from its bodies (in order; a plane is laid on top without CSG): asset.verts / faces
export function buildAsset(asset) {
  for (const b of asset.bodies || []) bakeFrame(b);           // frames still in asset coordinates: into their bodies
  let solid = null;
  const extra = [];
  (asset.bodies || []).forEach((body, i) => {
    const polys = bodyPolygons(body, i);
    if (body.kind === 'plane') { extra.push(...polys); return; }
    const op = body.op || 'add';
    if (!solid) { if (op === 'add') solid = polys; return; }
    solid = op === 'subtract' ? subtract(solid, polys) : op === 'intersect' ? intersect(solid, polys) : union(solid, polys);
  });
  const verts = [], index = new Map(), faces = [];
  const vert = p => {
    const q = p.map(x => Math.round(x * 100) / 100), k = q.join(',');
    if (!index.has(k)) { index.set(k, verts.length); verts.push(q); }
    return index.get(k);
  };
  for (const poly of [...(solid || []), ...extra]) {
    const idx = poly.vertices.map(vert), flags = poly.shared.flags || (extra.includes(poly) ? 0x15 : 0x11);
    for (let i = 1; i < idx.length - 1; i++) {
      const [a, b, c] = [idx[0], idx[i], idx[i + 1]];
      if (a === b || b === c || a === c) continue;
      const n = cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]));
      if (Math.hypot(...n) < 0.5) continue;                                 // no area
      faces.push([a, b, c, poly.shared.colour, flags, 1, null, null, poly.shared.body, poly.shared.face]);
    }
  }
  asset.verts = verts; asset.faces = splitTJunctions(verts, faces);
  // textures: a body with a projector gives its faces texel coordinates (texmap.js); the key names the image
  for (const f of asset.faces) {
    const b = asset.bodies[f[8]], t = b?.texture;
    if (!t || !t.name || !(t.space === 'body' ? t.ax : t.size)) continue;
    f[6] = 'png:' + t.name;
    f[7] = [f[0], f[1], f[2]].map(i => (t.space === 'body' ? projectUVBody(b, verts[i]) : projectUV(t, verts[i])).map(x => Math.round(x * 100) / 100));
  }
  return asset;
}
// A vertex lying on an edge of a face it does not belong to (BSP cuts leave such T-junctions, a crack in the game):
// the face is split there, until none is left.
function onSegment(V, P, Q) {
  const d = sub(Q, P), l2 = dot(d, d);
  if (l2 < 1e-6) return false;
  const t = dot(sub(V, P), d) / l2;
  if (t <= 1e-4 || t >= 1 - 1e-4) return false;
  const off = sub(V, lerp(P, Q, t));
  return dot(off, off) < 0.05 * 0.05;
}
function splitTJunctions(verts, faces) {
  for (let round = 0; round < 30; round++) {
    const out = [];
    let changed = false;
    for (const f of faces) {
      let split = null;
      for (const [p, q, r] of [[f[0], f[1], f[2]], [f[1], f[2], f[0]], [f[2], f[0], f[1]]]) {
        for (let v = 0; v < verts.length; v++) {
          if (v === p || v === q || v === r) continue;
          if (onSegment(verts[v], verts[p], verts[q])) { split = [p, q, r, v]; break; }
        }
        if (split) break;
      }
      if (!split) { out.push(f); continue; }
      const [p, q, r, v] = split;
      out.push([p, v, r, ...f.slice(3)], [v, q, r, ...f.slice(3)]);
      changed = true;
    }
    faces = out;
    if (!changed) break;
  }
  return faces;
}
// tidy a body's numbers after a drag (the asset stays readable)
export function tidyBody(b) {
  b.pos = b.pos.map(v => Math.round(v * 10) / 10);
  b.size = b.size.map(v => Math.max(1, Math.round(v * 10) / 10));
  if (b.rot) { b.rot = b.rot.map(a => { a = Math.round(a * 10) / 10; a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }); if (b.rot.every(a => !a)) b.rot = [0, 0, 0]; }
  return b;
}
// edges with only one face (0 for a closed body)
export function openEdges(asset) {
  const seen = new Map();
  for (const [a, b, c, , flags] of asset.faces) { if (flags & 0x04) continue; for (const [p, q] of [[a, b], [b, c], [c, a]]) seen.set(p + '>' + q, (seen.get(p + '>' + q) || 0) + 1); }
  let open = 0;
  for (const k of seen.keys()) { const [p, q] = k.split('>'); if (!seen.has(q + '>' + p)) open++; }
  return open;
}
