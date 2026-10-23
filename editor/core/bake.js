// Generate the landscape once (mode 2, "Generate terrain"): a constrained Delaunay triangulation of the
// base (base.js), rings beside it, a coarse grid further out and an outer wall. The result is stored
// as points and triangles (terrain.js) and edited from then on; it is never generated again.
//
// Points: every vertex of the base (they keep the base's triangles as constraints, so the base stays as
// it is), a ring of points at `band` beyond the base's outer row, under jumps the sunken pit edge, a grid
// of `cell` further out (up to ±24000) and a row of high points all around (the outer wall).
// All of them dock to the track (terrain.js); the base's outer row is locked.
import { pyRound } from './util.js';
import { triangulate } from './cdt.js';
import { Hash, quadBox, segDist, inQuad } from './sections.js';
import { dockContext, dockPos, nearestDock } from './terrain.js';

export const BAKE_DEFAULTS = { band: 300, cell: 1500, margin: 4000, pit: 600, maxEdge: 2500, rim: 1500 };
export const WORLD_LIMIT = 24000;            // vertices must stay inside ±25000 (validate.js)
const PIT_REACH = 260;                       // the valley under a jump reaches this far beside the gap
const RIM_OUT = 80;

// The base as the terrain sees it: its triangles (a road under a bridge stays out, it overlaps the deck in the plan),
// the dock of a path frame (segment, canonical index) and the dock of a corner of a base triangle (rows c, e, v and
// the kerb rows: the points where terrain meets the base; null for the others)
export function baseOutline(base) {
  const frameDock = new Map();
  for (const e of base.segs.values()) {
    for (let q = 0; q <= e.k; q++) {
      const key = e.path.key + ':' + e.drv[q];
      if (!frameDock.has(key)) frameDock.set(key, { key: e.key, i: e.canon ? q : e.k - q, canon: e.canon });
    }
  }
  // fractional frame index: a point between two frames on a row (cut at a bridge, bridges.js)
  const nFrames = new Map();
  for (const e of base.segs.values()) nFrames.set(e.path.key, e.path.frames.length);
  const dockOf = (t, k) => {
    const name = t.n?.[k], fr = t.fr?.[k];
    if (fr === null || fr === undefined || !['c', 'e', 'v', 'k1', 'k2', 'k3'].includes(name)) return null;
    const j0 = Math.floor(fr), u = fr - j0;
    const path = t.paths?.[k] ?? t.path, side = t.sides?.[k] ?? t.side;    // a junction zone: per corner (junctions.js)
    let fd = frameDock.get(path + ':' + j0), i = fd?.i;
    if (fd && u) {
      i = fd.i + (fd.canon ? u : -u);
      const e = base.segs.get(fd.key);
      if (i < 0 || i > e.k) {                         // the frame ends this segment: count from the next frame
        fd = frameDock.get(path + ':' + ((j0 + 1) % nFrames.get(path)));
        i = fd && fd.i + (fd.canon ? u - 1 : 1 - u);
      }
    }
    if (!fd) return null;
    const sc = fd.canon ? side : -side;
    return [fd.key, i, name, name === 'c' ? 1 : sc, 0, 0, 0];
  };
  // (marking quads float above the road; a free-standing bridge deck is not part of the landscape, bridges.js)
  const baseTris = base.tris.filter(t => !t.cap && !t.covered && !t.deck && !t.marking && !t.floating);
  // the floor of an underpass: no landscape over it (bridges.js)
  const coverTris = base.tris.filter(t => t.covered && !t.deck);
  const coverHash = new Hash(400);
  coverTris.forEach((t, k) => { const xs = t.p.map(p => p[0]), zs = t.p.map(p => p[2]); coverHash.add(k, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)); });
  const inTri = (x, z, a, b, c) => {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (!d) return false;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    return l1 > 1e-6 && l2 > 1e-6 && 1 - l1 - l2 > 1e-6;
  };
  const underBridge = (x, z) => [...coverHash.near(x, z, 1)].some(k => inTri(x, z, ...coverTris[k].p));
  return { frameDock, dockOf, baseTris, coverTris, underBridge };
}

