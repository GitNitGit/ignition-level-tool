// Keeping the landscape and the settings of the road when the track changes (mode 1).
//
// Every change of the track (moving, width, verge, new or deleted control points, branches, jumps) goes through
// adaptLevel(level, old), with `old` the compiled state before the change:
//   1. Settings per segment (kerbs, slippery, order, ramp, no verge, signs, base paint) move to the new segments: a
//      segment that was split by a new point or merged by a deleted one is mapped along the chain of segments
//      between the points that exist before and after (by arc length).
//   2. The number of sections per segment stays frozen unless a segment got too long for it (MAX_SECTION).
//   3. The landscape is pushed: every point of the base's outer row moves from where it was to where it is now; a
//      terrain point takes the displacement of the outer row near it, fully up to `band` from the road and less and
//      less further out (the farther the push, the wider it fades, so the neighbours are pushed in proportion and
//      nothing folds). Terrain points are free (absolute) from then on; only the outer row stays docked to the base.
//   4. Only where the base no longer fits (its outer row was cut differently, a road appeared on or vanished from the
//      landscape, a triangle turned over) the triangles are taken out and the hole is filled again (constrained
//      Delaunay between the base and the remaining landscape, ring points beside new road). A new jump only takes
//      out the road: the landscape beside it stays, the gap is filled flat at road height with deadly ground.
//      Everything else is kept as it is, with its material and colour.
import { edgeKey } from './model.js';
import { buildPaths, segmentTable } from './paths.js';
import { buildBase } from './base.js';
import { baseOutline, BAKE_DEFAULTS } from './bake.js';
import { dockContext, dockPos, resolve, components, compact, openEdges } from './terrain.js';
import { triangulate } from './cdt.js';
import { Hash, segDist } from './sections.js';
import { pyRound } from './util.js';

// ------------------------------------------------------------------ segments old -> new
const nodesOf = segs => { const s = new Set(); for (const k of segs.keys()) k.split('|').forEach(n => s.add(n)); return s; };
const graphOf = segs => {
  const g = new Map();
  for (const k of segs.keys()) {
    const [a, b] = k.split('|');
    for (const [x, y] of [[a, b], [b, a]]) { if (!g.has(x)) g.set(x, []); g.get(x).push({ key: k, to: y }); }
  }
  return g;
};
const lenOf = e => {
  let L = 0;
  for (let q = 1; q <= e.k; q++) L += Math.hypot(e.frames[q].c[0] - e.frames[q - 1].c[0], e.frames[q].c[2] - e.frames[q - 1].c[2]);
  return L || 1;
};
// canonical spline parameter of the frames of a segment (ranges are stored in it) and their arc fraction
const ctOf = e => e.frames.map((f, q) => (e.canon ? (q === e.k ? 1 : f.t) : (q === 0 ? 0 : 1 - f.t)));
const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  for (let j = 1; j < xs.length; j++) if (x <= xs[j]) return ys[j - 1] + (ys[j] - ys[j - 1]) * ((x - xs[j - 1]) / ((xs[j] - xs[j - 1]) || 1));
  return ys[ys.length - 1];
};
const arcs = e => [...Array(e.k + 1).keys()].map(q => q / e.k);
export const tToArc = (e, t) => interp(ctOf(e), arcs(e), t);
export const arcToT = (e, a) => interp(arcs(e), ctOf(e), a);

