// Track paths of a level: the closed main loop and the open branches, in
// driving order, as cubic splines through the control points: Catmull-Rom tangents by default (knot mode auto),
// the knot's own handles (linked / separated: ti incoming, to outgoing, offsets stored in loop order), or straight
// in and out at a corner knot. Every
// segment between two control points is cut into sections of about
// track.section length, so section boundaries lie on the control points
// (forks, merges and jumps then fall on section boundaries).
import { nodeMap, edgeKey, DEFAULT_WIDTH, DEFAULT_VERGE } from './model.js';

// cubic Hermite from p1 (tangent m1) to p2 (tangent m2); with m = (next - previous) / 2 it is the Catmull-Rom spline
const herm = (p1, m1, p2, m2, t) => { const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2; };
const KEYS = ['x', 'y', 'z', 'width', 'vl', 'vr'], XYZ = ['x', 'y', 'z'];
// the handles of a knot in driving order (null: automatic); stored in loop order, so a reversed track swaps them
const handles = (n, rev) => (n && (n.tm === 'linked' || n.tm === 'separated') && n.ti && n.to ? (rev ? { in: n.to, out: n.ti } : { in: n.ti, out: n.to }) : null);
// the automatic (Catmull-Rom) handles of a knot in loop order: {ti, to} = -+ (next - previous) / 6 (a Bezier handle is
// a third of the Hermite tangent); used when a knot switches to linked / separated
export function autoHandles(track, id) {
  const nodes = nodeMap(track), m = track.main, i = m.indexOf(id);
  let prev, next;
  if (i >= 0) { prev = nodes.get(m[(i - 1 + m.length) % m.length]); next = nodes.get(m[(i + 1) % m.length]); }
  else {
    const b = track.branches.find(x => x.nodes.includes(id)), full = b ? [b.from, ...b.nodes, b.to] : null, k = full ? full.indexOf(id) : -1;
    if (k > 0 && k < full.length - 1) { prev = nodes.get(full[k - 1]); next = nodes.get(full[k + 1]); }
  }
  if (!prev || !next) return { ti: [0, 0, 0], to: [0, 0, 0] };
  const m6 = ['x', 'y', 'z'].map(c => Math.round(((next[c] ?? 0) - (prev[c] ?? 0)) / 6));
  return { ti: m6.map(v => -v), to: m6 };
}
export const VERGE_DEFAULT = DEFAULT_VERGE;   // drivable ground beside the road (control point fields vl = left, vr = right)
const DEF = { width: DEFAULT_WIDTH, vl: VERGE_DEFAULT, vr: VERGE_DEFAULT };
const DENSE = 48;                       // spline samples per segment for lengths and drawing

// Main loop and branches in driving order, the main loop rotated to start at
// the start node. Branch direction follows the main loop.
export function orderedTrack(track) {
  let main = track.main.slice();
  let branches = track.branches.map(b => ({ id: b.id, from: b.from, to: b.to, nodes: b.nodes.slice() }));
  if (track.start?.reverse) {
    main.reverse();
    branches = branches.map(b => ({ id: b.id, from: b.to, to: b.from, nodes: b.nodes.slice().reverse() }));
  }
  const s = main.indexOf(track.start?.node);
  if (s > 0) main = main.slice(s).concat(main.slice(0, s));
  return { main, branches };
}

