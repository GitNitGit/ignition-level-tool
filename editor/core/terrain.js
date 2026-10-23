// The stored landscape (mode 2): explicit points and triangles, no regeneration.
//
//   terrain = { points: [P], tris: [[a, b, c, mat, colour?]] }   mat: 'land' | 'drive' | 'edge' | 'dead', colour: painted (paint.js)
//   P = { d: [segKey, i, ref, side, lat, along, dy], lock?, rim? }   docked: follows the track
//     | { p: [x, y, z] }                                            free
// A docked point sits on a frame of a segment ("a|b", node ids sorted, canonical direction); i is the
// frame index (fractional: between two frames), ref says what `lat` is measured from:
//   'c' centre line (lat signed, left of the canonical direction positive), 'e' road edge, 'v' outer
//   edge of the drivable verge, 'k1'..'k3' the kerb rows (all outwards on `side`, +1 = left of the canonical direction);
// along: metres along the track, dy: height above the frame. The outer row of the base (base.js) is
// ref 'v' with everything 0 and lock: 1 - these points are part of mode 1 and not movable here.
// Landscape that is not connected to any docked point is a separate object (floating).
import { lerpFrame } from './paths.js';
import { Hash, segDist } from './sections.js';
import { triangulate } from './cdt.js';

export const MATS = ['land', 'drive', 'edge', 'dead'];
export const newTerrain = () => ({ points: [], tris: [] });

// context for docking: segments of the current paths and the verge offsets of the base
export function dockContext(base) {
  const ctx = { segs: base.segs, vAt: base.vAt, vPos: base.vPos, rowPos: base.rowPos, list: null };
  ctx.frames = () => {                                        // all canonical frames, for nearest-dock searches
    if (ctx.list) return ctx.list;
    ctx.list = [];
    for (const e of base.segs.values()) e.frames.forEach((f, i) => ctx.list.push({ key: e.key, i, f }));
    return ctx.list;
  };
  return ctx;
}

// the point of the base a dock refers to (its row at the frame, with the base's heights: junctions lift them)
function refPoint(d, ctx, F) {
  const [key, i, ref, sc] = d;
  if (ref === 'c') return ctx.rowPos(key, 1, i, 'c') || F.c;
  if (ref === 'e') return ctx.rowPos(key, sc, i, 'e') || [F.c[0] + F.left[0] * sc * F.half, F.c[1], F.c[2] + F.left[1] * sc * F.half];
  return ctx.rowPos(key, sc, i, ref);                 // a row of the base: verge (merged in tight bends), kerb
}
export function dockPos(d, ctx) {
  const [key, i, ref, sc, lat, along, dy] = d;
  const e = ctx.segs.get(key);
  if (!e) return null;
  const i0 = Math.max(0, Math.min(e.k, Math.floor(i))), i1 = Math.min(e.k, i0 + 1), u = Math.min(1, Math.max(0, i - i0));
  const F = lerpFrame(e.frames[i0], e.frames[i1], u);
  const tan = [F.left[1], -F.left[0]], O = refPoint(d, ctx, F);
  if (!O) return null;
  const l = ref === 'c' ? lat : sc * lat;             // lat: signed from the centre line, outwards from the other rows
  let x = O[0] + F.left[0] * l, z = O[2] + F.left[1] * l;
  if (along) { x += tan[0] * along; z += tan[1] * along; }
  return [x, O[1] + dy, z];
}

// positions of all points (null where the segment of a dock does not exist any more)
export function resolve(terrain, ctx) {
  return terrain.points.map(P => (P.d ? dockPos(P.d, ctx) : P.p) || null);
}