// Map positions on old segments to new ones. point(key, a) -> {key, a, flip} | null, ranges(key, a0, a1) ->
// [{key, a0, a1, flip}] (a: arc fraction in the canonical direction; flip: the canonical direction turned, so a side
// +1 becomes -1).
export function segmentMap(oldSegs, newSegs) {
  const oldN = nodesOf(oldSegs), newN = nodesOf(newSegs), og = graphOf(oldSegs), ng = graphOf(newSegs);
  const chain = (nodes, segs) => {
    let off = 0;
    const list = [];
    for (let j = 0; j + 1 < nodes.length; j++) {
      const key = edgeKey(nodes[j], nodes[j + 1]), e = segs.get(key);
      if (!e) return null;
      const len = lenOf(e);
      list.push({ key, fwd: nodes[j] < nodes[j + 1], len, off });
      off += len;
    }
    return { list, total: off || 1 };
  };
  const memo = new Map();
  const pairOf = key => {
    if (memo.has(key)) return memo.get(key);
    let res = null;
    const [a, b] = key.split('|');
    // old chain: on through points that are gone, to points that still exist
    const walk = (from, via) => {
      const nodes = [from];
      let node = from, cur = via;
      while (!newN.has(node)) {
        const nx = (og.get(node) || []).filter(x => x.key !== cur);
        if (nx.length !== 1 || nodes.length > 64) return null;
        cur = nx[0].key; node = nx[0].to; nodes.push(node);
      }
      return nodes;
    };
    const L = oldSegs.has(key) && walk(a, key), R = oldSegs.has(key) && walk(b, key);
    if (L && R) {
      const oldNodes = [...L.slice().reverse(), ...R], A = oldNodes[0], B = oldNodes[oldNodes.length - 1];
      // new chain between the same two points, through points that are new
      let found = null;
      const dfs = (node, path) => {
        if (found || path.length > 64) return;
        for (const { to } of ng.get(node) || []) {
          if (found) return;
          if (to === B) { found = [...path, to]; return; }
          if (!oldN.has(to) && !path.includes(to)) dfs(to, [...path, to]);
        }
      };
      if (A !== B) dfs(A, [A]);
      const from = chain(oldNodes, oldSegs), to = found && chain(found, newSegs);
      if (from && to) res = { from, to, at: from.list.find(x => x.key === key) };
    }
    memo.set(key, res);
    return res;
  };
  const toU = (p, a) => (p.at.off + (p.at.fwd ? a : 1 - a) * p.at.len) / p.from.total;
  return {
    point(key, a) {
      if (newSegs.has(key)) return { key, a, flip: false };
      const p = pairOf(key);
      if (!p) return null;
      const S = toU(p, a) * p.to.total;
      const n = p.to.list.find(x => S <= x.off + x.len + 1e-9) || p.to.list[p.to.list.length - 1];
      const f = Math.min(1, Math.max(0, (S - n.off) / n.len));
      return { key: n.key, a: n.fwd ? f : 1 - f, flip: n.fwd !== p.at.fwd };
    },
    ranges(key, a0, a1) {
      if (newSegs.has(key)) return [{ key, a0, a1, flip: false }];
      const p = pairOf(key);
      if (!p) return [];
      let u0 = toU(p, a0), u1 = toU(p, a1);
      if (u0 > u1) [u0, u1] = [u1, u0];
      const out = [];
      for (const n of p.to.list) {
        const lo = Math.max(u0 * p.to.total, n.off), hi = Math.min(u1 * p.to.total, n.off + n.len);
        if (hi - lo <= 1e-6) continue;
        const f0 = (lo - n.off) / n.len, f1 = (hi - n.off) / n.len;
        out.push({ key: n.key, a0: n.fwd ? f0 : 1 - f1, a1: n.fwd ? f1 : 1 - f0, flip: n.fwd !== p.at.fwd });
      }
      return out;
    },
  };
}

// ranges keyed "<segment>[:<side>][rest]" -> moved to the new segments where the segment is gone
function remapRanges(map, smap, oldSegs, newSegs) {
  if (!map) return;
  for (const k of Object.keys(map)) {
    const m = k.match(/^([^:|]+\|[^:|]+)(?::(-?1))?(.*)$/);
    if (!m || newSegs.has(m[1]) || !oldSegs.has(m[1])) continue;
    const [, seg, side, rest] = m, e = oldSegs.get(seg);
    const list = map[k];
    delete map[k];
    for (const [t0, t1, ...more] of list) {
      for (const r of smap.ranges(seg, tToArc(e, t0), tToArc(e, t1))) {
        const ne = newSegs.get(r.key);
        const nk = r.key + (side ? ':' + (r.flip ? -Number(side) : Number(side)) : '') + rest;
        const a = Number(arcToT(ne, r.a0).toFixed(5)), b = Number(arcToT(ne, r.a1).toFixed(5));
        if (b - a <= 1e-5) continue;
        (map[nk] ||= []).push([a, b, ...more]);
      }
    }
  }
  for (const k of Object.keys(map)) map[k].sort((x, y) => x[0] - y[0]);
}

// ------------------------------------------------------------------ helpers
const orient = (a, b, c) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
const xzKey = p => pyRound(p[0]) + ',' + pyRound(p[2]);
// do the insides of two triangles (plan view, [x, z] corners) overlap? (touching edges do not count)
function overlap(A, B) {
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (let j = 0; j < 3; j++) {
      const a = P[j], b = P[(j + 1) % 3], nx = a[1] - b[1], nz = b[0] - a[0], len = Math.hypot(nx, nz);
      if (!len) continue;
      const pr = p => (p[0] * nx + p[1] * nz) / len;
      const ps = P.map(pr), qs = Q.map(pr);
      if (Math.max(...ps) <= Math.min(...qs) + 1 || Math.max(...qs) <= Math.min(...ps) + 1) return false;
    }
  }
  return true;
}
const inTri = (x, z, a, b, c) => {
  const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (!d) return false;
  const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
  return l1 > 1e-6 && l2 > 1e-6 && 1 - l1 - l2 > 1e-6;
};