// One path: ids of its control points in driving order, closed or open; an
// open path (branch) borrows the main loop's neighbours of its end points as
// spline phantoms, so it leaves and joins the main loop smoothly.
function makePath(key, ids, closed, nodes, phantom = null, rev = false) {
  const pts = ids.map(id => nodes.get(id));
  const n = pts.length;
  const get = k => {
    if (closed) return pts[((k % n) + n) % n];
    if (k < 0) return phantom ? phantom[0] : pts[0];
    if (k >= n) return phantom ? phantom[1] : pts[n - 1];
    return pts[k];
  };
  const segs = closed ? n : n - 1;
  // position (and width) on segment i at parameter t (t may leave 0..1 a little)
  const at = (i, t) => {
    const [p0, p1, p2, p3] = [i - 1, i, i + 1, i + 2].map(get);
    const r = {}, ha = handles(p1, rev), hb = handles(p2, rev);
    for (const c of KEYS) {
      const v = [p0, p1, p2, p3].map(q => q[c] ?? DEF[c] ?? 0), k = XYZ.indexOf(c);
      let m1 = (v[2] - v[0]) / 2, m2 = (v[3] - v[1]) / 2;
      if (k >= 0) {
        if (p1.tm === 'corner') m1 = v[2] - v[1]; else if (ha) m1 = 3 * ha.out[k];
        if (p2.tm === 'corner') m2 = v[2] - v[1]; else if (hb) m2 = -3 * hb.in[k];
      }
      r[c] = herm(v[1], m1, v[2], m2, t);
    }
    return r;
  };
  return { key, ids, closed, segs, at, edge: i => [ids[i], ids[(i + 1) % n]], cornerAt: i => pts[i]?.tm === 'corner' };
}

// Frame on segment i at t: centre, left direction (x, z), half width. At a corner knot (t = 0 of its segment) the
// frame is the mitre of the two roads meeting there: left along the bisector of their cross lines, every offset
// (half width, verges) stretched by 1 / cos(half the turn), capped at 3, so the rows of both sides join on one line
function frame(path, i, t) {
  const p = path.at(i, t), a = path.at(i, t - 0.01), b = path.at(i, t + 0.01);
  const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
  let left = [-tz / tl, tx / tl], k = 1;
  if (t === 0 && path.cornerAt(i) && (path.closed || i > 0)) {
    const j = (i - 1 + path.segs) % path.segs, a2 = path.at(j, 0.99), b2 = path.at(j, 1);
    const ix = b2.x - a2.x, iz = b2.z - a2.z, il = Math.hypot(ix, iz) || 1, lin = [-iz / il, ix / il];
    const ox = b.x - p.x, oz = b.z - p.z, ol = Math.hypot(ox, oz) || 1, lout = [-oz / ol, ox / ol];
    const mx = lin[0] + lout[0], mz = lin[1] + lout[1], ml = Math.hypot(mx, mz);
    if (ml > 1e-6) { left = [mx / ml, mz / ml]; k = 1 / Math.max(1 / 3, left[0] * lout[0] + left[1] * lout[1]); }
  }
  return { c: [p.x, p.y, p.z], left, half: Math.max(60, p.width) / 2 * k, vl: Math.max(0, p.vl) * k, vr: Math.max(0, p.vr) * k, seg: i, t };
}

// Longest section (and thus road triangle along the road) the painter of the game copes with:
// the game sorts triangles by mean depth without a depth buffer; at 350 the car, its shadow and
// tyre marks were painted over by road triangles, at 200 not any more (game test 2026-10-04).
// 250 like the originals (239-296, LEVELFORMAT.md ch. 18) since 2026-10-08 (user's wish, to be
// confirmed in the game).
export const MAX_SECTION = 250;

// Section boundaries of a path: per segment k = ceil(length / step) (at least 1)
// pieces of equal arc length, so no section is longer than step. Returns frames; section j runs from frames[j] to
// frames[j + 1] (closed: the last one back to frames[0]).
function sections(path, step, cuts) {
  const frames = [];
  for (let i = 0; i < path.segs; i++) {
    const dense = [];
    for (let j = 0; j <= DENSE; j++) dense.push(path.at(i, j / DENSE));
    const acc = [0];
    for (let j = 1; j <= DENSE; j++) acc.push(acc[j - 1] + Math.hypot(dense[j].x - dense[j - 1].x, dense[j].z - dense[j - 1].z));
    const len = acc[DENSE], key = edgeKey(...path.edge(i));
    // cuts[key]: number of sections of the segment, frozen once the terrain is built (terrain points refer to frames by index)
    const k = cuts?.[key] > 0 ? cuts[key] : Math.max(1, Math.ceil(len / step - 1e-6));
    for (let q = 0; q < k; q++) {
      const target = (q / k) * len;
      let j = 0;
      while (j < DENSE - 1 && acc[j + 1] < target) j++;
      const t = (j + (acc[j + 1] > acc[j] ? (target - acc[j]) / (acc[j + 1] - acc[j]) : 0)) / DENSE;
      frames.push(frame(path, i, t));
    }
  }
  if (!path.closed) frames.push(frame(path, path.segs - 1, 1));
  return frames;
}