// dock of a world position: the nearest frame of any segment, rigidly (ref 'c')
export function nearestDock(pos, ctx) {
  let best = null, bd = Infinity;
  for (const c of ctx.frames()) {
    const d = (c.f.c[0] - pos[0]) ** 2 + (c.f.c[2] - pos[2]) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return null;
  const F = best.f, tan = [F.left[1], -F.left[0]], dx = pos[0] - F.c[0], dz = pos[2] - F.c[2];
  const y = (ctx.rowPos(best.key, 1, best.i, 'c') || F.c)[1];        // the centre line's height as the base has it
  return [best.key, best.i, 'c', 1, Math.round(dx * F.left[0] + dz * F.left[1]), Math.round(dx * tan[0] + dz * tan[1]), Math.round(pos[1] - y)];
}

// move point idx to pos: docked points keep their frame and reference, only the offsets change
export function setPointPos(terrain, idx, pos, ctx) {
  const P = terrain.points[idx];
  if (!P || P.lock) return false;
  if (!P.d) { P.p = pos.map(Math.round); return true; }
  const [key, i, ref, sc] = P.d, e = ctx.segs.get(key);
  if (!e) return false;
  const i0 = Math.max(0, Math.min(e.k, Math.floor(i))), i1 = Math.min(e.k, i0 + 1), u = Math.min(1, Math.max(0, i - i0));
  const F = lerpFrame(e.frames[i0], e.frames[i1], u), tan = [F.left[1], -F.left[0]];
  const O = refPoint(P.d, ctx, F);
  if (!O) return false;
  const dx = pos[0] - O[0], dz = pos[2] - O[2];
  const lateral = dx * F.left[0] + dz * F.left[1];
  P.d = [key, i, ref, sc, Math.round(ref === 'c' ? lateral : lateral * sc), Math.round(dx * tan[0] + dz * tan[1]), Math.round(pos[1] - O[1])];
  return true;
}

// ------------------------------------------------------------------ editing
// All functions change `terrain` in place and take `pos` (resolved positions) where they need geometry.
const orient = (a, b, c) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
const edgeId = (a, b) => (a < b ? a + ',' + b : b + ',' + a);

export function addPoint(terrain, p, ctx) {
  const d = nearestDock(p, ctx);
  terrain.points.push(d ? { d } : { p: p.map(Math.round) });
  return terrain.points.length - 1;
}
export function addTriangle(terrain, a, b, c, mat, pos) {
  if (new Set([a, b, c]).size < 3) return -1;
  terrain.tris.push(orient(pos[a], pos[b], pos[c]) >= 0 ? [a, b, c, mat] : [a, c, b, mat]);
  return terrain.tris.length - 1;
}
export function setMaterial(terrain, ids, mat) { for (const t of ids) terrain.tris[t][3] = mat; }

// each triangle into three around a new point at its centre; returns the new triangle ids
export function splitTriangles(terrain, ids, pos, ctx) {
  const made = [], drop = new Set(ids);
  for (const t of [...drop]) {
    const [a, b, c, ...rest] = terrain.tris[t];
    const m = addPoint(terrain, [0, 1, 2].map(k => (pos[a][k] + pos[b][k] + pos[c][k]) / 3), ctx);
    terrain.tris[t] = [a, b, m, ...rest];
    terrain.tris.push([b, c, m, ...rest], [c, a, m, ...rest]);
    made.push(t, terrain.tris.length - 2, terrain.tris.length - 1);
  }
  return made;
}

// each triangle into four: a new point in the middle of every side, the three corners and the middle triangle.
// Neighbours that share a cut side are cut too (into two or three), so no point sits on a side without being a
// corner of it. A side between two locked points (the base's outer row) is not cut. Returns the ids of the pieces of
// the selected triangles.
export function splitTriangles4(terrain, ids, pos, ctx) {
  const chosen = new Set(ids), locked = i => !!terrain.points[i]?.lock, rim = i => !!terrain.points[i]?.rim;
  const mids = new Map(), at = new Map();                  // edge id -> new point; new point -> position
  for (const t of chosen) {
    const v = terrain.tris[t];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], e = edgeId(a, b);
      if (mids.has(e) || (locked(a) && locked(b))) continue;
      const p = [0, 1, 2].map(j => (pos[a][j] + pos[b][j]) / 2), m = addPoint(terrain, p, ctx);
      if (rim(a) && rim(b)) terrain.points[m].rim = 1;      // the outer border of the landscape stays the border
      mids.set(e, m); at.set(m, p);
    }
  }
  const made = [], n0 = terrain.tris.length;
  for (let t = 0; t < n0; t++) {
    const [a, b, c, ...rest] = terrain.tris[t], V = [a, b, c];
    const M = [0, 1, 2].map(k => mids.get(edgeId(V[k], V[(k + 1) % 3])));     // M[k]: middle of side V[k]-V[k+1]
    const cut = M.filter(m => m !== undefined).length;
    if (!cut) continue;
    let pieces;
    if (cut === 3) pieces = [[a, M[0], M[2]], [M[0], b, M[1]], [M[2], M[1], c], [M[0], M[1], M[2]]];
    else if (cut === 1) {
      const k = M.findIndex(m => m !== undefined), p = V[k], q = V[(k + 1) % 3], r = V[(k + 2) % 3];
      pieces = [[p, M[k], r], [M[k], q, r]];
    } else {
      // two cut sides: the corner between them gets its own triangle, the rest is a quad cut along its shorter diagonal
      const k = M.findIndex(m => m === undefined);           // uncut side V[k]-V[k+1]; corner V[k+2] is between the cuts
      const p = V[k], q = V[(k + 1) % 3], r = V[(k + 2) % 3], mq = M[(k + 1) % 3], mr = M[(k + 2) % 3];
      // ring of the quad: p, q, mq, mr
      const P = i => pos[i] || at.get(i), d = (x, y) => (P(x)[0] - P(y)[0]) ** 2 + (P(x)[2] - P(y)[2]) ** 2;
      pieces = [[mq, r, mr], ...(d(p, mq) <= d(q, mr) ? [[p, q, mq], [p, mq, mr]] : [[p, q, mr], [q, mq, mr]])];
    }
    terrain.tris[t] = [...pieces[0], ...rest];
    if (chosen.has(t)) made.push(t);
    for (const pc of pieces.slice(1)) {
      terrain.tris.push([...pc, ...rest]);
      if (chosen.has(t)) made.push(terrain.tris.length - 1);
    }
  }
  return made;
}