// ------------------------------------------------------------------ the push
// the segments of a base that are jumps (no road, kerbs or verge there)
export const jumpKeys = base => new Set((base.an?.secs || []).filter(s => s.jump).map(s => edgeKey(...s.path.edge(s.f0.seg))));
// anchors: the outer row of the base, old position and displacement. Where a segment is or was a jump the outer row
// is the road's edge on one side of the change and the verge's on the other: no push there (the landscape stays)
function anchorsOf(oldBase, base, smap) {
  const out = [], oldJ = jumpKeys(oldBase), newJ = jumpKeys(base);
  // the end frames next to a gap change with it too (the verge ends there)
  const changed = new Set([...oldJ, ...newJ].filter(k => oldJ.has(k) !== newJ.has(k)));
  const gapNodes = new Set([...changed].flatMap(k => k.split('|')));
  for (const [key, e] of oldBase.segs) {
    const [na, nb] = key.split('|');
    for (const sc of [1, -1]) {
      for (let q = 0; q <= e.k; q++) {
        const p0 = oldBase.vPos(key, sc, q);
        const m = smap.point(key, q / e.k);
        if (!p0 || !m) continue;
        const ne = base.segs.get(m.key), p1 = ne && base.vPos(m.key, m.flip ? -sc : sc, m.a * ne.k);
        if (!p1 || p0.some(v => !Number.isFinite(v)) || p1.some(v => !Number.isFinite(v))) continue;
        if (oldJ.has(key) !== newJ.has(m.key) || (q === 0 && gapNodes.has(na)) || (q === e.k && gapNodes.has(nb))) {
          out.push({ p: oldJ.has(key) ? p1 : p0, d: [0, 0, 0] });
          continue;
        }
        out.push({ p: p0, d: [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]] });
      }
    }
  }
  return out;
}
export function pushField(anchors, band = BAKE_DEFAULTS.band) {
  if (!anchors.some(a => Math.abs(a.d[0]) + Math.abs(a.d[1]) + Math.abs(a.d[2]) > 0.5)) return () => null;
  const hash = new Hash(500);
  anchors.forEach((a, i) => hash.add(i, a.p[0], a.p[2], a.p[0], a.p[2]));
  return p => {
    let rmin = Infinity;
    for (let r = 500; r <= 128000 && rmin === Infinity; r *= 2) {
      for (const i of hash.near(p[0], p[2], r)) rmin = Math.min(rmin, Math.hypot(anchors[i].p[0] - p[0], anchors[i].p[2] - p[2]));
    }
    if (rmin === Infinity) return null;
    const D = [0, 0, 0];
    let W = 0;
    for (const i of hash.near(p[0], p[2], rmin + 600)) {
      const a = anchors[i], r = Math.hypot(a.p[0] - p[0], a.p[2] - p[2]);
      if (r > rmin + 600) continue;
      const w = 1 / (r * r + 2500);
      W += w; D[0] += a.d[0] * w; D[1] += a.d[1] * w; D[2] += a.d[2] * w;
    }
    const m = Math.hypot(D[0] / W, D[1] / W, D[2] / W), R1 = band + Math.max(2500, 3 * m);
    const x = rmin <= band ? 1 : rmin >= R1 ? 0 : 1 - (rmin - band) / (R1 - band);
    const f = x * x * (3 - 2 * x);
    return f ? D.map(v => (v / W) * f) : null;
  };
}

