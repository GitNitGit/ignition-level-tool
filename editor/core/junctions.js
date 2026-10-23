// Junctions: where two roads (or their verges) overlap at about the same height - a fork, a merge, a branch running
// beside the main road, the track beside itself - the base is not built from strips there. The sections of both
// roads that touch (and one more on each side) form a zone that is built as one area:
//   - plan: every band of every section in the zone (centre line, road, edge lines, kerb bands, verge) is a quad
//     between its two frames; all their edges, cut where they cross, are the constraints of one triangulation
//     (cdt.js) of all their corners. At the zone's ends the cross lines carry the same row points as the strips
//     outside, so zone and strips share their vertices;
//   - kind: a triangle is what its centre lies in, the road first (centre line, or the edge line of the joined road:
//     in some road's edge band and not inside another road's, so the edge lines follow the outline of the joined
//     surface and meet at the nose between two roads; else road), then the kerbs (top, inner, outer slope: the kerb
//     bodies of both roads joined, cut off by any road), then the verge;
//   - heights: a blend of both roads' cross sections (the user's design): a point gets its own road's height (its
//     level cross section through the point) and the other road's (its cross section extended through the point:
//     its nearest centre point), the other one weighted d_own / (d_own + d_other) - nothing on the own centre line,
//     one half midway - fading out beyond the reach of the other road's surface. A smooth height field for all rows,
//     so the docked terrain follows. The kerbs are a height field on top: the kerb profile (foot, slope, top) of every
//     kerbed road side, the highest where they overlap (the bodies joined), nothing inside a road: a kerb meeting the
//     other road runs out onto it (no cap in a zone).
// This only models the surface; which mesh a triangle goes to etc. is up to the compiler.
import { triangulate } from './cdt.js';
import { edgePoint, segDist, segCross, inQuad, Hash } from './sections.js';

const ROAD_MAX = 0.2;             // steeper cross slopes are reported (the heights should be evened out there)
const BLEND_FAR = 800;            // the other road's height fades out over this beyond the reach of its surface
const GAP = 3;                    // sections of one road this close together belong to one junction
const PAD = 1;                    // sections beyond the touching ones that belong to the zone
const MERGE = 0.5;                // points this close are one point
const KERB_FADE = 60;             // a kerb runs out to nothing over this before another road
const BLEND_MAX_DY = 400;         // roads further apart in height than this do not blend (a road high over a junction's other road)

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// nearest point of a polyline of frames [{c}]: {d, y, k, t}
function nearest(line, x, z) {
  let best = { d: Infinity, k: 0, t: 0, y: 0 };
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k].c, b = line[k + 1].c, [d, t] = segDist([x, z], [a[0], a[2]], [b[0], b[2]]);
    if (d < best.d) best = { d, k, t, y: a[1] + (b[1] - a[1]) * t };
  }
  return best;
}

// Groups of touching sections: [{A: {path, js}, B: {path, js}}]; A is the main road where one is. touching: [[s, o]]
function groups(touching, secOf) {
  const pairs = [], seen = new Set();
  for (const [s, o] of touching) {
    const k = s.id < o.id ? s.id + '~' + o.id : o.id + '~' + s.id;
    if (!seen.has(k)) { seen.add(k); pairs.push([s, o]); }
  }
  // runs: the sections of one road in the pairs, GAP apart at most
  const parent = new Map(), find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const [s, o] of pairs) for (const x of [s, o]) parent.set(x.id, x.id);
  for (const id of parent.keys()) {
    const s = secOf.get(id), n = s.path.closed ? s.path.frames.length : s.path.frames.length - 1;
    for (let k = 1; k <= GAP; k++) {
      const j = s.path.closed ? (s.j + k) % n : s.j + k, nb = `${s.path.key}:${j}`;
      if (parent.has(nb)) parent.set(find(id), find(nb));
    }
  }
  const out = new Map();
  for (const [s, o] of pairs) {
    const rs = find(s.id), ro = find(o.id);
    if (rs === ro) continue;                                   // the same run (a tight bend): not a junction
    const key = rs < ro ? rs + '|' + ro : ro + '|' + rs;
    if (!out.has(key)) out.set(key, { runs: new Map([[rs, []], [ro, []]]) });
    const g = out.get(key);
    g.runs.get(rs).push(s); g.runs.get(ro).push(o);
  }
  const res = [];
  for (const g of out.values()) {
    let [X, Y] = [...g.runs.values()].map(list => ({ path: list[0].path, js: [...new Set(list.map(s => s.j))] }));
    if (Y.path.key === 'main' && X.path.key !== 'main') [X, Y] = [Y, X];
    res.push({ A: X, B: Y });
  }
  return res;
}