// the edge two triangles share: [shared0, shared1, opposite in t1, opposite in t2] or null
export function sharedEdge(terrain, t1, t2) {
  const A = terrain.tris[t1].slice(0, 3), B = terrain.tris[t2].slice(0, 3);
  const sh = A.filter(p => B.includes(p));
  if (sh.length !== 2) return null;
  return [sh[0], sh[1], A.find(p => !sh.includes(p)), B.find(p => !sh.includes(p))];
}
// swap the diagonal of the quad two triangles form (it must be convex)
export function flipEdge(terrain, t1, t2, pos) {
  const e = sharedEdge(terrain, t1, t2);
  if (!e) return false;
  const [s0, s1, p, q] = e;
  // convex: the new diagonal p-q must cross s0-s1
  if (orient(pos[p], pos[q], pos[s0]) * orient(pos[p], pos[q], pos[s1]) >= 0) return false;
  const m1 = terrain.tris[t1].slice(3), m2 = terrain.tris[t2].slice(3);
  const a = orient(pos[p], pos[q], pos[s0]) > 0 ? [p, q, s0] : [p, s0, q];
  const b = orient(pos[p], pos[q], pos[s1]) > 0 ? [p, q, s1] : [p, s1, q];
  terrain.tris[t1] = [...a, ...m1];
  terrain.tris[t2] = [...b, ...m2];
  return true;
}
// a new point in the middle of the shared edge of two triangles; each is cut in two. Returns ids.
export function splitEdge(terrain, t1, t2, pos, ctx) {
  const e = sharedEdge(terrain, t1, t2);
  if (!e) return null;
  const [s0, s1, p, q] = e;
  const m = addPoint(terrain, [0, 1, 2].map(k => (pos[s0][k] + pos[s1][k]) / 2), ctx);
  const m1 = terrain.tris[t1].slice(3), m2 = terrain.tris[t2].slice(3);
  terrain.tris[t1] = [p, s0, m, ...m1];
  terrain.tris.push([p, m, s1, ...m1], [q, m, s0, ...m2]);
  terrain.tris[t2] = [q, s1, m, ...m2];
  return [t1, t2, terrain.tris.length - 2, terrain.tris.length - 1];
}
export function deleteTriangles(terrain, ids) {
  const drop = new Set(ids);
  terrain.tris = terrain.tris.filter((_, i) => !drop.has(i));
}
// triangles cut loose: they get copies of their points that are free (not docked) - a floating object
export function detachTriangles(terrain, ids, pos) {
  const copy = new Map();
  for (const t of ids) {
    for (let k = 0; k < 3; k++) {
      const v = terrain.tris[t][k];
      if (!copy.has(v)) { terrain.points.push({ p: pos[v].map(Math.round) }); copy.set(v, terrain.points.length - 1); }
      terrain.tris[t][k] = copy.get(v);
    }
  }
}
// docked points of the selection become free
export function freePoints(terrain, ids, pos) {
  for (const i of ids) { const P = terrain.points[i]; if (P && !P.lock) { P.p = pos[i].map(Math.round); delete P.d; } }
}
// drop the points no triangle uses (locked ones stay: they are the base's outer row; may(i): only these may go);
// returns old -> new index map
export function compact(terrain, may = () => true) {
  const used = new Set(terrain.tris.flatMap(t => t.slice(0, 3)));
  const map = new Map(), points = [];
  terrain.points.forEach((P, i) => { if (used.has(i) || P.lock || !may(i)) { map.set(i, points.length); points.push(P); } });
  terrain.points = points;
  terrain.tris = terrain.tris.map(t => [map.get(t[0]), map.get(t[1]), map.get(t[2]), ...t.slice(3)]);
  return map;
}

