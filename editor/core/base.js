// The base of the landscape, built from the track (mode 1): road, kerbs and the drivable verge beside
// the road. It is not stored: it follows the track and its settings (width, verge left/right, kerbs,
// flags). The stored terrain (terrain.js) docks to its outer row ("v").
//
// Rows across the road at every frame, from the centre line outwards on each side:
//   c  centre line          e  road edge          k1 k2 k3  kerb: inner top, outer top, foot
//   v  outer edge of the drivable verge (brown); without verge it lies on the road edge (or the kerb foot), so
//      the row is always there and the terrain that docks to it keeps its shape
// Between two frames every pair of neighbouring rows is a strip of two triangles. Their diagonal is
// the same on every strip (from the row nearer the road at the near frame to the row farther out at
// the far frame; inside the road from the edge to the centre line): the game sorts triangles by the
// sum of their vertex depths, and regular strips keep neighbouring triangles in a fixed order.
import { KERB_DEFAULT } from './model.js';
import { Hash, quadBox, inQuad, segDist, segCross, edgePoint, analyseSections, inRange } from './sections.js';
import { segmentTable } from './paths.js';
import { buildBridges } from './bridges.js';
import { buildJunctions } from './junctions.js';

const KERB_CLEAR = 20;                // the verge row lies at least this far beyond the kerb foot