// the sections of one path in a zone as runs along the path: [{j0, j1}] (j1 may be < j0 on a closed path: wrapping)
function runs(path, js) {
  const n = path.closed ? path.frames.length : path.frames.length - 1;
  const set = new Set(js), out = [];
  const sorted = [...set].sort((a, b) => a - b);
  let start = sorted[0];
  if (path.closed) { start = sorted.find(j => !set.has((j - 1 + n) % n)); if (start === undefined) return [{ j0: 0, j1: n - 1 }]; }
  let j = start, cur = null;
  for (let q = 0; q < n; q++) {
    const jj = path.closed ? (start + q) % n : start + q;
    if (jj >= n) break;
    if (set.has(jj)) { if (!cur) cur = { j0: jj, j1: jj }; else cur.j1 = jj; }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// Junctions of a base. touching: [[s, o]] sections overlapping at about one height.
// Returns {inZone: Set of section ids, lift(path, point) -> height, warnings, build(ctx)}; build adds the zones'
// triangles with ctx = {rows(path, frame, side), kerbed(section, side), flagMat(section), mark, kerb, add(...)}.
export function buildJunctions(paths, touching, secOf) {
  const warnings = [];
  const reachOf = p => Math.max(...p.frames.map(f => f.half + Math.max(f.vl, f.vr)));
  const G = groups(touching, secOf);
  const secsOf = p => (p.closed ? p.frames.length : p.frames.length - 1);

  // ---- heights: the blend of both roads' cross sections (see the top)
  const fullLine = p => (p.closed ? p.frames.concat([p.frames[0]]) : p.frames);
  const spanLine = (p, js) => {
    // the frames of the touching sections, padded, in order (a polyline along the road's stretch in the junction)
    const n = secsOf(p), m = p.frames.length, out = [];
    for (const r of runs(p, js)) {
      const len = p.closed ? ((r.j1 - r.j0 + n) % n) + 1 : r.j1 - r.j0 + 1;
      for (let q = -GAP; q <= len + GAP; q++) {
        let j = r.j0 + q;
        if (p.closed) j = ((j % m) + m) % m; else if (j < 0 || j >= m) continue;
        out.push(p.frames[j]);
      }
    }
    return out;
  };
  // own height: the own road's whole centre line; the other road: only its stretch in the junction (not where it passes
  // over or under at a bridge)
  const blends = G.map(g => {
    const same = g.A.path === g.B.path;
    return { g, oA: same ? spanLine(g.A.path, g.A.js) : fullLine(g.A.path), oB: same ? spanLine(g.B.path, g.B.js) : fullLine(g.B.path),
             sA: spanLine(g.A.path, g.A.js), sB: spanLine(g.B.path, g.B.js), reach: Math.max(reachOf(g.A.path), reachOf(g.B.path)) };
  });
  const smooth = t => t * t * (3 - 2 * t);
  const delta = (own, other, reach, x, z) => {
    const b = nearest(other, x, z);
    if (b.d >= reach + BLEND_FAR) return 0;
    const a = nearest(own, x, z), w = a.d + b.d > 1e-6 ? a.d / (a.d + b.d) : 0.5;
    if (Math.abs(b.y - a.y) > BLEND_MAX_DY) return 0;      // not at one height: a road passing high over the junction's other road (RPR1, 2026-10-09)
    return w * (b.d <= reach ? 1 : smooth(1 - (b.d - reach) / BLEND_FAR)) * (b.y - a.y);
  };
  // the height of point p of path's base (p[1]: its height on the level road) in the junctions
  const lift = (path, p) => {
    let best = 0;
    for (const B of blends) for (const [P, own, other] of [[B.g.A.path, B.oA, B.sB], [B.g.B.path, B.oB, B.sA]]) {
      if (P !== path) continue;
      const d = delta(own, other, B.reach, p[0], p[2]);
      if (Math.abs(d) > Math.abs(best)) best = d;
    }
    return p[1] + best;
  };
  // too steep across: report once per junction and road
  for (const g of G) for (const S of [g.A, g.B]) {
    let worst = null;
    for (const f of spanLine(S.path, S.js)) {
      const c = lift(S.path, f.c);
      for (const d of [1, -1]) { const e = edgePoint(f, d, 0), v = Math.abs(lift(S.path, e) - c) / f.half; if (v > ROAD_MAX && (!worst || v > worst.v)) worst = { v, f }; }
    }
    if (worst) warnings.push({ text: `Junction: the road slopes ${Math.round(worst.v * 100)} % across where it meets the other road (more than ${Math.round(ROAD_MAX * 100)} %): even out the heights there`, at: worst.f.c.slice() });
  }

  // ---- zones: the touching sections padded by PAD, groups sharing a section joined
  const zoneSecs = G.map(g => {
    const ids = new Set();
    for (const S of [g.A, g.B]) {
      const p = S.path, n = secsOf(p);
      for (const j of S.js) for (let k = -PAD; k <= PAD; k++) {
        const jj = p.closed ? ((j + k) % n + n) % n : j + k;
        if (jj >= 0 && jj < n) ids.add(`${p.key}:${jj}`);
      }
    }
    return ids;
  });
  const zparent = zoneSecs.map((_, i) => i), zfind = i => { while (zparent[i] !== i) i = zparent[i]; return i; };
  for (let a = 0; a < zoneSecs.length; a++) for (let b = a + 1; b < zoneSecs.length; b++) {
    if ([...zoneSecs[a]].some(id => zoneSecs[b].has(id))) zparent[zfind(a)] = zfind(b);
  }
  const zones = new Map();
  zoneSecs.forEach((ids, i) => { const r = zfind(i); if (!zones.has(r)) zones.set(r, new Set()); for (const id of ids) zones.get(r).add(id); });
  const inZone = new Set([...zones.values()].flatMap(z => [...z]));

  // a zone's roads: per path the runs of its sections, each with the frames it spans and whether a cross line
  // (the strips outside) closes it at the start / end
  const zoneRoads = [...zones.values()].map(ids => {
    const byPath = new Map();
    for (const id of ids) { const s = secOf.get(id); if (!byPath.has(s.path)) byPath.set(s.path, []); byPath.get(s.path).push(s.j); }
    const roads = [];
    for (const [p, js] of byPath) for (const r of runs(p, js)) {
      const n = secsOf(p), m = p.frames.length, secs = [];
      for (let j = r.j0; ; j = (j + 1) % n) { secs.push(secOf.get(`${p.key}:${j}`)); if (j === r.j1) break; }
      const endFrame = p.closed ? (r.j1 + 1) % m : r.j1 + 1;
      roads.push({ path: p, secs, startCross: p.closed || r.j0 > 0, endCross: p.closed || endFrame < m - 1, startFrame: r.j0, endFrame });
    }
    roads.sort((a, b) => (a.path.key === 'main' ? 0 : 1) - (b.path.key === 'main' ? 0 : 1));
    return roads;
  });

  const build = ctx => { for (const roads of zoneRoads) zoneMesh(roads, ctx, lift, warnings); };
  return { inZone, lift, warnings, build, zones: zoneRoads };
}

const ROWS = ['c', 'm', 'l1', 'l2', 'e', 'k1', 'k2', 'k3', 'v'];

// the triangles of one zone; roads: [{path, secs, startCross, endCross, startFrame, endFrame}]
function zoneMesh(roads, ctx, lift, warnings) {
  const { rows, kerbed, flagMat, vergeMat, mark, kerb, add } = ctx;
  const inset = Math.max(0, (kerb.foot - kerb.lid) / 2);
  // ---- points (plan) with the row they are on; constraint segments
  const pts = [], at = new Map();
  const key = p => Math.round(p[0] / MERGE) + ',' + Math.round(p[2] / MERGE);
  const point = (p, attr = null) => {
    const k = key(p);
    if (at.has(k)) { const q = pts[at.get(k)]; if (attr && !q.attr) { q.p = [p[0], p[2]]; q.attr = attr; } return at.get(k); }
    pts.push({ p: [p[0], p[2]], attr }); at.set(k, pts.length - 1);
    return pts.length - 1;
  };
  const segs = [], segSeen = new Set();
  const seg = (a, b) => { if (a === b) return; const k = a < b ? a + ',' + b : b + ',' + a; if (!segSeen.has(k)) { segSeen.add(k); segs.push([a, b]); } };
  const xz = p => [p[0], p[2]];
  // bands: {quad [[x,z] x4], kind, s, d, a, b}; road / centre / gap / line quads per section for the kind test
  const bands = [], roadQ = [], centreQ = [], gapQ = [], lineQ = [], kerbQ = [];      // kerbQ: {quad e..k3, e0, e1}
  const LINE = 16, EDGE_GAP = 15;
  for (const R of roads) {
    const p = R.path, j = f => p.frames.indexOf(f);
    for (const s of R.secs) {
      const f0 = s.f0, f1 = s.f1, j0 = j(f0), j1 = j(f1);
      roadQ.push({ s, q: [edgePoint(f0, -1), edgePoint(f0, 1), edgePoint(f1, 1), edgePoint(f1, -1)].map(xz) });
      if (mark.centre !== 'none') centreQ.push({ s, q: [edgePoint(f0, -1, LINE / 2 - f0.half), edgePoint(f0, 1, LINE / 2 - f0.half), edgePoint(f1, 1, LINE / 2 - f1.half), edgePoint(f1, -1, LINE / 2 - f1.half)].map(xz) });
      if (mark.edges && f0.half > LINE * 2 + EDGE_GAP && f1.half > LINE * 2 + EDGE_GAP) {
        gapQ.push({ s, q: [edgePoint(f0, -1, -EDGE_GAP), edgePoint(f0, 1, -EDGE_GAP), edgePoint(f1, 1, -EDGE_GAP), edgePoint(f1, -1, -EDGE_GAP)].map(xz) });
        lineQ.push({ s, q: [edgePoint(f0, -1, -EDGE_GAP - LINE), edgePoint(f0, 1, -EDGE_GAP - LINE), edgePoint(f1, 1, -EDGE_GAP - LINE), edgePoint(f1, -1, -EDGE_GAP - LINE)].map(xz) });
      }
      for (const d of [1, -1]) {
        const r0 = rows(p, f0, d), r1 = rows(p, f1, d), k = kerbed(s, d);
        const names = ROWS.filter(r => (!r.startsWith('k') || k) && r0[r] && r1[r]);
        if (k && r0.k3 && r1.k3) kerbQ.push({ quad: [r0.e, r0.k3, r1.k3, r1.e].map(xz), e0: xz(r0.e), e1: xz(r1.e), path: p, d, j0, j1 });
        const ix0 = {}, ix1 = {};
        for (const r of names) {
          ix0[r] = point(r0[r], { n: r, fr: j0, path: p, side: d, y: r0[r][1] });
          ix1[r] = point(r1[r], { n: r, fr: j1, path: p, side: d, y: r1[r][1] });
        }
        for (let n = 0; n + 1 < names.length; n++) {
          const a = names[n], b = names[n + 1];
          const quad = [r0[a], r0[b], r1[b], r1[a]].map(xz);
          if (Math.abs(area(quad)) < 1) continue;                          // a band of no width (no verge, no line)
          bands.push({ quad, s, d, a, b });
          seg(ix0[a], ix1[a]); seg(ix0[b], ix1[b]);                        // along the road
          seg(ix0[a], ix0[b]); seg(ix1[a], ix1[b]);                        // across (the bands change per section)
        }
      }
    }
  }
  // cut the segments where they cross or touch each other
  const P = i => pts[i].p;
  const box = ([a, b]) => [Math.min(P(a)[0], P(b)[0]), Math.min(P(a)[1], P(b)[1]), Math.max(P(a)[0], P(b)[0]), Math.max(P(a)[1], P(b)[1])];
  const sh = new Hash(200);
  segs.forEach((s, k) => sh.add(k, ...box(s)));
  const cuts = segs.map(() => []);
  for (let a = 0; a < segs.length; a++) {
    const bx = box(segs[a]);
    for (const b of sh.near((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, Math.max(bx[2] - bx[0], bx[3] - bx[1]) / 2 + 1)) {
      if (b <= a) continue;
      const x = segCross(P(segs[a][0]), P(segs[a][1]), P(segs[b][0]), P(segs[b][1]));
      if (!x) continue;
      const A = P(segs[a][0]), B = P(segs[a][1]), ia = pts[segs[a][0]].attr, ib = pts[segs[a][1]].attr;
      // a crossing on a row of the base (between two frames) stays on that row with a fractional frame index, so
      // the terrain docks to it exactly (the row's height lerped like the dock does)
      const row = ia && ib && ia.path === ib.path && ia.n === ib.n && ia.side === ib.side && Math.abs(ia.fr - ib.fr) === 1;
      const attr = row ? { n: ia.n, fr: ia.fr + (ib.fr - ia.fr) * x[0], path: ia.path, side: ia.side, y: ia.y + (ib.y - ia.y) * x[0] } : null;
      const i = point([A[0] + (B[0] - A[0]) * x[0], 0, A[1] + (B[1] - A[1]) * x[0]], attr);
      cuts[a].push(i); cuts[b].push(i);
    }
  }
  const ph = new Hash(200);
  pts.forEach((q, i) => ph.add(i, q.p[0], q.p[1], q.p[0], q.p[1]));
  const constraints = [];
  segs.forEach(([a, b], k) => {
    const A = P(a), B = P(b), bx = box([a, b]);
    const cand = new Set(cuts[k]);
    for (const i of ph.near((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, Math.max(bx[2] - bx[0], bx[3] - bx[1]) / 2 + 1)) if (segDist(P(i), A, B)[0] < MERGE) cand.add(i);
    const on = [...cand].filter(i => i !== a && i !== b)
      .map(i => [segDist(P(i), A, B)[1], i]).filter(([t]) => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    const chain = [a, ...on, b];
    for (let i = 0; i + 1 < chain.length; i++) if (chain[i] !== chain[i + 1]) constraints.push([chain[i], chain[i + 1]]);
  });
  // ---- kinds by the centre
  const inRoad = c => roadQ.filter(r => inQuad(c, r.q));
  const dashOn = s => mark.centre === 'solid' || (mark.centre === 'dashed' && s.j % 2 === 0);
  const kerbBand = (c, a, b) => bands.find(x => x.a === a && x.b === b && inQuad(c, x.quad));
  // ---- heights: row points as the strips have them (lifted, kerb tops raised where not inside a road); other points
  // from the blend of the road nearest to them
  const insideRoad = c => roadQ.some(r => inQuad(c, r.q));
  const lines = roads.map(R => ({ R, line: R.secs.map(s => s.f0).concat([R.secs[R.secs.length - 1].f1]) }));
  const heightAt = (x, z) => {
    let best = null, bd = Infinity;
    for (const L of lines) { const q = nearest(L.line, x, z); if (q.d < bd) { bd = q.d; best = { L, q }; } }
    return lift(best.L.R.path, [x, best.q.y, z]);
  };
  // the kerbs' height over the surface: the profile of every kerbed road side (slope up over `inset`, the top, slope
  // down), the highest where they overlap, nothing inside a road
  // (a row point's own kerb bands do not count: its own height is exact, the distance to the chord is not). Before
  // another road a kerb runs out over KERB_FADE, so it ends in a ramp, not in a step.
  const quadDist = (c, q) => Math.min(...[0, 1, 2, 3].map(i => segDist(c, q[i], q[(i + 1) % 4])[0]));
  const fadeAt = (c, path) => {
    let f = 1;
    for (const r of roadQ) if (r.s.path !== path) f = Math.min(f, (inQuad(c, r.q) ? 0 : quadDist(c, r.q)) / KERB_FADE);
    return f;
  };
  const kerbAt = (c, a, own) => {
    if (insideRoad(c)) return 0;
    let best = own ? own * fadeAt(c, a.path) : 0;
    for (const b of kerbQ) {
      if (a && b.path === a.path && b.d === a.side && (b.j0 === a.fr || b.j1 === a.fr)) continue;
      if (!inQuad(c, b.quad)) continue;
      const [u] = segDist(c, b.e0, b.e1);
      const h = inset <= 0 ? 1 : u < inset ? u / inset : u <= kerb.foot - inset ? 1 : u < kerb.foot ? (kerb.foot - u) / inset : 0;
      if (h > best) best = Math.max(best, h * fadeAt(c, b.path));
    }
    return best * kerb.height;
  };
  const RAISE = pts.map(q => { const a = q.attr; return kerbAt(q.p, a, a && (a.n === 'k1' || a.n === 'k2') ? 1 : 0); });
  const Y = pts.map((q, i) => {
    const a = q.attr;
    const ground = a ? a.y - (a.n === 'k1' || a.n === 'k2' ? kerb.height : 0) : heightAt(q.p[0], q.p[1]);
    return ground + RAISE[i];
  });
  // ---- triangulate and classify
  const res = triangulate(pts.map(q => q.p), constraints);
  if (res.failed.length) warnings.push({ text: `Junction: ${res.failed.length} edge(s) could not be kept in the surface`, at: [pts[res.failed[0][0]].p[0], Y[res.failed[0][0]], pts[res.failed[0][0]].p[1]] });
  let q = 0;
  for (const t of res.tris) {
    const c = [0, 1].map(k => (pts[t[0]].p[k] + pts[t[1]].p[k] + pts[t[2]].p[k]) / 3);
    const inR = inRoad(c);
    let s = null, mat, zone, d = 0;
    if (inR.length) {
      s = inR[0].s;
      const cen = centreQ.find(r => inQuad(c, r.q) && dashOn(r.s));
      const line = cen || (gapQ.some(r => inQuad(c, r.q)) && !lineQ.some(r => inQuad(c, r.q)));
      mat = line ? 'line' : flagMat(s); zone = 'road';
    } else {
      const band = kerbBand(c, 'k1', 'k2') || kerbBand(c, 'e', 'k1') || kerbBand(c, 'k2', 'k3') || bands.find(x => x.b === 'v' && inQuad(c, x.quad));
      if (!band) continue;
      s = band.s; d = band.d;
      zone = band.b === 'k1' ? 'kerbIn' : band.b === 'k2' ? 'kerbTop' : band.b === 'k3' ? 'kerbOut' : 'drive';
      mat = zone === 'drive' ? vergeMat(s) : zone;
    }
    const corner = i => [pts[i].p[0], Y[i], pts[i].p[1]];
    const attr = i => pts[i].attr;
    add(s, t.map(corner), mat, zone, d, { n: t.map(i => attr(i)?.n ?? null), fr: t.map(i => attr(i)?.fr ?? null),
      paths: t.map(i => attr(i)?.path.key ?? null), sides: t.map(i => attr(i)?.side ?? null), raise: t.map(i => RAISE[i]), strip: 'zone', q: q++ });
  }
}

const area = Q => { let a = 0; for (let i = 0; i < Q.length; i++) { const p = Q[i], n = Q[(i + 1) % Q.length]; a += p[0] * n[1] - n[0] * p[1]; } return a / 2; };