// ------------------------------------------------------------------ main
// old: {base, pos} of the compiled level before the change (compileLevel(...).base and .terrainInfo.pos).
// Returns {removed, added} (triangles taken out and filled in again).
export function adaptLevel(level, old, opts = {}) {
  const B = { ...BAKE_DEFAULTS, ...opts };
  const T = level.terrain, track = level.track;
  // new segments (the keys do not depend on the cuts)
  let paths = buildPaths(track), segs = segmentTable(paths);
  const smap0 = segmentMap(old.base.segs, segs);
  for (const name of ['kerbs', 'slippery', 'order', 'ramp', 'noVerge', 'noTerrain']) remapRanges(track[name], smap0, old.base.segs, segs);
  for (const group of [track.signs, track.camera]) for (const v of Object.keys(group || {})) remapRanges(group[v], smap0, old.base.segs, segs);
  remapRanges(level.paint?.base, smap0, old.base.segs, segs);
  if (!T || !track.cuts) return { removed: 0, added: 0 };

  // sections: frozen, unless a segment got too long for its number of sections
  const natural = segmentTable(buildPaths({ ...track, cuts: undefined }));
  const cuts = {};
  for (const [key, e] of natural) cuts[key] = track.cuts[key] >= e.k ? track.cuts[key] : e.k;
  track.cuts = cuts;
  paths = buildPaths(track);
  const base = buildBase(level, paths), ctx = dockContext(base);
  const smap = segmentMap(old.base.segs, base.segs);

  // floating pieces (objects) stay apart
  const objTris = new Set(components(T, old.pos, old.base.tris).filter(c => !c.docked).flatMap(c => c.tris));
  const objPts = new Set([...objTris].flatMap(id => T.tris[id].slice(0, 3)));
  // holes there were before (the user's, where an object was cut loose, where the base cannot be met): they are not
  // filled (opts.fillHoles: they are, a repair). Their points are known by index (terrain) or by dock (base).
  const oldOutline = baseOutline(old.base);
  const holes = { pts: new Set(), docks: new Set() };
  if (!opts.fillHoles) {
    const byPos = new Map(), dockAt = new Map();
    old.pos.forEach((p, i) => { if (p) { const k = xzKey(p); if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(i); } });
    oldOutline.baseTris.forEach(t => t.p.forEach((p, k) => { const d = oldOutline.dockOf(t, k); if (d) dockAt.set(xzKey(p), d); }));
    const ground = { points: T.points, tris: T.tris.filter((_, id) => !objTris.has(id)) };
    for (const e of openEdges(ground, old.pos, old.base.tris, { borders: true })) for (const p of e) {
      for (const i of byPos.get(xzKey(p)) || []) holes.pts.add(i);
      const d = dockAt.get(xzKey(p));
      if (d) holes.docks.add(d.slice(0, 4).join(','));
    }
  }
  // ---- points that lie on the base (its outer row, kerb rows) are docked to it, so they follow it exactly. Where
  // several base vertices were in one place (rows merged in a tight bend) and are not any more, the point cannot
  // follow all of them: its triangles are made again.
  const split = new Set(), onCut = new Set();
  {
    const { dockOf, baseTris } = oldOutline, h = new Hash(100), at = [];
    baseTris.forEach(t => t.p.forEach((p, k) => { at.push({ p, d: dockOf(t, k) }); h.add(at.length - 1, p[0], p[2], p[0], p[2]); }));
    T.points.forEach((P, i) => {
      const p = old.pos[i];
      if (!p || objPts.has(i)) return;
      const same = [...h.near(p[0], p[2], 2)].map(j => at[j]).filter(({ p: q }) => Math.abs(q[0] - p[0]) < 1.5 && Math.abs(q[2] - p[2]) < 1.5 && Math.abs(q[1] - p[1]) < 1.5);
      if (!same.length) return;
      const docked = same.filter(s => s.d);
      // a corner of a cut piece (junction, base.js) has no dock: it stays only where the new base has a vertex too
      if (!docked.length) { if (!P.lock) onCut.add(i); return; }
      if (!P.lock) { P.d = docked[0].d; P.lock = 1; delete P.p; }
      const now = docked.map(s => dockPos(s.d, ctx));
      if (now.some(q => !q || Math.hypot(q[0] - now[0][0], q[2] - now[0][2]) > 1)) split.add(i);
    });
  }
  // ---- push: all points except the docked outer row become free and move with the base near them
  const field = pushField(anchorsOf(old.base, base, smap), B.band);
  // the outer wall stays where it is; the push fades out towards it and never goes through it
  const rim = T.points.map((P, i) => (P.rim ? old.pos[i] : null)).filter(Boolean);
  const box = rim.length ? [Math.min(...rim.map(p => p[0])), Math.min(...rim.map(p => p[2])), Math.max(...rim.map(p => p[0])), Math.max(...rim.map(p => p[2]))] : null;
  const toWall = p => (box ? Math.min(p[0] - box[0], p[2] - box[1], box[2] - p[0], box[3] - p[2]) : Infinity);
  T.points.forEach((P, i) => {
    if (P.lock) return;
    const p0 = (old.pos[i] || P.p || [])?.map(Math.round);     // rounded first: points in one place move alike
    if (p0.length !== 3) return;
    let d = P.rim ? null : field(p0);
    if (d && box) {
      const f = Math.max(0, Math.min(1, toWall(p0) / 1500));
      d = d.map(v => v * f);
      const x = Math.max(box[0] + 20, Math.min(box[2] - 20, p0[0] + d[0])), z = Math.max(box[1] + 20, Math.min(box[3] - 20, p0[2] + d[2]));
      d = [x - p0[0], d[1], z - p0[2]];
    }
    P.p = d ? [0, 1, 2].map(k => Math.round(p0[k] + d[k])) : p0.map(Math.round);
    delete P.d;
  });
  return restitch(level, base, ctx, old, B, split, holes, onCut);
}

