// Bridges and underpasses: where a road crosses over another one (base.js finds the pairs).
//
// The landscape is a height field (one surface over every point of the plan), so it cannot go under the upper road
// and over the lower one at once. The upper road keeps its full base (road, kerbs, verge) and lies in the landscape
// like everywhere else; the lower road is cut where it passes under it:
//   - a slab across the lower road, between two lines along both sides of the upper road (EPS beyond its outer row):
//     the lower road in it is "covered" - drawn, driven on, but not part of the landscape (the tunnel floor);
//   - a strip PORTAL wide beyond each line: the lower road there belongs to the landscape again but no terrain may
//     cover it (the mouth of the underpass); beside it the landscape climbs from the lower road to the upper one;
//   - tunnel walls on the outer rows of the lower road from its ground up to the ceiling, the ceiling (the deck's
//     underside, DECK below the upper road) over the covered floor, and a fascia from the ceiling's edge up to the
//     upper road at both mouths.
// Covered pieces, walls, ceiling and fascia are double-sided (zone 'deck'), and are not part of the landscape.
import { segDist, sectionRange } from './sections.js';

const EPS = 4;            // the slab reaches this far beyond the upper road's outer row
const PORTAL = 40;        // width of the mouth strip

// half-plane split of a polygon of vertices {p, n, fr} by x·nx + z·nz <= c; vertices on an edge between two of the
// same row get that row and a fractional frame index (the terrain can dock there)
export function split(poly, nx, nz, c) {
  const val = v => v.p[0] * nx + v.p[2] * nz - c;
  const inside = [], outside = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], va = val(a), vb = val(b);
    (va <= 0 ? inside : outside).push(a);
    if ((va < 0 && vb > 0) || (va > 0 && vb < 0)) {
      // the same point from both sides of the edge: interpolate from the lexically smaller end
      const [s, e, vs, ve] = (a.p[0] < b.p[0] || (a.p[0] === b.p[0] && a.p[2] <= b.p[2])) ? [a, b, va, vb] : [b, a, vb, va];
      const u = vs / (vs - ve);
      const x = { p: [0, 1, 2].map(k => s.p[k] + (e.p[k] - s.p[k]) * u), n: null, fr: null };
      if (s.n && s.n === e.n && s.fr !== null && e.fr !== null && s.fr !== e.fr) { x.n = s.n; x.fr = s.fr + (e.fr - s.fr) * u; }
      inside.push(x); outside.push(x);
    }
  }
  return [inside.length >= 3 ? inside : null, outside.length >= 3 ? outside : null];
}
export const fan = poly => poly.slice(1, -1).map((_, i) => [poly[0], poly[i + 1], poly[i + 2]]);
const area2 = t => (t[1].p[0] - t[0].p[0]) * (t[2].p[2] - t[0].p[2]) - (t[1].p[2] - t[0].p[2]) * (t[2].p[0] - t[0].p[0]);