// opts.quick: only the ground (no kerb bodies, no markings) - the preview while dragging; the rows stay, so the
// terrain docks as always. opts.markingObjects: the road has no marking rows (a tile stays 4 triangles); the markings
// are separate quads MARK_LIFT above the road (`marking: true`, not part of the surface), objects in the compiler
const APART_MAX = 400;            // verges overlapping at a height difference up to this (not the roads) still make a junction
export function buildBase(level, paths, an = analyseSections(paths), opts = {}) {
  const T = level.track, quick = !!opts.quick, markObj = !!opts.markingObjects && !quick;
  // crossings are tunnelled or bridged only with a landscape (opts.terrain: the terrain is being generated from this base)
  const terrain = opts.terrain ?? !!(level.terrain && level.terrain.tris && level.terrain.tris.length);
  const kerb = { ...KERB_DEFAULT, ...(T.kerb || {}) };
  const inset = Math.max(0, (kerb.foot - kerb.lid) / 2);
  const secOf = new Map(an.secs.map(s => [s.id, s]));
  const hash = new Hash(1000);
  for (const s of an.secs) if (!s.jump) hash.add(s, ...quadBox(s.quad));
  // Junctions: where sections of different paths come near each other (their verges would overlap) the base has
  // only the road; the landscape generated later then reaches the road edge there.
  // the section with its verge on both sides, as a convex quad (x, z)
  const expanded = s => s.ex || (s.ex = [edgePoint(s.f0, -1, s.f0.vr + 10), edgePoint(s.f0, 1, s.f0.vl + 10), edgePoint(s.f1, 1, s.f1.vl + 10), edgePoint(s.f1, -1, s.f1.vr + 10)].map(q => [q[0], q[2]]));
  const overlap = (A, B) => {                         // separating axis test of two convex quads
    for (const P of [A, B]) {
      for (let i = 0; i < P.length; i++) {
        const a = P[i], c = P[(i + 1) % P.length], nx = -(c[1] - a[1]), nz = c[0] - a[0];
        const proj = Q => Q.map(q => q[0] * nx + q[1] * nz);
        const pa = proj(A), pb = proj(B);
        if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
      }
    }
    return true;
  };
  const pairs = [], touching = [], apart = [];        // [lower, upper] of the bridges; [s, o] of the junctions
  for (const s of an.secs) {
    if (s.jump) continue;
    for (const o of hash.near((s.c0[0] + s.c1[0]) / 2, (s.c0[1] + s.c1[1]) / 2, 1500)) {
      if (o === s || o.jump) continue;
      if (o.path === s.path) {                         // the track meeting itself: not the neighbours along the track
        const n = s.path.closed ? s.path.frames.length : s.path.frames.length - 1, dj = Math.abs(o.j - s.j);
        if (Math.min(dj, n - dj) <= 8) continue;
      }
      if (!overlap(expanded(s), expanded(o))) continue;
      // at one height a junction (junctions.js); at different heights a bridge where the roads themselves cross
      // (bridges.js); verges overlapping at different heights next to a bridge belong to the bridge, elsewhere (roads
      // side by side, a branch climbing to its merge) to a junction with the heights evened out
      // (verges nearly touching at a large height difference - a road high over another one it does not cross - are
      // no junction either: blending their heights pulled the upper road's edge down, RPR1 2026-10-09)
      if (Math.abs(o.y - s.y) < 150) touching.push([s, o]);
      else if (overlap(s.quad, o.quad)) { if (o.y > s.y) { s.under = true; o.over = true; pairs.push([s, o]); } }
      else if (o.y > s.y && o.y - s.y < APART_MAX) apart.push([s, o]);
    }
  }
  const closeOnPath = (a, b) => a.path === b.path && Math.min(Math.abs(a.j - b.j), a.path.frames.length - Math.abs(a.j - b.j)) <= 4;
  for (const [s, o] of apart.slice()) {
    if (!pairs.some(([l, u]) => closeOnPath(l, s) && closeOnPath(u, o))) touching.push([s, o]);
    else { s.under = true; o.over = true; pairs.push([s, o]); }
  }
  // junctions: the touching sections form zones built as one area, their heights blended (junctions.js)
  const J = buildJunctions(paths, touching, secOf);
  const segs = segmentTable(paths);
  // sections without terrain (track.noTerrain): no verge, not part of the landscape's outline - the landscape runs on
  // under the road (a track in the air, bake.js leaves these sections alone)
  const noT = s => !!s && !s.jump && inRange(T.noTerrain, s);
  for (const s of an.secs) if (noT(s)) s.noTerrain = true;
  // drivable verge on this side of the section? (track.noVerge holds the sections without)
  const hasV = (s, d) => !!s && !s.jump && !inRange(T.noVerge, s, d) && !noT(s);

  // kerbs stop before a junction zone (they end with their caps at its border): kerb faces inside a zone are walls
  // (code 80) running out flat onto the other road - suspected to hang the game (SplitJoins, 2026-10-08); the agreed
  // design (kerbs along the joined outline, meeting with a cap at the nose) is not built yet
  const kerbed = (s, d) => !!s && !s.jump && inRange(T.kerbs, s, d) && !J.inZone.has(s.id);

  // per path and frame: does a kerb touch this frame on side d (+1 left, -1 right)?  verge offset of the row v
  const frameInfo = new Map();                      // path key -> {kerb: {1: [..], -1: [..]}, v: {1: [..], -1: [..]}}
  for (const p of paths.all) {
    const n = p.closed ? p.frames.length : p.frames.length - 1, m = p.frames.length;
    const info = { kerb: { 1: [], '-1': [] }, v: { 1: [], '-1': [] } };
    // the row always exists, the terrain docks to it; without verge it lies on the road edge (or the kerb foot)
    const want = { 1: p.frames.map(f => Math.max(0, f.vl)), '-1': p.frames.map(f => Math.max(0, f.vr)) };
    for (let j = 0; j < m; j++) {
      for (const d of [1, -1]) {
        const prev = p.closed ? secOf.get(`${p.key}:${(j - 1 + n) % n}`) : j > 0 ? secOf.get(`${p.key}:${j - 1}`) : null;
        const next = j < n ? secOf.get(`${p.key}:${j}`) : null;
        const k = kerbed(prev, d) || kerbed(next, d);
        const f = p.frames[j];
        // a frame between a section with and one without verge: none (the verge ends in a point over one section)
        const w = hasV(prev, d) && (next ? hasV(next, d) : true) || (!prev && hasV(next, d)) ? want[d][j] : 0;
        info.kerb[d][j] = k;
        info.v[d][j] = k ? (w > 0 ? Math.max(w, kerb.foot + KERB_CLEAR) : kerb.foot) : w;
      }
    }
    frameInfo.set(p.key, info);
  }
  // Rows beside the road as lines of points, one per frame. On the inside of a tight bend a row would run
  // backwards (its strips fold over); there its points are merged into one, so the strips become fans of
  // triangles and kerb and verge go on through the bend.
  const unfold = (P, p) => {
    const m = p.frames.length, C = j => p.frames[j].c;
    const runs = [];
    let full = true;
    for (let j = 0; j < m; j++) if (!P[j]) full = false;          // (every() would skip the holes of a sparse array)
    if (p.closed && full) runs.push({ idx: [...Array(m).keys()], cyclic: true });
    else {
      let start = 0;
      if (p.closed && P[0] && P[m - 1]) { start = P.findIndex(x => !x); if (start < 0) start = 0; }
      let cur = [];
      for (let q = 0; q < m; q++) {
        const j = (start + q) % m;
        if (P[j]) cur.push(j); else { if (cur.length) runs.push({ idx: cur, cyclic: false }); cur = []; }
      }
      if (cur.length) runs.push({ idx: cur, cyclic: false });
    }
    for (const run of runs) {
      // first cut the loops off: where the row crosses itself (a segment with one a few frames on), every point
      // between the two crossing segments moves to the crossing point
      const L = run.idx.length, ix = q => run.idx[run.cyclic ? ((q % L) + L) % L : q];
      for (let guard = 0; guard < 4 * L; guard++) {
        let cut = false;
        for (let a = 0; a < (run.cyclic ? L : L - 1) && !cut; a++) {
          for (let k = a + 2; k <= a + 12 && !cut; k++) {
            if (!run.cyclic && k >= L - 1) break;
            if (run.cyclic && k - a >= L - 1) break;
            const A0 = P[ix(a)], A1 = P[ix(a + 1)], B0 = P[ix(k)], B1 = P[ix(k + 1)];
            const x = segCross([A0[0], A0[2]], [A1[0], A1[2]], [B0[0], B0[2]], [B1[0], B1[2]]);
            if (!x) continue;
            const X = [0, 1, 2].map(c => A0[c] + (A1[c] - A0[c]) * x[0]);
            for (let q = a + 1; q <= k; q++) P[ix(q)] = X;
            cut = true;
          }
        }
        if (!cut) break;
      }
      let groups = [];
      for (const j of run.idx) {                      // points already on one spot form one group
        const last = groups[groups.length - 1];
        if (last && last.M === P[j]) last.js.push(j); else groups.push({ js: [j], M: P[j] });
      }
      if (run.cyclic && groups.length > 1 && groups[0].M === groups[groups.length - 1].M) { const g = groups.pop(); groups[0].js.unshift(...g.js); }
      const mean = js => [0, 1, 2].map(k => js.reduce((sum, j) => sum + P[j][k], 0) / js.length);
      for (let guard = 0; guard < 4 * run.idx.length && groups.length > 1; guard++) {
        let merged = false;
        const n = groups.length;
        for (let g = 0; g < (run.cyclic ? n : n - 1); g++) {
          const A = groups[g], B = groups[(g + 1) % n];
          const ja = A.js[A.js.length - 1], jb = B.js[0];
          const cx = [C(jb)[0] - C(ja)[0], C(jb)[2] - C(ja)[2]], dir = [B.M[0] - A.M[0], B.M[2] - A.M[2]];
          if (dir[0] * cx[0] + dir[1] * cx[1] > 0.1 * (cx[0] * cx[0] + cx[1] * cx[1])) continue;
          const js = A.js.concat(B.js), G = { js, M: mean(js) };
          if ((g + 1) % n === 0) groups = [G, ...groups.slice(1, n - 1)];          // the last group joins the first
          else groups.splice(g, 2, G);
          merged = true;
          break;
        }
        if (!merged) break;
      }
      for (const G of groups) if (G.js.length > 1 || G.M !== P[G.js[0]]) for (const j of G.js) P[j] = G.M;
    }
  };
  const frameIndex = new Map();                     // frame object -> index in its path
  for (const p of paths.all) p.frames.forEach((f, j) => frameIndex.set(f, j));
  const rowPts = new Map();                         // path key -> {1: {c, e, k1, k2, k3, v: [point per frame]}, -1: ...}
  for (const p of paths.all) {
    const info = frameInfo.get(p.key), out = {};
    for (const d of [1, -1]) {
      const R = { k1: [], k2: [], k3: [], v: [] };
      p.frames.forEach((f, j) => {
        const at = (off, dy) => { const q = edgePoint(f, d, off); q[1] += dy; return q; };
        if (info.kerb[d][j]) { R.k1[j] = at(inset, kerb.height); R.k2[j] = at(kerb.foot - inset, kerb.height); R.k3[j] = at(kerb.foot, 0); }
        R.v[j] = at(info.v[d][j], 0);
      });
      for (const name of ['k1', 'k2', 'k3', 'v']) {
        R[name].length = p.frames.length; unfold(R[name], p);
        // heights at junctions (junctions.js); points merged by unfold are one object, lifted once
        const done = new Map();
        for (let j = 0; j < R[name].length; j++) {
          const q = R[name][j];
          if (!q) continue;
          if (!done.has(q)) done.set(q, [q[0], J.lift(p, q), q[2]]);
          R[name][j] = done.get(q);
        }
      }
      // the centre line and the road edge, lifted too (the terrain docks to the edge where there is no verge)
      R.c = p.frames.map(f => [f.c[0], J.lift(p, f.c), f.c[2]]);
      R.e = p.frames.map(f => { const q = edgePoint(f, d); return [q[0], J.lift(p, q), q[2]]; });
      out[d] = R;
    }
    rowPts.set(p.key, out);
  }
  // points of the rows at a frame on side d
  // road markings (track.marking): centre line (rows c..m, LINE wide in all) and edge lines (rows l1..l2, LINE wide,
  // EDGE_GAP from the road edge), as own strips of the road
  const LINE = 16, EDGE_GAP = 15, marking = { centre: 'none', edges: false, ...(T.marking || {}) };
  const mark = quick || markObj ? { centre: 'none', edges: false } : marking;
  const rows = (p, f, d) => {
    const j = frameIndex.get(f), R = rowPts.get(p.key)[d];
    const up = q => [q[0], J.lift(p, q), q[2]];                // heights at junctions (junctions.js)
    const out = { c: R.c[j], e: R.e[j], v: R.v[j] };
    if (mark.centre !== 'none') out.m = up(edgePoint(f, d, LINE / 2 - f.half));
    if (mark.edges && f.half > LINE * 2 + EDGE_GAP) { out.l1 = up(edgePoint(f, d, -EDGE_GAP - LINE)); out.l2 = up(edgePoint(f, d, -EDGE_GAP)); }
    for (const n of ['k1', 'k2', 'k3']) if (R[n][j]) out[n] = R[n][j];
    return out;
  };
  const ROWS = ['c', 'm', 'l1', 'l2', 'e', 'k1', 'k2', 'k3', 'v'], IN_ROAD = ['c', 'm', 'l1', 'l2'];

  const tris = [];
  // n: row names of the three corners, fr: path frame index of each corner (bake needs both to dock the outer row)
  // sec: the section the triangle lies in (the compiler decides the placements, compile.js)
  const add = (s, p3, mat, zone, d, extra = {}) => tris.push({ p: p3, mat, zone, sec: s.id, side: d, path: s.path.key, covered: false, ...extra });
  // Triangles that fold over (turned around by a tight bend) or overlap one that is there already are left out, one
  // by one: the road first, then the kerbs, then the verge. The landscape generated later fills what is left.
  const accepted = new Hash(300), area = p3 => (p3[1][0] - p3[0][0]) * (p3[2][2] - p3[0][2]) - (p3[1][2] - p3[0][2]) * (p3[2][0] - p3[0][0]);
  const acceptedBox = p3 => { const xs = p3.map(q => q[0]), zs = p3.map(q => q[2]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
  const triOverlap = (A, B) => {                      // interiors overlap in the plan (touching along an edge or at a corner does not count)
    for (const P of [A, B]) for (let i = 0; i < 3; i++) {
      const a = P[i], c = P[(i + 1) % 3], nx = -(c[2] - a[2]), nz = c[0] - a[0], len = Math.hypot(nx, nz) || 1;
      const pa = A.map(q => (q[0] * nx + q[2] * nz) / len), pb = B.map(q => (q[0] * nx + q[2] * nz) / len);
      if (Math.max(...pa) <= Math.min(...pb) + 0.5 || Math.max(...pb) <= Math.min(...pa) + 0.5) return false;
    }
    return true;
  };
  const overlapsAccepted = (p3, path) => {
    const bx = acceptedBox(p3), cx = (bx[0] + bx[2]) / 2, cz = (bx[1] + bx[3]) / 2, y = (p3[0][1] + p3[1][1] + p3[2][1]) / 3;
    for (const o of accepted.near(cx, cz, Math.max(bx[2] - bx[0], bx[3] - bx[1]) / 2 + 1)) {
      if (o.path === path && Math.abs(o.y - y) < 150 && triOverlap(o.p, p3)) return true;
    }
    return false;
  };
  const put = (s, p3, mat, zone, d, extra) => {
    add(s, p3, mat, zone, d, extra);
    accepted.add({ p: p3, y: (p3[0][1] + p3[1][1] + p3[2][1]) / 3, path: s.path.key }, ...acceptedBox(p3));
  };
  const pending = [[], []];                            // kerb strips, verge strips
  // road flags of a section; ramp: behaviour 2 (code 10), the edge to not drivable ground can be left (jump take-off)
  const flagMat = s => (inRange(T.order, s) ? 'roadOrder' : inRange(T.ramp, s) ? 'ramp' : inRange(T.slippery, s) ? 'roadSlip' : 'road');
  // the verge follows "deadly if wrong order" (landing beside the road must count too, user 2026-10-08)
  const vergeMat = s => (inRange(T.order, s) ? 'driveOrder' : 'drive');

  for (const s of an.secs) {
    if (s.jump || J.inZone.has(s.id)) continue;
    const p = s.path, roadMat = flagMat(s);
    for (const d of [1, -1]) {
      const full = ROWS.filter(r => !r.startsWith('k') || (!quick && kerbed(s, d)));
      const r0 = rows(p, s.f0, d), r1 = rows(p, s.f1, d);
      const names = full.filter(r => r0[r] && r1[r]);
      for (let n = 0; n + 1 < names.length; n++) {
        const a = names[n], b = names[n + 1];
        const A0 = r0[a], B0 = r0[b], A1 = r1[a], B1 = r1[b];
        const road = IN_ROAD.includes(a), zone = road ? 'road' : b === 'k1' ? 'kerbIn' : b === 'k2' ? 'kerbTop' : b === 'k3' ? 'kerbOut' : 'drive';
        // markings: the centre strip (solid, or every other section) and the edge line strip
        const line = (a === 'c' && b === 'm' && (mark.centre === 'solid' || (mark.centre === 'dashed' && s.j % 2 === 0))) || (a === 'l1' && b === 'l2');
        const mat = road ? (line ? 'line' : roadMat) : zone === 'drive' ? vergeMat(s) : zone;
        const j0 = frameIndex.get(s.f0), j1 = frameIndex.get(s.f1);
        // corners as [point, name, frame index]
        const a0 = [A0, a, j0], b0 = [B0, b, j0], a1 = [A1, a, j1], b1 = [B1, b, j1];
        const quad = road ? [[a0, b0, a1], [b0, b1, a1]]                 // inside the road: diagonal edge side(near) - centre side(far)
                               : [[a0, b0, b1], [a0, b1, a1]];           // diagonal inner(near) - outer(far)
        const items = [];
        for (const t of quad) {
          const c = [0, 1, 2].map(k => (t[0][0][k] + t[1][0][k] + t[2][0][k]) / 3);
          items.push([s, t.map(x => x[0]), mat, zone, d, { n: t.map(x => x[1]), fr: t.map(x => x[2]), strip: a + '-' + b, q: quad.indexOf(t) }]);
        }
        if (road) { for (const item of items) put(...item); continue; }
        // how far the outer edge of the strip advances along the road (a strip turned over by a bend does not)
        const step = [s.f1.c[0] - s.f0.c[0], s.f1.c[2] - s.f0.c[2]], adv = ((B1[0] - B0[0]) * step[0] + (B1[2] - B0[2]) * step[1]) / ((step[0] * step[0] + step[1] * step[1]) || 1);
        pending[zone.startsWith('kerb') ? 0 : 1].push({ items, adv, quad: [A0, B0, B1, A1], d });
      }
      // end caps of a kerb run
      if (!quick && !s.covered && kerbed(s, d)) {
        const len = p.frames.length;           // closed path: sections = frames; open: one section fewer, the lookups below then miss
        const prev = secOf.get(`${p.key}:${p.closed ? (s.j - 1 + len) % len : s.j - 1}`);
        const next = secOf.get(`${p.key}:${(s.j + 1) % len}`);
        const tan = f => [f.left[1], 0, -f.left[0]];
        const cap = (r, f, dir) => {
          const facing = tan(f).map(v => v * dir), fr = frameIndex.get(f);
          const strip = dir < 0 ? 'cap0' : 'cap1';
          add(s, [r.e, r.k1, r.k2], 'kerbOut', 'kerbOut', d, { facing, cap: true, fr, strip, q: 0 });
          add(s, [r.e, r.k2, r.k3], 'kerbOut', 'kerbOut', d, { facing, cap: true, fr, strip, q: 1 });
        };
        if (!kerbed(prev, d)) cap(r0, s.f0, -1);
        if (!kerbed(next, d)) cap(r1, s.f1, 1);
      }
    }
  }

  for (const list of pending) {
    for (const strip of list) {
      const items = strip.items.filter(item => Math.abs(area(item[1])) >= 1);              // fans in a bend: a corner merged
      if (items.some(item => Math.sign(area(item[1])) !== -strip.d)) continue;            // turned over: the piece is left out
      if (items.some(item => overlapsAccepted(item[1], item[0].path.key))) continue;    // overlaps something of its own road
      for (const item of items) put(...item);
    }
  }

  // junctions: the zones as one area each (junctions.js)
  J.build({ rows, kerbed: quick ? () => false : kerbed, flagMat, vergeMat, mark, kerb, add });

  // markings as separate quads above the road (not in junction zones for now)
  if (markObj && (marking.centre !== 'none' || marking.edges)) {
    const MARK_LIFT = 3;
    for (const s of an.secs) {
      if (s.jump || J.inZone.has(s.id)) continue;
      const p = s.path, j0 = frameIndex.get(s.f0), j1 = frameIndex.get(s.f1);
      for (const d of [1, -1]) {
        const at = (f, off) => { const q = edgePoint(f, d, off); return [q[0], J.lift(p, q) + MARK_LIFT, q[2]]; };
        const bands = [];
        if (marking.centre === 'solid' || (marking.centre === 'dashed' && s.j % 2 === 0)) bands.push(['centre', [-s.f0.half, LINE / 2 - s.f0.half], [-s.f1.half, LINE / 2 - s.f1.half]]);
        if (marking.edges && s.f0.half > LINE * 2 + EDGE_GAP && s.f1.half > LINE * 2 + EDGE_GAP) bands.push(['edge', [-EDGE_GAP - LINE, -EDGE_GAP], [-EDGE_GAP - LINE, -EDGE_GAP]]);
        for (const [name, o0, o1] of bands) {
          const A0 = at(s.f0, o0[0]), B0 = at(s.f0, o0[1]), A1 = at(s.f1, o1[0]), B1 = at(s.f1, o1[1]);
          add(s, [A0, B0, A1], 'line', 'line', d, { marking: true, strip: 'mark-' + name, q: 0, n: null, fr: [j0, j0, j1] });
          add(s, [B0, B1, A1], 'line', 'line', d, { marking: true, strip: 'mark-' + name, q: 1, n: null, fr: [j0, j1, j1] });
        }
      }
    }
  }

  // the faces of sections without terrain float (not part of the landscape's outline)
  for (const t of tris) if (secOf.get(t.sec)?.noTerrain) t.floating = true;
  // crossings: tunnel (the lower road is cut where it passes under the upper one: floor, walls, ceiling, fascia),
  // bridge (a free-standing deck) or none, by the user's choice per crossing (track.crossings) or the default
  const deckEnds = [];
  const { built: bridges, crossings } = buildBridges({ pairs, tris, rows, secOf, deck: T.deck ?? 60, deckEnds, modes: T.crossings || {}, terrain });

  // outer row offset of the verge on a canonical side sc at canonical frame index i (fractional: lerped)
  const vAt = (segKey, sc, i) => {
    const e = segs.get(segKey);
    if (!e) return 0;
    const d = e.canon ? sc : -sc, info = frameInfo.get(e.path.key);
    const at = ic => info.v[d][e.drv[e.canon ? ic : e.k - ic]];
    const i0 = Math.max(0, Math.min(e.k, Math.floor(i))), i1 = Math.min(e.k, i0 + 1), u = Math.min(1, Math.max(0, i - i0));
    return at(i0) + (at(i1) - at(i0)) * u;
  };
  // how far the drivable verge of this section reaches beyond its road edge (0: none)
  const vergeOf = (s, d) => (!hasV(s, d) ? 0 : Math.max(0, frameInfo.get(s.path.key).v[d][frameIndex.get(s.f0)]));
  // point of a row (c: centre line, e: road edge, v: verge, k1..k3: kerb) on a canonical side sc at canonical frame
  // index i (fractional: lerped); null where the row is not there (no kerb)
  const rowPos = (segKey, sc, i, row) => {
    const e = segs.get(segKey);
    if (!e) return null;
    const d = e.canon ? sc : -sc, R = rowPts.get(e.path.key)[d][row];
    if (!R) return null;
    const at = ic => R[e.drv[e.canon ? ic : e.k - ic]];
    const i0 = Math.max(0, Math.min(e.k, Math.floor(i))), i1 = Math.min(e.k, i0 + 1), u = Math.min(1, Math.max(0, i - i0));
    const a = at(i0), c = at(i1);
    if (!a || (u && !c)) return null;
    return u ? [0, 1, 2].map(k => a[k] + (c[k] - a[k]) * u) : a;
  };
  const vPos = (segKey, sc, i) => rowPos(segKey, sc, i, 'v');
  return { tris, segs, vAt, vPos, rowPos, vergeOf, kerb, frameInfo, frameIndex, rows, an, bridges, crossings, deckEnds, junctions: J.inZone.size, warnings: J.warnings,
           touching: touching.map(([s, o]) => [s.id, o.id]) };      // the junction pairs (for looking into a level)
}