// Dense polyline of a path for drawing and picking: [{p: [x, y, z], seg}].
function polyline(path) {
  const out = [];
  for (let i = 0; i < path.segs; i++) {
    for (let j = 0; j < DENSE; j++) {
      const p = path.at(i, j / DENSE);
      out.push({ p: [p.x, p.y, p.z], seg: i });
    }
  }
  const last = path.closed ? path.at(0, 0) : path.at(path.segs - 1, 1);
  out.push({ p: [last.x, last.y, last.z], seg: path.segs - 1 });
  return out;
}

// frames lerped: c, half, verge widths linear, left re-normalised
export function lerpFrame(a, b, u) {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const l = [a.left[0] + (b.left[0] - a.left[0]) * u, a.left[1] + (b.left[1] - a.left[1]) * u], n = Math.hypot(...l) || 1;
  return { c: [0, 1, 2].map(k => a.c[k] + (b.c[k] - a.c[k]) * u), left: [l[0] / n, l[1] / n],
           half: a.half + (b.half - a.half) * u, vl: a.vl + (b.vl - a.vl) * u, vr: a.vr + (b.vr - a.vr) * u };
}

// Canonical view of every segment (node ids sorted: a|b with a < b), independent of the driving
// direction and of where the start is: Map key -> {key, path, seg, canon, k, frames}, frames[0..k] in
// canonical direction, left/vl/vr in canonical orientation; drv[q]: index in path.frames of the q-th frame
// in driving direction. Terrain points dock to these frames.
export function segmentTable(paths) {
  const table = new Map();
  for (const path of paths.all) {
    const fr = path.frames;
    for (let s = 0; s < path.segs; s++) {
      const idx = [];
      fr.forEach((f, j) => { if (f.seg === s) idx.push(j); });
      const list = idx.map(j => fr[j]);
      if (list[list.length - 1].t !== 1) {
        const end = path.closed && s === path.segs - 1 ? 0 : idx[idx.length - 1] + 1;
        list.push(fr[end]); idx.push(end);
      }
      const [a, b] = path.edge(s), canon = a < b;
      const frames = canon ? list : list.slice().reverse().map(f => ({ ...f, left: [-f.left[0], -f.left[1]], vl: f.vr, vr: f.vl }));
      table.set(edgeKey(a, b), { key: edgeKey(a, b), path, seg: s, canon, k: list.length - 1, frames, drv: idx });
    }
  }
  return table;
}

// All paths of a level with section frames and polylines.
// Returns {main, branches: [...], all: [...]}; each path:
// {key, ids, closed, segs, edge(i), frames, line, jump: [bool per segment]}

export function buildPaths(track) {
  const nodes = nodeMap(track);
  const { main, branches } = orderedTrack(track);
  const jumps = new Set(track.jumps || []), rev = !!track.start?.reverse;
  const step = Math.min(track.section ?? MAX_SECTION, MAX_SECTION);   // longer sections let road triangles paint over the car
  const finish = path => {
    path.frames = sections(path, step, track.cuts);
    path.line = polyline(path);
    path.jump = [...Array(path.segs).keys()].map(i => jumps.has(edgeKey(...path.edge(i))));
    return path;
  };
  const m = finish(makePath('main', main, true, nodes, null, rev));
  const bs = branches.map(b => {
    const iF = main.indexOf(b.from), iT = main.indexOf(b.to), n = main.length;
    const phantom = iF >= 0 && iT >= 0 ? [nodes.get(main[(iF - 1 + n) % n]), nodes.get(main[(iT + 1) % n])] : null;
    const p = finish(makePath(b.id, [b.from, ...b.nodes, b.to], false, nodes, phantom, rev));
    p.from = b.from; p.to = b.to; p.iFrom = iF; p.iTo = iT;
    return p;
  });
  return { main: m, branches: bs, all: [m, ...bs], order: main };
}