// pairs: [[lower section, upper section]]; tris: the base triangles (changed in place); rows(path, frame, side) the
// row points; deck: thickness; deckEnds: filled with the road's cross lines {a, b} where a free-standing deck ends
// (compile.js makes the landscape hanging from them drivable); modes: the user's choice per crossing
// (track.crossings, by key). Returns {built, crossings: [{key, at, mode, auto, upper, lower}]}.
export function buildBridges({ pairs, tris, rows, secOf, deck = 60, deckEnds = [], modes = {}, terrain = true }) {
  const crossings = [];
  if (!pairs.length) return { built: 0, crossings };
  // crossings: connected groups of pairs (sections next to each other on their path belong together)
  const parent = new Map(), find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const unite = (a, b) => { for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x); parent.set(find(a), find(b)); };
  for (const [lo, hi] of pairs) unite('L' + lo.id, 'H' + hi.id);
  const ids = [...parent.keys()];
  for (const a of ids) for (const b of ids) {
    if (a >= b || a[0] !== b[0]) continue;
    const sa = secOf.get(a.slice(1)), sb = secOf.get(b.slice(1));
    if (sa.path === sb.path && Math.abs(sa.j - sb.j) <= 1) unite(a, b);
  }
  const groups = new Map();
  for (const x of ids) { const r = find(x); if (!groups.has(r)) groups.set(r, { lo: new Set(), hi: new Set() }); groups.get(r)[x[0] === 'L' ? 'lo' : 'hi'].add(secOf.get(x.slice(1))); }

  let built = 0;
  for (const { lo, hi } of groups.values()) {
    const uppers = [...hi], lowers = [...lo];
    // across the upper road: its mean left direction
    let lx = 0, lz = 0;
    for (const s of uppers) { lx += s.f0.left[0] + s.f1.left[0]; lz += s.f0.left[1] + s.f1.left[1]; }
    const ll = Math.hypot(lx, lz) || 1;
    lx /= ll; lz /= ll;
    // the two lines: beyond the outer row of the upper road on each side (its farthest point over the crossing; the
    // upper sections are those whose road or verge lies over the lower road)
    const off = { 1: -Infinity, '-1': -Infinity };
    let floating = true;                             // no verge on the upper road over the crossing: a free-standing deck
    for (const s of uppers) for (const f of [s.f0, s.f1]) for (const d of [1, -1]) {
      const r = rows(s.path, f, d), v = r.v;
      off[d] = Math.max(off[d], (v[0] * lx + v[2] * lz) * d);
      if (Math.hypot(v[0] - r.e[0], v[2] - r.e[2]) > 1) floating = false;
    }
    // The crossing: its key (the upper and the lower segment nearest its centre; track.crossings holds the user's
    // choice per key), its centre and its mode - 'tunnel' (the underpass below), 'bridge' (a free-standing deck),
    // 'none' (nothing is built: the upper road floats over the crossing, the lower road stays whole). Without a
    // choice: none where either road has no terrain or the level has no terrain at all (nothing to tunnel through,
    // nothing to bridge; the roads simply pass), bridge where the upper road has no verge there, else tunnel.
    const mid = s => [(s.c0[0] + s.c1[0]) / 2, (s.c0[1] + s.c1[1]) / 2];
    const cx = uppers.reduce((a, s) => a + mid(s)[0], 0) / uppers.length, cz = uppers.reduce((a, s) => a + mid(s)[1], 0) / uppers.length;
    const nearest = list => list.reduce((b, s) => (!b || Math.hypot(mid(s)[0] - cx, mid(s)[1] - cz) < Math.hypot(mid(b)[0] - cx, mid(b)[1] - cz) ? s : b), null);
    const up = nearest(uppers), lo2 = nearest(lowers), ckey = sectionRange(up).key + '^' + sectionRange(lo2).key;
    const noTerrain = uppers.some(s => s.noTerrain) || lowers.some(s => s.noTerrain);
    const mode = modes[ckey] || (noTerrain || !terrain ? 'none' : floating ? 'bridge' : 'tunnel');
    crossings.push({ key: ckey, at: [cx, up.y, cz], mode, auto: !modes[ckey], upper: up.path.key, lower: lo2.path.key });
    const upperIds = new Set(uppers.map(s => s.id));
    if (mode === 'none') {
      for (const t of tris) if (upperIds.has(t.sec) && !t.deck && !t.covered) t.floating = true;
      for (const s of uppers) s.noTerrain = true;      // the landscape (bake.js) leaves the upper road alone there
      built++;
      continue;
    }
    // A free-standing deck (the upper road without verge there, the user's "no verge", or the chosen 'bridge'): the
    // landscape does not climb to the road's edge but stays down and runs on under the deck - the upper road's
    // triangles are not part of the landscape's outline (`floating`), the lower road is not cut at all. The deck is a
    // box: the road on top, its underside DECK below (the ceiling), a fascia along both edges. A car can leave the
    // road at its edge (with the ramp behaviour). With a verge the road lies in the landscape like everywhere: a hill
    // with a tunnel (below). The whole box is drivable with the ramp behaviour (surface code 10, compile.js): a
    // landscape-coded (80) face whose edge lies on the road acts as a wall in the game, whatever its slope.
    if (mode === 'bridge') {
      // the deck's ends: the frames of the upper sections that only one of them has (the road's cross line there)
      const seen = new Map();
      for (const s of uppers) for (const f of [s.f0, s.f1]) seen.set(f, { f, s, n: (seen.get(f)?.n || 0) + 1 });
      for (const { f, s, n } of seen.values()) if (n === 1) deckEnds.push({ a: rows(s.path, f, 1).e, b: rows(s.path, f, -1).e, sec: s.id, path: s.path.key });
      const qn = new Map(), q = (sec, strip) => { const k = sec + strip; qn.set(k, (qn.get(k) || 0) + 1); return qn.get(k) - 1; };
      const top = tris.filter(t => upperIds.has(t.sec) && !t.deck && !t.covered && !t.cap);
      for (const t of top) t.floating = true;
      for (const t of top) {
        if (t.marking) continue;
        tris.push({ ...t, p: t.p.map(p => [p[0], p[1] - deck, p[2]]), mat: 'deck', zone: 'deck', deck: true, covered: true, floating: true, marking: false,
                    facing: [0, -1, 0], strip: 'ceiling', q: q(t.sec, 'ceiling'), n: null, fr: null });
      }
      for (const s of uppers) for (const d of [1, -1]) {
        const a = rows(s.path, s.f0, d).e, b = rows(s.path, s.f1, d).e, facing = [s.f0.left[0] * d, 0, s.f0.left[1] * d];
        const al = [a[0], a[1] - deck, a[2]], bl = [b[0], b[1] - deck, b[2]];
        const base = { mat: 'deck', zone: 'deck', deck: true, covered: true, floating: true, facing, sec: s.id, side: d, path: s.path.key, strip: 'fascia', n: null, fr: null };
        tris.push({ ...base, p: [a, b, bl], q: q(s.id, 'fascia') });
        tris.push({ ...base, p: [a, bl, al], q: q(s.id, 'fascia') });
      }
      built++;
      continue;
    }
    // the lower road near the crossing: the sections under it and four on each side
    const near = new Set();
    for (const s of lowers) {
      const n = s.path.closed ? s.path.frames.length : s.path.frames.length - 1;
      for (let k = -4; k <= 4; k++) {
        const j = s.path.closed ? (s.j + k + n) % n : s.j + k;
        if (j >= 0 && j < n) near.add(`${s.path.key}:${j}`);
      }
    }
    // ceiling height at a point: the upper road there, less the deck
    const ceiling = (x, z) => {
      let best = null, bd = Infinity;
      for (const s of uppers) {
        const [dd, t] = segDist([x, z], s.c0, s.c1);
        if (dd < bd) { bd = dd; best = s.f0.c[1] + (s.f1.c[1] - s.f0.c[1]) * t; }
      }
      return best - deck;
    };
    const roadY = (x, z) => ceiling(x, z) + deck;
    // cut the lower road's triangles
    const covered = [], out = [];
    for (let k = tris.length - 1; k >= 0; k--) {
      const t = tris[k];
      if (!near.has(t.sec) || t.covered || t.deck) continue;
      let pieces = [{ poly: t.p.map((p, i) => ({ p, n: t.n ? t.n[i] : null, fr: t.fr ? t.fr[i] : null })), kind: 'in' }];
      for (const d of [1, -1]) {
        const next = [];
        for (const pc of pieces) {
          if (pc.kind !== 'in') { next.push(pc); continue; }
          const [a, b] = split(pc.poly, lx * d, lz * d, off[d] + EPS + PORTAL);
          if (b) next.push({ poly: b, kind: 'out' });
          if (!a) continue;
          const [c, e] = split(a, lx * d, lz * d, off[d] + EPS);
          if (e) next.push({ poly: e, kind: 'portal', d });
          if (c) next.push({ poly: c, kind: 'in' });
        }
        pieces = next;
      }
      if (pieces.length === 1 && pieces[0].kind === 'out') continue;
      tris.splice(k, 1);
      for (const pc of pieces) {
        for (const tri of fan(pc.poly)) {
          if (Math.abs(area2(tri)) < 0.5) continue;
          const nt = { ...t, p: tri.map(v => v.p), n: tri.map(v => v.n), fr: tri.map(v => v.fr) };
          if (pc.kind === 'in') { nt.covered = true; covered.push(nt); }
          if (pc.kind === 'portal') nt.portal = true;
          if (pc.kind === 'out') out.push(nt);
          tris.push(nt);
        }
      }
    }
    if (!covered.length) continue;
    built++;
    // ceiling over the covered floor, walls on its outer rows, fascia at both mouths
    const qn = new Map(), q = (sec, strip) => { const k = sec + strip; qn.set(k, (qn.get(k) || 0) + 1); return qn.get(k) - 1; };
    const lift = p => [p[0], ceiling(p[0], p[2]), p[2]];
    // the floor's outer edges along the road (the outermost row there: verge, kerb foot or road edge) carry the walls
    const key = p => Math.round(p[0] * 10) + ',' + Math.round(p[2] * 10), ek = (a, b) => { const x = key(a), y = key(b); return x < y ? x + ' ' + y : y + ' ' + x; };
    const count = new Map();
    for (const t of covered) for (let i = 0; i < 3; i++) { const k = ek(t.p[i], t.p[(i + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
    const edges = [];
    for (const t of covered) {
      tris.push({ ...t, p: t.p.map(lift), mat: 'deck', zone: 'deck', deck: true, covered: true, facing: [0, -1, 0], strip: 'ceiling', q: q(t.sec, 'ceiling'), n: null, fr: null });
      for (let i = 0; i < 3; i++) {
        const a = i, b = (i + 1) % 3;
        if (count.get(ek(t.p[a], t.p[b])) === 1 && t.n[a] && t.n[a] === t.n[b] && t.n[a] !== 'c' && t.fr[a] !== t.fr[b]) edges.push({ t, a: t.p[a], b: t.p[b] });
      }
    }
    for (const { t, a, b } of edges) {
      // facing: towards the lower road's centre line
      const s = secOf.get(t.sec), cx = (s.c0[0] + s.c1[0]) / 2, cz = (s.c0[1] + s.c1[1]) / 2;
      const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2, fl = Math.hypot(cx - mx, cz - mz) || 1;
      const facing = [(cx - mx) / fl, 0, (cz - mz) / fl];
      const A = lift(a), Bt = lift(b), wall = (p3) => tris.push({ ...t, p: p3, mat: 'deck', zone: 'deck', deck: true, covered: true, facing, strip: 'wall', q: q(t.sec, 'wall'), n: null, fr: null });
      wall([a, b, Bt]); wall([a, Bt, A]);
    }
    // fascia: the ceiling's edge on each line up to the upper road
    for (const d of [1, -1]) {
      const c = off[d] + EPS, pts = [];
      for (const t of covered) for (const p of t.p) if (Math.abs((p[0] * lx + p[2] * lz) * d - c) < 0.01) pts.push(p);
      const tx = -lz, tz = lx;                                     // along the line
      const uniq = [...new Map(pts.map(p => [Math.round(p[0] * 100) + ',' + Math.round(p[2] * 100), p])).values()]
        .sort((a, b) => (a[0] * tx + a[2] * tz) - (b[0] * tx + b[2] * tz));
      const sec = uppers.reduce((best, s) => best || s, null);
      for (let i = 0; i + 1 < uniq.length; i++) {
        const a = uniq[i], b = uniq[i + 1], A = lift(a), Bc = lift(b), Au = [a[0], roadY(a[0], a[2]), a[2]], Bu = [b[0], roadY(b[0], b[2]), b[2]];
        const base = { mat: 'deck', zone: 'deck', deck: true, covered: true, facing: [lx * d, 0, lz * d], sec: sec.id, side: d, path: sec.path.key, strip: 'fascia', n: null, fr: null };
        tris.push({ ...base, p: [A, Bc, Bu], q: q(sec.id, 'fascia') });
        tris.push({ ...base, p: [A, Bu, Au], q: q(sec.id, 'fascia') });
      }
    }
  }
  return { built, crossings };
}

// The corners of an underpass's mouths: the landscape runs from the foot of a tunnel wall (on the lower road) up to the
// upper road, beside the wall's end and the fascia, which leaves a narrow upright gap. Each such gap is closed by two
// faces from the wall's foot over its top and the fascia's top to the landscape's point on the upper road (double-sided,
// zone 'deck'). baseTris: the base with the deck faces; terrain, pos: the stored landscape and its point positions.
// Returns the new faces (not covered: the hole check counts them).
export function closeMouths(baseTris, terrain, pos) {
  const deck = baseTris.filter(t => t.deck && (t.strip === 'wall' || t.strip === 'fascia'));
  if (!deck.length) return [];
  const xz = p => Math.round(p[0] * 10) + ',' + Math.round(p[2] * 10);
  // per plan position: the wall's foot and top, the fascia's top
  const at = new Map();
  for (const t of deck) for (const p of t.p) {
    const k = xz(p);
    if (!at.has(k)) at.set(k, { wall: [], fascia: [] });
    at.get(k)[t.strip].push(p);
  }
  const corners = new Map();                            // key of the wall's foot (3D) -> {foot, top, fasciaTop, sec}
  const key = p => Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]);
  for (const t of deck) if (t.strip === 'wall') for (const p of t.p) {
    const g = at.get(xz(p));
    if (!g.fascia.length) continue;                     // not at a mouth
    const foot = g.wall.reduce((a, b) => (b[1] < a[1] ? b : a)), top = g.wall.reduce((a, b) => (b[1] > a[1] ? b : a));
    const fasciaTop = g.fascia.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (p === foot) corners.set(key(foot), { foot, top, fasciaTop, t });
  }
  if (!corners.size) return [];
  // edges of the landscape and the base (without the underpass) that only one face has, at a wall's foot
  const count = new Map(), ends = new Map();
  const bump = (a, b) => { const ka = key(a), kb = key(b), k = ka < kb ? ka + ' ' + kb : kb + ' ' + ka; count.set(k, (count.get(k) || 0) + 1); ends.set(k, [a, b]); };
  for (const t of baseTris) if (!t.covered && !t.deck && !t.cap) for (let j = 0; j < 3; j++) bump(t.p[j], t.p[(j + 1) % 3]);
  const land = [];
  for (const t of terrain.tris) { const P = t.slice(0, 3).map(i => pos[i]); if (P.every(Boolean)) { land.push(P); for (let j = 0; j < 3; j++) bump(P[j], P[(j + 1) % 3]); } }
  const out = [];
  for (const [k, n] of count) {
    if (n !== 1) continue;
    const [a, b] = ends.get(k), c = corners.get(key(a)) ? [a, b] : corners.get(key(b)) ? [b, a] : null;
    if (!c) continue;
    const [W, U] = c, { top, fasciaTop, t } = corners.get(key(W));
    if (U[1] < top[1]) continue;                        // reaches no higher than the wall: not the gap
    const base = { mat: 'deck', zone: 'deck', deck: false, covered: false, closure: true, sec: t.sec, side: t.side, path: t.path, strip: 'mouth', n: null, fr: null };
    const facing = (P) => { const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], v = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const nx = u[1] * v[2] - u[2] * v[1], nz = u[0] * v[1] - u[1] * v[0], l = Math.hypot(nx, nz) || 1; return [nx / l, 0, nz / l]; };
    for (const P of [[W, top, U], [top, fasciaTop, U]]) {
      const ar = Math.hypot(...[0, 1, 2].map(i => { const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], v = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
        return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]][i]; }));
      if (ar > 1) out.push({ ...base, p: P, facing: facing(P), q: out.length });
    }
  }
  return out;
}