export function bakeTerrain(level, paths, base, opts = {}) {
  const B = { ...BAKE_DEFAULTS, ...opts };
  const an = base.an, ctx = dockContext(base), warnings = [];
  const act = s => s && !s.jump && !s.covered && !s.noTerrain;     // sections without terrain: the landscape ignores them
  const active = an.secs.filter(act), jumps = an.secs.filter(s => s.jump);
  const activeHash = new Hash(1000), jumpHash = new Hash(1000);
  for (const s of active) activeHash.add(s, ...quadBox(s.quad));
  for (const s of jumps) jumpHash.add(s, ...quadBox(s.quad));
  // nearest section road edge: [section, distance from its edge]
  const nearest = (x, z, r, h = activeHash) => {
    let best = null, bd = Infinity;
    for (const s of h.near(x, z, r)) {
      const [d] = segDist([x, z], s.c0, s.c1);
      if (d - s.half < bd) { bd = d - s.half; best = s; }
    }
    return best && bd <= r ? [best, bd] : [null, Infinity];
  };

  const { frameDock, dockOf, baseTris, underBridge } = baseOutline(base);

  // ---------------------------------------------------------------- points
  const P = [], byXZ = new Map();                  // {pos, d, lock, rim, pit}
  const addP = (pos, d, extra = {}) => {
    const q = [pyRound(pos[0]), pyRound(pos[1]), pyRound(pos[2])], k = q[0] + ',' + q[2];
    if (byXZ.has(k)) return byXZ.get(k);
    P.push({ pos: q, d: d || nearestDock(q, ctx), ...extra });
    byXZ.set(k, P.length - 1);
    return P.length - 1;
  };
  const baseIdx = baseTris.map(t => t.p.map((p, k) => {
    const d = dockOf(t, k);
    return addP(p, d, d ? { lock: true } : {});
  }));
  const baseSet = new Set(baseIdx.map(ix => ix.slice().sort((a, b) => a - b).join(',')));
  const constraints = [], seenC = new Set();
  const addC = (a, b) => { if (a === b) return; const k = a < b ? a + ',' + b : b + ',' + a; if (!seenC.has(k)) { seenC.add(k); constraints.push([a, b]); } };
  // a base edge that passes through other base points (the cross edge of a strip next to the end of a
  // kerb, where the kerb rows lie on it) is a chain of constraints through them
  const pointHash = new Hash(300);
  P.forEach((q, i) => pointHash.add(i, q.pos[0], q.pos[2], q.pos[0], q.pos[2]));
  const chainEdge = (a, b) => {
    const A = P[a].pos, Bp = P[b].pos, dx = Bp[0] - A[0], dz = Bp[2] - A[2], L2 = dx * dx + dz * dz;
    const on = [];
    if (L2) {
      for (const c of pointHash.near((A[0] + Bp[0]) / 2, (A[2] + Bp[2]) / 2, Math.sqrt(L2) / 2 + 2)) {
        if (c === a || c === b) continue;
        const t = ((P[c].pos[0] - A[0]) * dx + (P[c].pos[2] - A[2]) * dz) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        if (Math.hypot(P[c].pos[0] - A[0] - t * dx, P[c].pos[2] - A[2] - t * dz) <= 1) on.push([t, c]);
      }
    }
    const chain = [a, ...on.sort((p, q) => p[0] - q[0]).map(x => x[1]), b];
    for (let j = 0; j + 1 < chain.length; j++) addC(chain[j], chain[j + 1]);
  };
  for (const ix of baseIdx) for (let j = 0; j < 3; j++) chainEdge(ix[j], ix[(j + 1) % 3]);
  const nBase = P.length;

  // rings beside the road, pit edges under jumps
  const ringHash = new Hash(500);
  const addRing = (f, j, path, d, ref, lat, dy, checkRoad, extra = {}) => {
    const fd = frameDock.get(path.key + ':' + j);
    if (!fd) return;
    const sc = fd.canon ? d : -d, dock = [fd.key, fd.i, ref, sc, lat, 0, dy];
    const pos = dockPos(dock, ctx);
    if (!pos || underBridge(pos[0], pos[2])) return;
    if (checkRoad) {
      const expect = (ref === 'v' ? base.vAt(fd.key, sc, fd.i) : 0) + lat;
      const [, dist] = nearest(pos[0], pos[2], expect + 600);
      if (dist < expect * 0.85) return;
    }
    if (lat > 0) {                                  // one ring point per 150
      for (const o of ringHash.near(pos[0], pos[2], 150)) if (Math.hypot(o[0] - pos[0], o[1] - pos[2]) < 150) return;
      ringHash.add([pos[0], pos[2]], pos[0], pos[2], pos[0], pos[2]);
    }
    addP(pos, dock, extra);
  };
  for (const path of paths.all) {
    const len = path.frames.length;
    path.frames.forEach((f, j) => {
      const s0 = an.byId.get(`${path.key}:${j}`), s1 = an.byId.get(`${path.key}:${path.closed ? (j - 1 + len) % len : j - 1}`);
      const onRoad = act(s0) || act(s1), onJump = !!(s0 && s0.jump) || !!(s1 && s1.jump);
      if (!onRoad && !onJump) return;
      for (const d of [1, -1]) {
        if (onJump && !onRoad) {
          addRing(f, j, path, d, 'v', 0, 0, true);                         // verge line along the gap
          addRing(f, j, path, d, 'e', 0, -B.pit, false, { pit: true });    // pit edge
        }
        addRing(f, j, path, d, 'v', B.band, 0, true);
      }
    });
  }

  // grid further out
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const s of an.secs) for (const q of s.quad) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
  const G = B.cell, lim = WORLD_LIMIT;
  const gx0 = Math.ceil(Math.max(-lim, x0 - B.margin) / G), gx1 = Math.floor(Math.min(lim, x1 + B.margin) / G);
  const gz0 = Math.ceil(Math.max(-lim, z0 - B.margin) / G), gz1 = Math.floor(Math.min(lim, z1 + B.margin) / G);
  // the track's frames as the landscape sees them: not the ones only sections without terrain touch (the landscape
  // runs on under those at the height of the land around)
  // (the paths' own frame objects: the segment table holds turned copies for non-canonical segments, which a set of
  // the sections' frames would not recognise - every frame of a no-terrain stretch counted then, 2026-10-09)
  const frameHash = new Hash(2000), withTerrain = new Set(), without = new Set();
  for (const s of an.secs) for (const f of [s.f0, s.f1]) (s.noTerrain ? without : withTerrain).add(f);
  for (const path of paths.all) for (const f of path.frames) if (!without.has(f) || withTerrain.has(f)) frameHash.add(f, f.c[0], f.c[2], f.c[0], f.c[2]);
  const heightAt = (x, z) => {                     // smooth blend of the nearby road heights
    let w = 0, s = 0;
    for (let r = 4000; r <= 64000 && !w; r *= 2) {
      for (const f of frameHash.near(x, z, r)) {
        const d2 = (f.c[0] - x) ** 2 + (f.c[2] - z) ** 2 + 1e5;
        w += 1 / d2; s += f.c[1] / d2;
      }
    }
    return w ? s / w : 0;
  };
  const keep = 620 + G * 0.5;
  for (let i = gx0; i <= gx1; i++) {
    for (let j = gz0; j <= gz1; j++) {
      const x = i * G, z = j * G;
      if (nearest(x, z, keep + 400)[1] < keep || nearest(x, z, keep + 400, jumpHash)[1] < keep || underBridge(x, z)) continue;
      addP([x, heightAt(x, z), z]);
    }
  }
  // outer wall: a row of high points just outside the grid, all around
  const rimAt = (x, z) => addP([x, heightAt(x, z) + B.rim, z], null, { rim: true });
  const rx0 = gx0 * G - RIM_OUT, rx1 = gx1 * G + RIM_OUT, rz0 = gz0 * G - RIM_OUT, rz1 = gz1 * G + RIM_OUT;
  const rim = [];
  for (let i = gx0; i <= gx1; i++) rim.push(rimAt(i * G, rz0));
  rim.push(rimAt(rx1, rz0));
  for (let j = gz0; j <= gz1; j++) rim.push(rimAt(rx1, j * G));
  rim.push(rimAt(rx1, rz1));
  for (let i = gx1; i >= gx0; i--) rim.push(rimAt(i * G, rz1));
  rim.push(rimAt(rx0, rz1));
  for (let j = gz1; j >= gz0; j--) rim.push(rimAt(rx0, j * G));
  rim.push(rimAt(rx0, rz0));
  for (let k = 0; k < rim.length; k++) addC(rim[k], rim[(k + 1) % rim.length]);

  // ---------------------------------------------------------------- triangulate; long edges are split
  const baseBoxHash = new Hash(400);
  baseTris.forEach((t, k) => {
    const xs = t.p.map(p => p[0]), zs = t.p.map(p => p[2]);
    baseBoxHash.add(k, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
  });
  const insideBase = (x, z) => {
    for (const k of baseBoxHash.near(x, z, 1)) {
      const t = baseTris[k], a = t.p[0], b = t.p[1], c = t.p[2];
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (!d) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      if (l1 > 1e-6 && l2 > 1e-6 && 1 - l1 - l2 > 1e-6) return true;
    }
    return false;
  };
  const edgeKey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  let faces, failed;
  for (let pass = 0; ; pass++) {
    const res = triangulate(P.map(q => [q.pos[0], q.pos[2]]), constraints);
    failed = res.failed;
    faces = res.tris.filter(t => {
      if (baseSet.has(t.slice().sort((a, b) => a - b).join(','))) return false;
      const cx = (P[t[0]].pos[0] + P[t[1]].pos[0] + P[t[2]].pos[0]) / 3, cz = (P[t[0]].pos[2] + P[t[1]].pos[2] + P[t[2]].pos[2]) / 3;
      return !insideBase(cx, cz) && !underBridge(cx, cz);
    });
    if (pass === 4) break;
    const long = new Map();
    for (const t of faces) {
      for (let j = 0; j < 3; j++) {
        const a = t[j], b = t[(j + 1) % 3], p = P[a].pos, q = P[b].pos;
        if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > B.maxEdge) long.set(edgeKey(a, b), [a, b]);
      }
    }
    if (!long.size) break;
    const mid = new Map();
    for (const [key, [a, b]] of long) {
      const p = P[a].pos, q = P[b].pos;
      mid.set(key, addP([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]));
    }
    for (let k = constraints.length - 1; k >= 0; k--) {                  // split constrained edges as well
      const [a, b] = constraints[k], m = mid.get(edgeKey(a, b));
      if (m !== undefined && m !== a && m !== b) constraints.splice(k, 1, [a, m], [m, b]);
    }
  }
  if (failed.length) warnings.push(`Terrain: ${failed.length} edge(s) of the base could not be kept (overlapping track?)`);

  // ---------------------------------------------------------------- material and stored form
  const matOf = t => {
    if (t.some(i => P[i].pit)) return 'dead';
    const cx = (P[t[0]].pos[0] + P[t[1]].pos[0] + P[t[2]].pos[0]) / 3, cz = (P[t[0]].pos[2] + P[t[1]].pos[2] + P[t[2]].pos[2]) / 3;
    const [, jd] = nearest(cx, cz, PIT_REACH + 100, jumpHash), [, d] = nearest(cx, cz, PIT_REACH + 400);
    return jd <= PIT_REACH && jd < d ? 'dead' : 'land';
  };
  const stored = [], map = new Map();
  const use = i => {
    if (!map.has(i)) {
      const q = P[i], pt = q.d ? { d: q.d } : { p: q.pos };
      if (q.lock) pt.lock = 1;
      if (q.rim) pt.rim = 1;
      stored.push(pt); map.set(i, stored.length - 1);
    }
    return map.get(i);
  };
  const tris = faces.map(t => {
    const a = t.map(use);
    return [a[0], a[1], a[2], matOf(t)];
  });
  const cuts = {};
  for (const e of base.segs.values()) cuts[e.key] = e.k;
  return { terrain: { points: stored, tris }, cuts, warnings, failed: failed.map(([a, b]) => [P[a].pos, P[b].pos]) };
}