// ------------------------------------------------------------------ analysis
const wk = p => Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]);

// Open edges (a hole): edges of the terrain, and of the base's outer row, that only one triangle has.
// Points are compared by position, so terrain and base meet. Edges between two rim points (the
// outermost edge of the landscape) are not holes. Returns [[posA, posB]]; opts.borders: with the border's edges.
const EDGE_ROWS = ['c', 'e', 'v', 'k1', 'k2', 'k3'];
const NEAR_BRIDGE = 100;
const inTri2 = (p, [a, b, c]) => {
  const s = (u, v) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const x = s(a, b), y = s(b, c), z = s(c, a);
  return (x >= 0 && y >= 0 && z >= 0) || (x <= 0 && y <= 0 && z <= 0);
};
export function openEdges(terrain, pos, baseTris, opts = {}) {
  const count = new Map();
  const bump = (a, b) => { const k = a < b ? a + ' ' + b : b + ' ' + a; count.set(k, (count.get(k) || 0) + 1); };
  const keyOf = p => wk(p);
  // at a bridge the upper road's edge over the underpass and the landscape beside its mouths stay open (bridges.js):
  // edges within NEAR_BRIDGE of the covered floor are not holes
  const floor = baseTris.filter(t => t.covered && !t.deck), fh = new Hash(400);
  const reachOf = () => NEAR_BRIDGE;
  floor.forEach((t, k) => { const r = reachOf(t); fh.add(k, Math.min(...t.p.map(p => p[0])) - r, Math.min(...t.p.map(p => p[2])) - r,
    Math.max(...t.p.map(p => p[0])) + r, Math.max(...t.p.map(p => p[2])) + r); });
  const nearBridge = (a, b) => {
    const m = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
    for (const k of fh.near(m[0], m[1], 0)) {
      const P = floor[k].p.map(p => [p[0], p[2]]), r = reachOf(floor[k]);
      if (inTri2(m, P) || [0, 1, 2].some(i => segDist(m, P[i], P[(i + 1) % 3])[0] <= r)) return true;
    }
    return false;
  };
  baseTris = baseTris.filter(t => !t.covered && !t.deck && !t.floating);   // the floor under a bridge and a free-standing deck are not part of the landscape
  for (const t of baseTris) {
    if (t.cap) continue;
    for (let j = 0; j < 3; j++) bump(keyOf(t.p[j]), keyOf(t.p[(j + 1) % 3]));
  }
  const rim = i => !!terrain.points[i].rim;
  const terr = [];
  for (const t of terrain.tris) {
    const ix = t.slice(0, 3);
    if (ix.some(i => !pos[i])) continue;
    for (let j = 0; j < 3; j++) {
      const a = ix[j], b = ix[(j + 1) % 3];
      bump(keyOf(pos[a]), keyOf(pos[b]));
      terr.push([a, b, ix[(j + 2) % 3]]);
    }
  }
  // An edge that only one face has but on which, along its whole length, edges of faces on its other side lie (a
  // T-junction: the faces meet, only not at shared vertices) is no hole: the game draws faces, not bodies, and nothing
  // is missing there (2026-10-11, user). Which side: the third corners of the two faces, seen along the edge (in plan;
  // for an upright edge or face, across it in its own plane). Edges of faces on the same side do not close it - that
  // hid real holes before 2026-10-08 (a deleted triangle beside a split edge).
  const segs = [], sh = new Hash(300);
  const addSeg = (a, b, c) => { segs.push([a, b, c]); sh.add(segs.length - 1, Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2])); };
  for (const t of baseTris) for (let j = 0; j < 3; j++) addSeg(t.p[j], t.p[(j + 1) % 3], t.p[(j + 2) % 3]);
  for (const t of terrain.tris) { const ix = t.slice(0, 3); if (ix.every(i => pos[i])) for (let j = 0; j < 3; j++) addSeg(pos[ix[j]], pos[ix[(j + 1) % 3]], pos[ix[(j + 2) % 3]]); }
  const distLine = (p, P, Q) => {
    const d = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]], L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = L ? ((p[0] - P[0]) * d[0] + (p[1] - P[1]) * d[1] + (p[2] - P[2]) * d[2]) / L : 0;
    return Math.hypot(p[0] - P[0] - t * d[0], p[1] - P[1] - t * d[1], p[2] - P[2] - t * d[2]);
  };
  // which way a face leaves the edge A-B: the unit vector from the edge to its third corner, square to the edge (3D).
  // Two faces lie on different sides when they leave in clearly different directions (more than 30 degrees apart): on
  // one side of a fold or of a flat line. Faces leaving the same way overlap (a same-side cover hides a hole).
  const sideOf = (A, B, c) => {
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = L2 ? ((c[0] - A[0]) * d[0] + (c[1] - A[1]) * d[1] + (c[2] - A[2]) * d[2]) / L2 : 0;
    const v = [c[0] - A[0] - t * d[0], c[1] - A[1] - t * d[1], c[2] - A[2] - t * d[2]], l = Math.hypot(...v);
    return l ? v.map(x => x / l) : null;
  };
  const opposite = (s1, s2) => !!s1 && !!s2 && s1[0] * s2[0] + s1[1] * s2[1] + s1[2] * s2[2] < 0.87;
  const closedOnLine = (A, B, C) => {
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (!L2) return true;
    const iv = [], ka = keyOf(A), kb = keyOf(B), own = sideOf(A, B, C);
    const off = p => { const t = ((p[0] - A[0]) * d[0] + (p[1] - A[1]) * d[1] + (p[2] - A[2]) * d[2]) / L2;
      return [t, Math.hypot(p[0] - A[0] - t * d[0], p[1] - A[1] - t * d[1], p[2] - A[2] - t * d[2])]; };
    for (const i of sh.near((A[0] + B[0]) / 2, (A[2] + B[2]) / 2, Math.sqrt(L2) / 2 + 1)) {
      const [P, Q, R] = segs[i], kp = keyOf(P), kq = keyOf(Q);
      if ((kp === ka && kq === kb) || (kp === kb && kq === ka)) continue;
      const [tp, ep] = off(P), [tq, eq] = off(Q);
      // on one line: the shorter edge's ends lie on the longer edge's line (measured that way round, so the rounding of
      // a short edge's ends does not tilt the line it stands for)
      const lpq = Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]);
      const onLine = lpq <= Math.sqrt(L2) ? ep <= 1 && eq <= 1 : distLine(A, P, Q) <= 1 && distLine(B, P, Q) <= 1;
      if (onLine && opposite(own, sideOf(A, B, R))) iv.push([Math.min(tp, tq), Math.max(tp, tq)]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    const gap = 1 / Math.sqrt(L2);
    let reach = 0;
    for (const [a, b] of iv) { if (a > reach + gap) break; reach = Math.max(reach, b); }
    return reach >= 1 - gap;
  };
  // every open edge with the third corner of its face; `report`: not exempt (the outermost wall, near an underpass)
  const cand = [], seen = new Set();
  // bridge: true for the base's own edges, which may stay open near an underpass (the upper road's edge over it, the
  // mouths); the landscape's edges are checked there too
  const flag = (pa, pb, ia, ib, bridge = false, pc = null) => {
    const ka = keyOf(pa), kb = keyOf(pb), k = ka < kb ? ka + ' ' + kb : kb + ' ' + ka;
    if (count.get(k) !== 1 || seen.has(k)) return;
    if (pc && closedOnLine(pa, pb, pc)) return;
    seen.add(k);
    const report = !(ia !== undefined && rim(ia) && rim(ib)) && !(bridge && floor.length && nearBridge(pa, pb));
    cand.push({ a: pa, b: pb, c: pc, ka, kb, report });
  };
  for (const [a, b, c] of terr) flag(pos[a], pos[b], a, b, false, pos[c]);
  // the first cross-section of a kerb is closed by its cap, not by the neighbouring strip
  const capped = new Set(baseTris.filter(t => t.cap).map(t => `${t.path}:${t.fr}:${t.side}`));
  for (const t of baseTris) {                       // the outer row of the base and its end lines
    if (t.cap || !t.n) continue;
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3, a = t.n[j], b = t.n[k];
      if (!EDGE_ROWS.includes(a) || !EDGE_ROWS.includes(b)) continue;
      const along = a === b && a !== 'c' && t.fr[j] !== t.fr[k];      // along the track on the outer row (or the edge)
      const across = a !== b && t.fr[j] === t.fr[k];                   // across the road at a frame (end of the road)
      if (across && capped.has(`${t.path}:${t.fr[j]}:${t.side}`)) continue;
      if (along || across) flag(t.p[j], t.p[k], undefined, undefined, true, t.p[(k + 1) % 3]);
    }
  }
  // The border of the landscape is no hole (2026-10-11, user): the open edges form loops; a loop whose empty side
  // (away from its faces) lies outside it, in plan, is a border - the outer edge of the landscape, also where triangles
  // were deleted at it. A hole has its empty side inside the loop. Edges that do not form one simple loop stay holes.
  const border = new Set(), adj = new Map();
  cand.forEach((e, i) => { for (const k of [e.ka, e.kb]) { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); } });
  const done = new Set();
  cand.forEach((e0, i0) => {
    if (done.has(i0)) return;
    const comp = new Set([i0]), stack = [i0];
    while (stack.length) { const e = cand[stack.pop()]; for (const k of [e.ka, e.kb]) for (const j of adj.get(k)) if (!comp.has(j)) { comp.add(j); stack.push(j); } }
    comp.forEach(i => done.add(i));
    const ks = new Set([...comp].flatMap(i => [cand[i].ka, cand[i].kb]));
    if ([...ks].some(k => adj.get(k).length !== 2) || comp.size < 3) return;            // not one simple loop
    // the loop in order (plan)
    const poly = [], at = new Map();
    for (const i of comp) { at.set(cand[i].ka, cand[i].a); at.set(cand[i].kb, cand[i].b); }
    let k = cand[i0].ka, prev = -1;
    for (let n = 0; n < comp.size; n++) {
      poly.push(at.get(k));
      const nx = adj.get(k).find(j => j !== prev);
      prev = nx; k = cand[nx].ka === k ? cand[nx].kb : cand[nx].ka;
    }
    // the empty side of the loop's longest edge (in plan): just beyond it, away from its face
    let best = null, bl = 0;
    for (const i of comp) { const e = cand[i], l = Math.hypot(e.b[0] - e.a[0], e.b[2] - e.a[2]); if (l > bl && e.c) { bl = l; best = e; } }
    if (!best || bl < 4) return;
    const { a, b, c } = best, dx = (b[0] - a[0]) / bl, dz = (b[2] - a[2]) / bl;
    let nx = -dz, nz = dx;                                                               // a normal in plan
    if (nx * (c[0] - a[0]) + nz * (c[2] - a[2]) > 0) { nx = -nx; nz = -nz; }           // away from the face
    const qx = (a[0] + b[0]) / 2 + nx * 2, qz = (a[2] + b[2]) / 2 + nz * 2;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i], pj = poly[j];
      if ((pi[2] > qz) !== (pj[2] > qz) && qx < (pj[0] - pi[0]) * (qz - pi[2]) / (pj[2] - pi[2]) + pi[0]) inside = !inside;
    }
    if (!inside) comp.forEach(i => border.add(i));
  });
  // opts.borders: the border's edges too (adapt.js keeps the user's cuts at the border as it keeps holes)
  return cand.filter((e, i) => e.report && (opts.borders || !border.has(i))).map(e => [e.a, e.b]);
}