// The ends of a free-standing deck: where the lower road passes right under a deck's end, the face from the end's
// cross line down to the ground stands upright or even overhangs in plan. The landscape is triangulated in plan and
// cannot build it, so a hole stays there (MyThird, 2026-10-11). Every loop of open edges that runs along a deck's end
// line is closed here, triangulated in its own plane: the abutment under the deck's end (zone 'deck', drawn dark
// grey, double-sided as steep faces are; ramp code 10 like everything hanging from a deck's end, compile.js).
// A chain of open edges instead of a loop (the landscape hangs from the road elsewhere) is closed through the lowest
// point of the mesh next to both of its ends.
// open: the open edges [[a, b]] (terrain.js openEdges); deckEnds: base.js; tris: base and landscape faces as point
// triples, for the edges of the mesh. Returns the new faces (not covered: the hole check counts them).
const ABUT_REACH = 1500;     // a loop is closed only within this distance (plan) of the deck's end
export function closeDeckEnds(open, deckEnds, tris) {
  if (!open.length || !deckEnds.length) return [];
  const key = p => Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]);
  const at = new Map(), adj = new Map();
  const link = (m, a, b) => { for (const [x, y] of [[a, b], [b, a]]) { if (!m.has(x)) m.set(x, new Set()); m.get(x).add(y); } };
  for (const [a, b] of open) { at.set(key(a), a); at.set(key(b), b); link(adj, key(a), key(b)); }
  const onLine = (p, { a, b }) => {
    const ab = [0, 1, 2].map(k => b[k] - a[k]), ap = [0, 1, 2].map(k => p[k] - a[k]), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const u = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (l2 || 1)));
    return Math.hypot(ap[0] - ab[0] * u, ap[1] - ab[1] * u, ap[2] - ab[2] * u) < 2;
  };
  let mesh = null;                                     // edges of all faces, only built when a chain needs closing
  const meshAdj = () => {
    if (mesh) return mesh;
    mesh = new Map();
    for (const P of tris) for (let j = 0; j < 3; j++) {
      const a = key(P[j]), b = key(P[(j + 1) % 3]);
      if (!at.has(a)) at.set(a, P[j]);
      if (!at.has(b)) at.set(b, P[(j + 1) % 3]);
      link(mesh, a, b);
    }
    return mesh;
  };
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const out = [], done = new Set();
  for (const end of deckEnds) {
    const mid = [(end.a[0] + end.b[0]) / 2, (end.a[2] + end.b[2]) / 2];
    const near = k => { const p = at.get(k); return Math.hypot(p[0] - mid[0], p[2] - mid[1]) <= ABUT_REACH; };
    // the open edges along the end line, and everything connected to them by open edges nearby
    const seeds = [...adj.keys()].filter(k => onLine(at.get(k), end) && [...adj.get(k)].some(n => onLine(at.get(n), end)));
    if (!seeds.length || seeds.some(k => done.has(k))) continue;
    const comp = new Set(seeds), stack = [...seeds];
    while (stack.length) for (const n of adj.get(stack.pop())) if (!comp.has(n) && near(n)) { comp.add(n); stack.push(n); }
    const deg = k => [...adj.get(k)].filter(n => comp.has(n)).length;
    const ends = [...comp].filter(k => deg(k) === 1);
    if ([...comp].some(k => deg(k) > 2) || (ends.length !== 0 && ends.length !== 2)) continue;   // not one simple loop
    // walk the loop (or the chain from one end to the other)
    const order = [ends[0] || [...comp][0]];
    for (let prev = null, cur = order[0]; ;) {
      const next = [...adj.get(cur)].find(n => comp.has(n) && n !== prev && !order.includes(n));
      if (!next) break;
      order.push(next); prev = cur; cur = next;
    }
    if (order.length !== comp.size) continue;
    if (ends.length) {
      const m = meshAdj(), first = order[0], last = order[order.length - 1];
      const common = [...(m.get(first) || [])].filter(k => (m.get(last) || new Set()).has(k) && !comp.has(k));
      if (!common.length) continue;
      order.push(common.reduce((b, k) => (at.get(k)[1] < at.get(b)[1] ? k : b)));
    }
    order.forEach(k => done.add(k));
    const P = order.map(k => at.get(k));
    // the loop's plane (Newell) and the loop in it
    const nrm = [0, 0, 0];
    P.forEach((p, i) => { const q = P[(i + 1) % P.length]; nrm[0] += (p[1] - q[1]) * (p[2] + q[2]); nrm[1] += (p[2] - q[2]) * (p[0] + q[0]); nrm[2] += (p[0] - q[0]) * (p[1] + q[1]); });
    const nl = Math.hypot(...nrm);
    if (nl < 1) continue;
    const n = nrm.map(v => v / nl), ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ex = cross(ref, n), exl = Math.hypot(...ex), ux = ex.map(v => v / exl), uy = cross(n, ux);
    const Q = P.map(p => [p[0] * ux[0] + p[1] * ux[1] + p[2] * ux[2], p[0] * uy[0] + p[1] * uy[1] + p[2] * uy[2]]);
    // a chain hangs from the road down to its ground point: a fan from there (the loop is not flat - the road's edge
    // runs along it - and an ear could lie on the road); a loop: ear clipping in its plane
    const pieces = ends.length ? P.slice(0, -1).slice(0, -1).map((_, i) => [P.length - 1, i, i + 1]) : earClip(Q);
    for (const [i, j, k] of pieces) {
      const t = [P[i], P[j], P[k]];
      const u = [0, 1, 2].map(c => t[1][c] - t[0][c]), v = [0, 1, 2].map(c => t[2][c] - t[0][c]), cr = cross(u, v);
      if (Math.hypot(...cr) < 2) continue;
      const fl = Math.hypot(cr[0], cr[2]) || 1;
      out.push({ p: t, mat: 'deck', zone: 'deck', deck: false, covered: false, closure: true, abutment: true, sec: end.sec, path: end.path, side: 1,
                 strip: 'abutment', n: null, fr: null, facing: [cr[0] / fl, 0, cr[2] / fl], q: out.length });
    }
  }
  return out;
}
// triangles of a simple polygon in 2D (ear clipping), as index triples into it
function earClip(Q) {
  const n = Q.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = Q[i], b = Q[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = [...Array(n).keys()];
  if (area < 0) idx.reverse();
  const cr = (a, b, c) => (Q[b][0] - Q[a][0]) * (Q[c][1] - Q[a][1]) - (Q[b][1] - Q[a][1]) * (Q[c][0] - Q[a][0]);
  const inside = (p, a, b, c) => cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0;
  const out = [];
  for (let guard = 0; idx.length > 3 && guard < n * n; guard++) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cr(a, b, c) <= 0) continue;
      if (idx.some(p => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;                                    // degenerate: the rest as a fan
  }
  for (let i = 1; i + 1 < idx.length; i++) out.push([idx[0], idx[i], idx[i + 1]]);
  return out;
}