function restitch(level, base, ctx, old, B, split, holes, onCut) {
  const T = level.terrain;
  const pos = resolve(T, ctx);
  const { frameDock, dockOf, baseTris, coverTris, underBridge } = baseOutline(base);
  // base vertices where the terrain can meet them
  const vmap = new Map();
  baseTris.forEach(t => t.p.forEach((p, k) => { const d = dockOf(t, k), key = xzKey(p); if (!vmap.has(key) || d) vmap.set(key, { p, d }); }));
  // a docked point is still right if its segment has the same sections and the base has a vertex there
  const sameCuts = key => old.base.segs.get(key)?.k === base.segs.get(key)?.k;
  const validLock = i => pos[i] && sameCuts(T.points[i].d[0]) && vmap.has(xzKey(pos[i])) && vmap.get(xzKey(pos[i])).d;
  // a segment that became a jump: the road, kerbs and verge there are gone, but the landscape beside them stays as it
  // is - the points on their outer row (and at the ends of the gap, where the verge ends now) become free points where
  // they were, and only the gap is filled (flat, deadly)
  const jumpSegs = jumpKeys(base), wasJump = jumpKeys(old.base);
  const changed = [...new Set([...jumpSegs, ...wasJump])].filter(k => jumpSegs.has(k) !== wasJump.has(k));
  const gapNodes = new Set(changed.flatMap(k => k.split('|')));
  const nearGap = key => changed.includes(key) || key.split('|').some(n => gapNodes.has(n));
  const gap = new Set();
  T.points.forEach((P, i) => {
    if (!P.lock || !P.d || !jumpSegs.has(P.d[0]) && !nearGap(P.d[0]) || !old.pos[i]) return;
    const moved = !pos[i] || Math.hypot(...[0, 1, 2].map(k => pos[i][k] - old.pos[i][k])) > 1;
    if (validLock(i) && !moved) return;
    P.p = old.pos[i].map(Math.round); delete P.d; delete P.lock;
    pos[i] = P.p; gap.add(i);
  });
  // the other way round (a jump taken out, the road back): free points lying exactly on a vertex of the new base's
  // outer row dock to it again, so the landscape beside the road stays as it is
  {
    const vh = new Hash(100), vs = [];
    baseTris.forEach(t => t.p.forEach((p, k) => { const d = dockOf(t, k); if (d) { vs.push({ p, d }); vh.add(vs.length - 1, p[0], p[2], p[0], p[2]); } }));
    T.points.forEach((P, i) => {
      const p = pos[i];
      if (P.lock || P.rim || !p || gap.has(i)) return;
      const v = [...vh.near(p[0], p[2], 2)].map(j => vs[j]).find(({ p: q }) => Math.abs(q[0] - p[0]) < 1.5 && Math.abs(q[2] - p[2]) < 1.5 && Math.abs(q[1] - p[1]) < 1.5);
      if (!v || !nearGap(v.d[0]) || jumpSegs.has(v.d[0])) return;
      P.d = v.d; P.lock = 1; delete P.p;
      pos[i] = dockPos(v.d, ctx) || p;
    });
  }
  const baseHash = new Hash(400);
  baseTris.forEach((t, k) => baseHash.add(k, ...boxOf(t.p)));
  // a free point pushed (almost) onto an edge or a vertex of the base would leave a sliver: it is made again
  const touchesBase = p => {
    for (const k of baseHash.near(p[0], p[2], 5)) {
      const t = baseTris[k];
      for (let j = 0; j < 3; j++) {
        const a = t.p[j], b = t.p[(j + 1) % 3];
        if (segDist([p[0], p[2]], [a[0], a[2]], [b[0], b[2]])[0] < 4) return true;
      }
    }
    return false;
  };
  // floating pieces (not connected to the base) are objects: they stay as they are
  const floating = new Set(components(T, pos, base.tris).filter(c => !c.docked).flatMap(c => c.tris));
  const onObject = new Set([...floating].flatMap(id => T.tris[id].slice(0, 3)));
  const bad = new Set(T.points.map((P, i) => i).filter(i => !pos[i] || (split.has(i) && !gap.has(i)) || (onCut.has(i) && !vmap.has(xzKey(pos[i]))) ||
    (T.points[i].lock ? !validLock(i) : !onObject.has(i) && touchesBase(pos[i]))));

  const plan = ps => ps.map(p => [p[0], p[2]]);
  const coverHash = new Hash(400);
  coverTris.forEach((t, k) => coverHash.add(k, ...boxOf(t.p)));
  const overBase = ps => {
    const A = plan(ps);
    for (const k of baseHash.near(...centre(ps), radius(ps))) if (overlap(A, plan(baseTris[k].p))) return true;
    for (const k of coverHash.near(...centre(ps), radius(ps))) if (overlap(A, plan(coverTris[k].p))) return true;   // over an underpass
    return false;
  };
  // the same test against the base before the change: a triangle that lay over the road already (in plan) was meant
  // so - the landscape between the two levels of a bridge, the cliff under a deck's end - and is no reason to re-make it
  const oldOut = baseOutline(old.base), oldHash = new Hash(400), oldCoverHash = new Hash(400);
  oldOut.baseTris.forEach((t, k) => oldHash.add(k, ...boxOf(t.p)));
  oldOut.coverTris.forEach((t, k) => oldCoverHash.add(k, ...boxOf(t.p)));
  const overOldBase = ps => {
    const A = plan(ps);
    for (const k of oldHash.near(...centre(ps), radius(ps))) if (overlap(A, plan(oldOut.baseTris[k].p))) return true;
    for (const k of oldCoverHash.near(...centre(ps), radius(ps))) if (overlap(A, plan(oldOut.coverTris[k].p))) return true;
    return false;
  };
  const insideBase = (x, z) => [...baseHash.near(x, z, 1)].some(k => inTri(x, z, ...baseTris[k].p));

  const removed = new Set(), stacked = new Set();
  T.tris.forEach((t, id) => {
    const ix = t.slice(0, 3);
    if (ix.some(i => bad.has(i))) { removed.add(id); return; }
    if (floating.has(id)) return;
    const P = ix.map(i => pos[i]), O = ix.map(i => old.pos[i]);
    const o1 = orient(...P), o0 = O.every(Boolean) ? orient(...O) : o1;
    if (Math.abs(o0) >= 1 && (Math.sign(o1) !== Math.sign(o0) || Math.abs(o1) < 1)) { removed.add(id); return; }   // turned over
    if (overBase(P)) { if (O.every(Boolean) && overOldBase(O)) stacked.add(id); else removed.add(id); }                                                         // the road is there now
  });
  // pushed triangles that now lie over each other (folded without turning over): both are made again
  {
    const h = new Hash(500), P = id => T.tris[id].slice(0, 3).map(i => pos[i]);
    const live = T.tris.map((t, id) => id).filter(id => !removed.has(id) && !floating.has(id));
    for (const id of live) h.add(id, ...boxOf(P(id)));
    for (const id of live) {
      const A = plan(P(id));
      for (const o of h.near(...centre(P(id)), radius(P(id)))) {
        if (o <= id || removed.has(o) && removed.has(id)) continue;
        if (T.tris[o].slice(0, 3).filter(i => T.tris[id].includes(i)).length >= 2) continue;   // neighbours
        if (overlap(A, plan(P(o)))) { removed.add(id); removed.add(o); }
      }
    }
  }
  if (!removed.size && !gap.size) return { removed: 0, added: 0 };

  let added = 0;
  for (let pass = 0; pass < 4; pass++) {
    const r = fill(T, pos, removed, bad, { base, ctx, frameDock, dockOf, baseTris, insideBase, underBridge, touchesBase, floating, holes, B, stacked });
    if (!r.failedTris.length) { added = r.added; break; }
    r.failedTris.forEach(id => removed.add(id));
    if (pass === 3) added = r.added;
  }
  return { removed: removed.size, added };
}
const boxOf = ps => { const xs = ps.map(p => p[0]), zs = ps.map(p => p[2]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
const centre = ps => [(ps[0][0] + ps[1][0] + ps[2][0]) / 3, (ps[0][2] + ps[1][2] + ps[2][2]) / 3];
const radius = ps => { const c = centre(ps); return Math.max(...ps.map(p => Math.hypot(p[0] - c[0], p[2] - c[1]))) + 1; };

// Fill the holes left by the removed triangles. Changes T only when no kept triangle is in the way (failedTris empty).
function fill(T, pos, removed, bad, S) {
  const { base, ctx, frameDock, dockOf, baseTris, insideBase, underBridge, touchesBase, floating, holes, B, stacked } = S;
  const kept = T.tris.map((t, id) => id).filter(id => !removed.has(id) && !floating.has(id));
  const Q = [], byXZ = new Map();                      // {pos, ti (terrain point), base (new base vertex), d (dock), pit}
  const addQ = (p, extra) => {
    const k = xzKey(p);
    if (byXZ.has(k)) return byXZ.get(k);
    Q.push({ pos: [pyRound(p[0]), pyRound(p[1]), pyRound(p[2])], ...extra });
    byXZ.set(k, Q.length - 1);
    return Q.length - 1;
  };
  // terrain points: of the kept triangles, and of the removed ones (they keep the shape of the hole) unless the road
  // covers them now
  const usedKept = new Set(kept.flatMap(id => T.tris[id].slice(0, 3)));
  const shape = new Set();
  for (const id of removed) for (const i of T.tris[id].slice(0, 3)) if (!bad.has(i)) shape.add(i);
  const qOf = new Map();
  const lockedOk = T.points.map((P, i) => i).filter(i => T.points[i].lock && !bad.has(i));
  for (const i of new Set([...usedKept, ...shape, ...lockedOk])) {
    if (!pos[i] || bad.has(i)) continue;
    if (!usedKept.has(i) && !T.points[i].lock && insideBase(pos[i][0], pos[i][2])) continue;
    qOf.set(i, addQ(pos[i], { ti: i }));
  }
  // the base: its vertices and edges (constraints, as in bake.js)
  const constraints = [], seenC = new Set();
  const addC = (a, b) => { if (a === b) return; const k = a < b ? a + ',' + b : b + ',' + a; if (!seenC.has(k)) { seenC.add(k); constraints.push([a, b]); } };
  const baseIdx = baseTris.map(t => t.p.map((p, k) => {
    const i = addQ(p, {});
    const q = Q[i];
    if (q.ti === undefined && !q.base) { q.base = true; q.d = dockOf(t, k); }
    else if (q.ti !== undefined && !q.d) q.d = dockOf(t, k);
    return i;
  }));
  const baseSet = new Set(baseIdx.map(ix => ix.slice().sort((a, b) => a - b).join(',')));
  const pointHash = new Hash(300);
  Q.forEach((q, i) => pointHash.add(i, q.pos[0], q.pos[2], q.pos[0], q.pos[2]));
  const chainEdge = (a, b) => {
    const A = Q[a].pos, Bp = Q[b].pos, dx = Bp[0] - A[0], dz = Bp[2] - A[2], L2 = dx * dx + dz * dz;
    const on = [];
    if (L2) {
      for (const c of pointHash.near((A[0] + Bp[0]) / 2, (A[2] + Bp[2]) / 2, Math.sqrt(L2) / 2 + 2)) {
        if (c === a || c === b) continue;
        const t = ((Q[c].pos[0] - A[0]) * dx + (Q[c].pos[2] - A[2]) * dz) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        if (Math.hypot(Q[c].pos[0] - A[0] - t * dx, Q[c].pos[2] - A[2] - t * dz) <= 1) on.push([t, c]);
      }
    }
    const chain = [a, ...on.sort((p, q) => p[0] - q[0]).map(x => x[1]), b];
    for (let j = 0; j + 1 < chain.length; j++) addC(chain[j], chain[j + 1]);
  };
  for (const ix of baseIdx) for (let j = 0; j < 3; j++) chainEdge(ix[j], ix[(j + 1) % 3]);
  // kept triangles: their edges are constraints (they come out as they are). Triangles stacked over the road in plan
  // (between the levels of a bridge) cannot be constraints of a plan triangulation - their edges cross the road's -
  // they stay as they are and only keep new faces off their place.
  const keptHash = new Hash(500);
  const keptQ = new Map();
  for (const id of kept) {
    const ix = T.tris[id].slice(0, 3).map(i => qOf.get(i));
    if (ix.some(x => x === undefined)) continue;
    keptQ.set(id, ix);
    if (!stacked.has(id)) for (let j = 0; j < 3; j++) addC(ix[j], ix[(j + 1) % 3]);
    keptHash.add(id, ...boxOf(ix.map(x => Q[x].pos)));
  }
  const inKept = (x, z) => [...keptHash.near(x, z, 1)].some(id => inTri(x, z, ...keptQ.get(id).map(q => Q[q].pos)));
  const freeSpot = (p, r) => !insideBase(p[0], p[2]) && !underBridge(p[0], p[2]) && !touchesBase(p) && !inKept(p[0], p[2]) &&
    ![...pointHash.near(p[0], p[2], r)].some(i => Math.hypot(Q[i].pos[0] - p[0], Q[i].pos[2] - p[2]) < r);
  const addFree = (p, extra) => { const i = addQ(p, extra); pointHash.add(i, p[0], p[2], p[0], p[2]); return i; };
  // a ring beside the new outer row; under a jump the road's edges at road height (the gap is filled flat, deadly)
  for (const q of Q) {
    if (!q.base || !q.d || q.d[2] === 'c') continue;
    const p = dockPos([...q.d.slice(0, 4), B.band, 0, 0], ctx);
    if (p && freeSpot(p, 150)) addFree(p, {});
  }
  for (const path of base.an ? [...new Set(base.an.secs.map(s => s.path))] : []) {
    path.frames.forEach((f, j) => {
      const s0 = base.an.byId.get(`${path.key}:${j}`), s1 = base.an.byId.get(`${path.key}:${path.closed ? (j - 1 + path.frames.length) % path.frames.length : j - 1}`);
      const onRoad = (s0 && !s0.jump && !s0.covered) || (s1 && !s1.jump && !s1.covered), onJump = (s0 && s0.jump) || (s1 && s1.jump);
      if (!onJump || onRoad) return;
      const fd = frameDock.get(path.key + ':' + j);
      if (!fd) return;
      for (const d of [1, -1]) {
        const sc = fd.canon ? d : -d;
        const pe = dockPos([fd.key, fd.i, 'e', sc, 0, 0, 0], ctx), pv = dockPos([fd.key, fd.i, 'v', sc, 0, 0, 0], ctx);
        if (pe && freeSpot(pe, 60)) addFree(pe, { pit: true });
        if (pv && freeSpot(pv, 60)) addFree(pv, {});
      }
    });
  }

  // triangulate everything; new faces fill what is neither base nor kept landscape, except the holes there were
  // before (all corners on such a hole) and beyond the outer wall (all corners on it)
  const wasHole = q => (q.ti !== undefined && (holes.pts.has(q.ti) || T.points[q.ti].rim)) || (q.d && holes.docks.has(q.d.slice(0, 4).join(',')));
  const res = triangulate(Q.map(q => [q.pos[0], q.pos[2]]), constraints);
  const failedTris = new Set();
  if (res.failed.length) {
    const fk = new Set(res.failed.map(([a, b]) => (a < b ? a + ',' + b : b + ',' + a)));
    for (const [id, ix] of keptQ) if (!stacked.has(id)) for (let j = 0; j < 3; j++) { const a = ix[j], b = ix[(j + 1) % 3]; if (fk.has(a < b ? a + ',' + b : b + ',' + a)) failedTris.add(id); }
    if (failedTris.size) return { failedTris: [...failedTris], added: 0 };
  }
  const keptSet = new Set([...keptQ.values()].map(ix => ix.slice().sort((a, b) => a - b).join(',')));
  const faces = res.tris.filter(t => {
    const k = t.slice().sort((a, b) => a - b).join(',');
    if (baseSet.has(k) || keptSet.has(k)) return false;
    if (t.every(i => wasHole(Q[i]))) return false;
    const c = [0, 2].map(a => (Q[t[0]].pos[a] + Q[t[1]].pos[a] + Q[t[2]].pos[a]) / 3);
    return !insideBase(c[0], c[1]) && !underBridge(c[0], c[1]) && !inKept(c[0], c[1]);
  });

  // material and colour: from the nearest removed triangle (not deadly away from jumps), deadly at pits
  const oldTris = [...removed].map(id => T.tris[id]).filter(t => t.slice(0, 3).every(i => pos[i]))
    .map(t => ({ t, c: centre(t.slice(0, 3).map(i => pos[i])) }));
  const jumpSecs = (base.an?.secs || []).filter(s => s.jump);
  const nearJump = (x, z) => jumpSecs.some(s => segDist([x, z], s.c0, s.c1)[0] - s.half < 260);
  const look = (x, z) => {
    let best = null, bd = Infinity;
    for (const o of oldTris) { const d = (o.c[0] - x) ** 2 + (o.c[1] - z) ** 2; if (d < bd) { bd = d; best = o.t; } }
    return best;
  };
  // stored points for the new faces
  const idOf = new Map();
  const use = i => {
    const q = Q[i];
    if (q.ti !== undefined) return q.ti;
    if (!idOf.has(i)) {
      T.points.push(q.base && q.d ? { d: q.d, lock: 1 } : { p: q.pos });
      idOf.set(i, T.points.length - 1);
    }
    return idOf.get(i);
  };
  const made = faces.map(t => {
    const c = [0, 2].map(a => (Q[t[0]].pos[a] + Q[t[1]].pos[a] + Q[t[2]].pos[a]) / 3);
    const src = look(c[0], c[1]);
    let mat = src ? src[3] : 'land', colour = src ? src[4] : undefined;
    const jump = t.some(i => Q[i].pit) || nearJump(c[0], c[1]);
    if (jump) { mat = 'dead'; colour = undefined; } else if (mat === 'dead') { mat = 'land'; colour = undefined; }
    const ix = t.map(use);
    return colour ? [ix[0], ix[1], ix[2], mat, colour] : [ix[0], ix[1], ix[2], mat];
  });
  T.tris = [...T.tris.filter((_, id) => !removed.has(id)), ...made];
  for (const i of bad) delete T.points[i].lock;
  compact(T, i => bad.has(i) || shape.has(i));         // points the user keeps without triangles stay
  return { failedTris: [], added: made.length };
}