// Connected pieces of the terrain (triangles sharing points): [{tris: [ids], docked: bool}]
// docked: one of its points is docked, or (with pos and baseTris) lies on a vertex of the base
export function components(terrain, pos = null, baseTris = null) {
  const onBase = new Set();
  if (pos && baseTris) for (const t of baseTris) if (!t.covered && !t.deck) for (const p of t.p) onBase.add(wk(p));
  const parent = terrain.points.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const t of terrain.tris) { parent[find(t[0])] = find(t[1]); parent[find(t[1])] = find(t[2]); }
  const groups = new Map();
  terrain.tris.forEach((t, id) => {
    const r = find(t[0]);
    if (!groups.has(r)) groups.set(r, { tris: [], docked: false });
    const g = groups.get(r);
    g.tris.push(id);
    if (t.slice(0, 3).some(i => terrain.points[i].d || (pos && pos[i] && onBase.has(wk(pos[i]))))) g.docked = true;
  });
  return [...groups.values()];
}

// ------------------------------------------------------------------ landscaping comfort (2026-10-11, user's list)
// Delete points: every triangle using one of them goes, then the points no triangle uses any more (of those
// triangles; the base's outer row stays, it belongs to the track). Returns the old -> new index map.
export function deletePoints(terrain, ids) {
  const drop = new Set(ids), corners = new Set();
  terrain.tris = terrain.tris.filter(t => {
    if (!t.slice(0, 3).some(i => drop.has(i))) return true;
    t.slice(0, 3).forEach(i => corners.add(i));
    return false;
  });
  return compact(terrain, i => corners.has(i) || drop.has(i));
}
// Delete triangles and the free points only they used. Returns the old -> new index map.
export function deleteTrianglesAndPoints(terrain, ids) {
  const corners = new Set(ids.flatMap(t => terrain.tris[t].slice(0, 3)));
  deleteTriangles(terrain, ids);
  return compact(terrain, i => corners.has(i));
}

// Fill with triangles: the selected points are triangulated in plan (edges already there between two of them are
// kept); a new triangle is made only where there is nothing yet - no landscape and no base (road, kerbs, verge) under
// its centre. Material and paint come from the neighbours (the most common among the triangles sharing a side with it,
// else a corner), else 'land'. baseTris: the base's triangles as point triples (plan test). Returns the new ids.
export function fillPoints(terrain, ids, pos, baseTris = []) {
  const P = [...new Set(ids)].filter(i => pos[i]);
  if (P.length < 3) return [];
  const local = new Map(P.map((i, k) => [i, k]));
  const constraints = [];
  for (const t of terrain.tris) for (let j = 0; j < 3; j++) {
    const a = local.get(t[j]), b = local.get(t[(j + 1) % 3]);
    if (a !== undefined && b !== undefined) constraints.push([a, b]);
  }
  const res = triangulate(P.map(i => [pos[i][0], pos[i][2]]), constraints);
  // what is there already, in plan
  const plan = ps => ps.map(p => [p[0], p[2]]);
  const have = [], h = new Hash(400);
  const addHave = ps => { have.push(plan(ps)); const xs = ps.map(p => p[0]), zs = ps.map(p => p[2]); h.add(have.length - 1, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)); };
  for (const t of terrain.tris) { const ps = t.slice(0, 3).map(i => pos[i]); if (ps.every(Boolean)) addHave(ps); }
  for (const ps of baseTris) addHave(ps);
  const inTri = (x, z, [a, b, c]) => {
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (!d) return false;
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (z - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (z - c[1])) / d;
    return l1 > 1e-6 && l2 > 1e-6 && 1 - l1 - l2 > 1e-6;
  };
  const covered = (x, z) => [...h.near(x, z, 1)].some(k => inTri(x, z, have[k]));
  // neighbours: by side, by corner
  const bySide = new Map(), byCorner = new Map();
  terrain.tris.forEach((t, id) => {
    for (let j = 0; j < 3; j++) {
      const k = edgeId(t[j], t[(j + 1) % 3]);
      if (!bySide.has(k)) bySide.set(k, []);
      bySide.get(k).push(id);
      if (!byCorner.has(t[j])) byCorner.set(t[j], []);
      byCorner.get(t[j]).push(id);
    }
  });
  const look = V => {
    const count = new Map();
    const vote = list => { for (const id of list) { const t = terrain.tris[id], k = t[3] + '|' + (t[4] || ''); count.set(k, (count.get(k) || 0) + 1); } };
    for (let j = 0; j < 3; j++) vote(bySide.get(edgeId(V[j], V[(j + 1) % 3])) || []);
    if (!count.size) for (const v of V) vote(byCorner.get(v) || []);
    if (!count.size) return ['land'];
    const [mat, paint] = [...count].sort((a, b) => b[1] - a[1])[0][0].split('|');
    return paint ? [mat, paint] : [mat];
  };
  const made = [];
  for (const tri of res.tris) {
    const V = tri.map(k => P[k]);
    if (new Set(V).size < 3) continue;
    const ps = V.map(i => pos[i]);
    if (Math.abs(orient(ps[0], ps[1], ps[2])) < 2) continue;                    // no area in plan
    const cx = (ps[0][0] + ps[1][0] + ps[2][0]) / 3, cz = (ps[0][2] + ps[1][2] + ps[2][2]) / 3;
    if (covered(cx, cz)) continue;
    const [a, b, c] = orient(ps[0], ps[1], ps[2]) >= 0 ? V : [V[0], V[2], V[1]];
    made.push([a, b, c, ...look(V)]);
  }
  const n0 = terrain.tris.length;
  terrain.tris.push(...made);
  return made.map((_, k) => n0 + k);
}

// Copy: the triangles with their corners' positions (relative to their centre), material and paint
export function copyTriangles(terrain, ids, pos) {
  const tris = ids.map(t => terrain.tris[t]).filter(t => t.slice(0, 3).every(i => pos[i]));
  if (!tris.length) return null;
  const idx = [...new Set(tris.flatMap(t => t.slice(0, 3)))], at = new Map(idx.map((i, k) => [i, k]));
  const c = [0, 1, 2].map(k => idx.reduce((s, i) => s + pos[i][k], 0) / idx.length);
  return { points: idx.map(i => pos[i].map((v, k) => v - c[k])), tris: tris.map(t => [at.get(t[0]), at.get(t[1]), at.get(t[2]), ...t.slice(3)]), centre: c };
}
// Paste a copy with its centre at `at` (game coordinates): new free points (a floating piece until it is joined to
// the landscape, e.g. by filling). Returns {points, tris} (the new ids).
export function pasteTriangles(terrain, clip, at) {
  const n0 = terrain.points.length, t0 = terrain.tris.length;
  for (const p of clip.points) terrain.points.push({ p: p.map((v, k) => Math.round(v + at[k])) });
  for (const t of clip.tris) terrain.tris.push([t[0] + n0, t[1] + n0, t[2] + n0, ...t.slice(3)]);
  return { points: clip.points.map((_, k) => n0 + k), tris: clip.tris.map((_, k) => t0 + k) };
}

// To ground: one height shift for all the points (ids, free to move) so that the points at the selection's border come
// as near as they can to their neighbours outside it (least squares over the edges from a selected to an unselected
// point). Returns the shift, or null when no point of the selection has an unselected neighbour.
export function groundShift(terrain, ids, pos) {
  const chosen = new Set(ids);
  let sum = 0, n = 0;
  const seen = new Set();
  for (const t of terrain.tris) for (let j = 0; j < 3; j++) {
    const a = t[j], b = t[(j + 1) % 3];
    if (chosen.has(a) === chosen.has(b)) continue;
    const [s, o] = chosen.has(a) ? [a, b] : [b, a], k = edgeId(s, o);
    if (seen.has(k) || !pos[s] || !pos[o]) continue;
    seen.add(k); sum += pos[o][1] - pos[s][1]; n++;
  }
  return n ? sum / n : null;
}
