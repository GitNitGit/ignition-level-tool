// Level -> game files and the check report. Runs in the browser (live preview, checks) and in Node
// (writing). The base (road, kerbs, verge: base.js) and the stored landscape (terrain.js) are put
// together here; the compiler also fixes what the game cannot take (too long edges) without touching the
// stored geometry. Numbering and types: docs/EDITOR.md "Compile rules", LEVELFORMAT.md ch. 15/20.
import { pyRound } from './util.js';
import { Mesh } from './mesh.js';
import { buildPaths, lerpFrame } from './paths.js';
import { toEntries, writeMSH, writePLC, writePOS, writeTRI, writeSRF, FACE_FLAGS, LANDSCAPE } from './formats.js';
import { animEntryOf, animFrames, poseAt } from './anim.js';
import { soundMarkers, MARKER_TYPE, SLOT_FIRST, SLOT_MAX } from './sounds.js';
import { placedFaces, HIT, KICK, LIGHT, placementType } from './objects.js';
import { splitByTiles } from './texmap.js';
import { validate } from './validate.js';
import { structureChecks, crossingChecks } from './checks.js';
import { analyseSections, Hash, quadBox, segDist, edgePoint, inRange, inQuad } from './sections.js';
import { buildBase } from './base.js';
import { closeMouths, closeDeckEnds } from './bridges.js';
import { gameTrackOrder } from './gameorder.js';
import { autoSigns } from './signs.js';
import { dockContext, resolve, openEdges, components } from './terrain.js';
import { MATERIALS, DRAW_ORDER, ROADLIKE, steep } from './materials.js';
import { lightFaces, faceColour } from './lighting.js';
import { buildPalette, cellUV, rgb, PAL_FROM } from './palette.js';
import { baseColour, parsePaint, paintUV, roadFrame, materialColour } from './paint.js';

// PATH_A/PATH_B: the two parallel paths between a fork and its merge; in all seven originals one path is
// entirely type 4, the other type 5 (with type 2 on both, the game showed "Wrong way" on one of them and
// the AI lost its way)
export const TYPE = { START: 0, FIRST: 1, SECTION: 2, FORK: 3, PATH_A: 4, PATH_B: 5, MERGE: 6, JUMP: 7, SCENERY: 50, OBJECT: 200 };
const OBJECT_CODE = 300;                // surface code of object faces (LEVELFORMAT.md ch. 17)
export const LAP_SECONDS_PER_1000 = 0.72; // expected lap time per 1000 units of the shortest lap (the originals, see the stats)
// Tile numbers (texture x 16 + tile) per level slot, fixed by the game for each slot (not taken from the level files):
// keyed = the game draws faces with these tiles colour-keyed (palette index 0 see-through); blend = colour key + 50 %
// blend forced; unusable = tiles the game overwrites with the slot's .TFX at load, or marked unusable. Texture 0
// (numbers 0-15) holds the colour cells. LEVELFORMAT.md ch. 16.
export const SLOT_TILES = {
  Canada: { keyed: [24, 28, 29, 31, 33, 91, 95, 99, 100, 101, 104, 105, 164, 207, 211, 212, 216, 217, 223, 234], blend: [], unusable: [85, 86, 87, 88] },
  USA: { keyed: [9, 74, 82, 84, 91, 94, 97, 100, 115, 125, 126, 131, 134, 136, 137, 138, 139, 140, 141, 169, 171, 189, 253, 254], blend: [172, 173, 174, 175, 180, 181, 182, 183], unusable: [172, 173, 174, 175, 180, 181, 182, 183, 74, 82, 91, 97, 136, 171] },
  Carib: { keyed: [38, 39, 40, 47, 48, 66, 69, 70, 71, 95, 96, 168, 173, 174, 187], blend: [0, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37], unusable: [0, 40, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 47, 37, 38, 39, 43, 254, 255] },
  Brazil: { keyed: [13, 85, 86, 100, 101, 102, 103, 154, 155, 156, 166, 176, 241], blend: [], unusable: [166, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 155, 156, 153] },
  Iceland: { keyed: [35, 65, 129, 130, 131, 132, 133, 134, 210], blend: [], unusable: [29, 30, 31, 35, 32, 33, 34, 45] },
  Austria: { keyed: [75, 127, 128, 152, 157], blend: [], unusable: [75, 152, 127, 128, 71, 72, 73, 74] },
  Japan: { keyed: [33, 34, 35, 119, 244], blend: [], unusable: [32, 33, 34] },
};
// The game strikes lightning in the Canada slot while the player's car is on placements 46-119 (fixed in the
// game, LEVELFORMAT.md ch. 19). Those numbers go to invisible filler objects, the track goes on at 120 (the originals
// have such gaps between track sections too: Brazil 214-217, Austria 47-49 and 78).
export const LIGHTNING_PLACEMENTS = [46, 119];
// .PLC flags3 = 10 on the sections leading to a fork (fork included), as in the originals
// (meaning assumed: announces the fork, e.g. to the AI)
const FORK_AHEAD = 10, FORK_AHEAD_SECTIONS = 6;
// Road before and after a jump gap: ramp code (behaviour 2, asphalt). All original
// jumps have 10/11 there; with normal asphalt the gap edge acts like a wall (game test).
const RAMP_SECTIONS = 2;                // sections before and after the gap
// The game's wall check only works near the placement point of the mesh the car is on (LEVELFORMAT.md ch. 20, rule
// 9): every edge between drivable and not drivable faces of a placement must lie within WALL_MAX of its point (Ring I
// with 540 drove fine, a car climbed a wall at 620; the originals keep most within 150-250). Checked per placement.
export const WALL_MAX = 540;
// The game draws a placement only while its POINT lies in a window of its 256-unit grid: a disc of about 20 cells
// (5120) across whose centre sits 8 cells (2048) ahead of the camera in the view direction - so about 4600 ahead,
// 2560 to each side and only 512 behind the camera (LEVELFORMAT.md ch. 18;
// seen in the test level OneMoreTest: placements with points 3300 to the side were not drawn although their landscape
// reached to within 2500). So a landscape triangle must be owned by a placement whose point is near the cameras it is
// seen from: within FAR_OWN of the nearest track placement it belongs to that one; farther out but still within
// DRAW_RADIUS of some track placement (the ground between two stretches of track, seen from both) it goes into scenery
// placements (type 50, no gate, not drivable) of SCENERY_CELL wide cells with their own point in the middle (small
// cells: a point more than 512 behind the camera drops the whole cell); beyond DRAW_RADIUS of every track placement
// it is backdrop that belongs to the nearest track placement (drawn with it, as the originals do: their meshes reach
// up to 6000 from the point). Limits in the game: 1500 placements of types 0-8 and 50 (its section table), 1500
// visible placements per frame.
const FAR_OWN = 800, SCENERY_CELL = 1200, DRAW_RADIUS = 3500;   // compileOptions.sceneryFar / sceneryCell override the first two (experiments)
// The game creates a pool of 1500 objects at level start and every
// placement takes one; 700 go to a particle pool, the cars, their wheels, shadows and the effects take the
// rest, so about 500 placements are left: a level with 497 ran, 582 stopped with "Maximum of objects reached!" in
// the game's log Default.fil (LEVELFORMAT.md ch. 20). Scenery cells grow until the level fits the budget.
export const PLACEMENT_BUDGET = 500;
const SCENERY_CELLS = [SCENERY_CELL, 1600, 2000, 2500, 3200, 4000, Infinity];
// Several consecutive sections of a path can share one placement (compileOptions.group = 1..MAX_GROUP, else as many
// as the budget needs, up to MAX_GROUP): a long track does not fit the budget with one section per placement. A
// group never spans a fork (its fork section is the last), a merge (the merge section is the first) or a jump gap;
// its gate is the first section's, its point the middle of its road. The wall rule (WALL_MAX) bounds the length: a
// group of 3 sections of 250 keeps the walls within about 490 of the point with the default cross section.
const MAX_GROUP = 3, SCENERY_RESERVE = 60;

// Groups of consecutive sections (in placement order, jump sections already left out) of at most `g` sections
function groupSections(order, g) {
  const groups = [];
  let cur = null;
  for (const s of order) {
    const prev = cur && cur[cur.length - 1];
    const joins = prev && cur.length < g && prev.path === s.path && s.j === prev.j + 1 && !prev.fork && !s.merge;
    if (joins) cur.push(s); else groups.push(cur = [s]);
  }
  return groups;
}
// longer edges are split (the surface stays): drivable ground (originals at most about 600), other
// terrain (originals up to 3134, Brazil)
const MAX_EDGE = { drive: 600, edge: 600, land: 2800, dead: 2800 };
const MAX_STEEP_EDGE = 400;              // steep faces (cliffs): smaller pieces keep the game's depth sort right
// kerbs and road markings as objects (compile options kerbObjects / markingObjects, an experiment, 2026-10-08): the game
// draws objects (type 200) over the ground around them (LEVELFORMAT.md ch. 18), so they may render cleaner than as
// part of the landscape. Collision then comes from the ground under them: flat faces with the kerb ground code under a
// kerb, the road under a marking (the marking quads float 3 above it, base.js). OBJ_GROUP sections share one object
// (fewer placements).
const OBJ_GROUP = 4;
// landscape within 2000 of the track: the game does not clip triangles at the camera, a large one reaching behind it
// is dropped as a whole and the screen keeps what was there (game test 2026-10-07: flicker driving over a hill)
const MAX_NEAR_EDGE = 1000;
const RANK = Object.fromEntries(DRAW_ORDER.map((m, i) => [m, i]));

// The gate of a placement: across its entry line from the outermost drivable point of its OWN mesh on the right to
// the one on the left (as the originals: a lane gate stays the lane, a branch gate at a merge runs from its outer
// edge to the lane's edge, the fork gate covers the undivided road - Brazil 82 / 48, LEVELFORMAT.md ch. 15). The
// line is sampled on the mesh's drivable faces just inside the section, near road height and without steps or steep
// drops between the samples (a drop edge painted down a cliff is not part of the gate); the gate is the run of hits
// through the road's centre, else the longest run. Where
// the entry line hits nothing (a branch's first section whose road still lies in the main lane) the line moves on
// along the section. Returns [right, left] world points, or null when the mesh has no drivable face on any line.
function gateOf(mesh, sec) {
  const drivable = mesh.faces.filter(f => f.surf < 78).map(f => [f.a, f.b, f.c].map(i => mesh.verts[i]));
  if (!drivable.length) return null;
  const reach = sec.half + Math.max(sec.f0.vl, sec.f0.vr, sec.f1.vl, sec.f1.vr) + 400, STEP = 6;
  const dir = [sec.f1.c[0] - sec.f0.c[0], sec.f1.c[2] - sec.f0.c[2]], dl = Math.hypot(...dir) || 1;
  const fwd = [dir[0] / dl, dir[1] / dl];
  const heightAt = (P, x, z) => {                      // height of the triangle's plane at (x, z)
    const [a, b, c] = P, v0 = [c[0] - a[0], c[2] - a[2]], v1 = [b[0] - a[0], b[2] - a[2]], v2 = [x - a[0], z - a[2]];
    const den = v0[0] * v1[1] - v1[0] * v0[1] || 1;
    const u = (v2[0] * v1[1] - v1[0] * v2[1]) / den, v = (v0[0] * v2[1] - v2[0] * v0[1]) / den;
    return a[1] + u * (c[1] - a[1]) + v * (b[1] - a[1]);
  };
  for (let k = 0; k <= 9; k++) {
    const t = k / 10, f = k ? lerpFrame(sec.f0, sec.f1, t) : sec.f0;
    const c = [f.c[0] + fwd[0] * 3, f.c[1], f.c[2] + fwd[1] * 3], left = f.left;
    const runs = []; let run = null;
    for (let u = -reach; u <= reach; u += STEP) {
      const x = c[0] + left[0] * u, z = c[2] + left[1] * u;
      let p = null;
      for (const P of drivable) { if (!inTri(x, z, P)) continue; const y = heightAt(P, x, z); if (Math.abs(y - c[1]) < 120) { p = [x, y, z]; break; } }
      if (!p || (run && Math.abs(p[1] - run.hi[1]) > STEP)) run = null;    // a gap, or steeper than 45 degrees
      if (!p) continue;
      if (!run) runs.push(run = { lo: p, hi: p, u0: u, u1: u });
      run.hi = p; run.u1 = u;
    }
    const best = runs.find(r => r.u0 <= 0 && r.u1 >= 0) || runs.sort((a, b) => (b.u1 - b.u0) - (a.u1 - a.u0))[0];
    if (best && best.u1 > best.u0) return [best.lo, best.hi];
  }
  return null;
}
const inTri = (x, z, [a, b, c]) => {
  const s1 = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]), s2 = (c[0] - b[0]) * (z - b[2]) - (c[2] - b[2]) * (x - b[0]), s3 = (a[0] - c[0]) * (z - c[2]) - (a[2] - c[2]) * (x - c[0]);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
};
// distance of the farthest edge between drivable and not drivable faces of a mesh from its point (x, z)
function wallDistance(mesh, at) {
  const edges = new Map();
  for (const f of mesh.faces) {
    const ix = [f.a, f.b, f.c];
    for (let j = 0; j < 3; j++) { const p = ix[j], q = ix[(j + 1) % 3], key = p < q ? p + ',' + q : q + ',' + p; (edges.get(key) || edges.set(key, new Set()).get(key)).add(f.surf < 78); }
  }
  let d = 0;
  for (const [key, s] of edges) if (s.size === 2) for (const i of key.split(',').map(Number)) d = Math.max(d, Math.hypot(mesh.verts[i][0] - at[0], mesh.verts[i][2] - at[2]));
  return d;
}

// Split every edge longer than its limit at its middle, in all triangles that share it (no cracks).
// faces: [{p: [A, B, C], mat, near, uv?, ...}]; the surface stays the same (uv are interpolated). Steep faces near the
// track: at most MAX_STEEP_EDGE. The faces of a solid object (f.solid) take the limit of drivable or other landscape.
// nearOf(x, z): when given, `near` is decided anew for every piece in every pass (a large face reaching from far off
// to the track has its centroid far away, its pieces near the track must still get the near limits).
const maxEdgeOf = f => MAX_EDGE[f.mat] ?? (f.solid ? (f.surf < 78 ? MAX_EDGE.drive : MAX_EDGE.land) : 0);
function refine(faces, nearOf = null) {
  const key = p => Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]);
  let out = faces;
  for (let pass = 0; pass < 6; pass++) {
    const split = new Map();
    if (nearOf) for (const f of out) f.near = nearOf((f.p[0][0] + f.p[1][0] + f.p[2][0]) / 3, (f.p[0][2] + f.p[1][2] + f.p[2][2]) / 3);
    for (const f of out) {
      const max = maxEdgeOf(f);
      if (!max) continue;
      const limit = f.near ? Math.min(steep(f.p) ? MAX_STEEP_EDGE : MAX_NEAR_EDGE, max) : max;
      for (let j = 0; j < 3; j++) {
        const a = f.p[j], b = f.p[(j + 1) % 3];
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= limit) continue;
        const ka = key(a), kb = key(b), k = ka < kb ? ka + ' ' + kb : kb + ' ' + ka;
        if (!split.has(k)) split.set(k, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2].map(Math.round));
      }
    }
    if (!split.size) return { faces: out, splits: pass };
    const next = [];
    for (const f of out) {
      const P = f.p, ks = P.map(key);
      const mid = j => { const a = ks[j], b = ks[(j + 1) % 3]; return split.get(a < b ? a + ' ' + b : b + ' ' + a); };
      const m = [mid(0), mid(1), mid(2)], n = m.filter(Boolean).length;
      if (!n) { next.push(f); continue; }
      // corners 0-2, the middles of edges j (P[j] to P[j+1]) 3-5; uv of a middle: the mean of its edge's ends
      const U = f.uv, at = i => (i < 3 ? P[i] : m[i - 3]);
      const uvAt = i => (i < 3 ? U[i] : [(U[i - 3][0] + U[(i - 2) % 3][0]) / 2, (U[i - 3][1] + U[(i - 2) % 3][1]) / 2]);
      const add = (a, b, c) => next.push({ ...f, p: [at(a), at(b), at(c)], ...(U ? { uv: [uvAt(a), uvAt(b), uvAt(c)] } : {}) });
      if (n === 3) { add(0, 3, 5); add(3, 1, 4); add(5, 4, 2); add(3, 4, 5); continue; }
      if (n === 1) {
        const j = m.findIndex(Boolean);
        add(j, 3 + j, (j + 2) % 3); add(3 + j, (j + 1) % 3, (j + 2) % 3); continue;
      }
      // two edges split, edge j (from P[j] to P[j+1]) whole: Z = P[j], X = P[j+1]; the split edges are X-Y and Y-Z
      const j = m.findIndex(x => !x), Z = j, X = (j + 1) % 3, Y = (j + 2) % 3, Mxy = 3 + X, Myz = 3 + Y;
      add(Mxy, Y, Myz); add(X, Mxy, Myz); add(X, Myz, Z);
    }
    out = next;
  }
  return { faces: out, splits: 6 };
}

// Ids "path:j" of the sections RAMP_SECTIONS before and after each jump gap.
function rampSectionIds(paths) {
  const ids = new Set();
  const count = p => (p.closed ? p.frames.length : p.frames.length - 1);
  const isJump = (p, j) => p.jump[p.frames[j].seg];
  // k sections from j in direction dir along path p (closed: wraps), crossing into the
  // main loop at the ends of a branch
  const walk = (p, j, dir) => {
    for (let k = 1; k <= RAMP_SECTIONS; k++) {
      let q = p, i = j + dir * k;
      const n = count(p);
      if (p.closed) i = ((i % n) + n) % n;
      else if (i < 0 || i >= n) {                      // off a branch: continue on the main loop
        q = paths.main;
        const node = i < 0 ? p.from : p.to, mi = paths.main.ids.indexOf(node);
        const first = paths.main.frames.findIndex(f => f.seg === mi && f.t === 0);
        if (first < 0) return;
        const m = count(q);
        i = i < 0 ? ((first + i + 1 - 1 + m) % m) : (first + (i - n)) % m;
      }
      if (isJump(q, i)) return;
      ids.add(`${q.key}:${i}`);
    }
  };
  for (const p of paths.all) {
    const n = count(p);
    for (let j = 0; j < n; j++) {
      if (!isJump(p, j)) continue;
      const prev = p.closed ? (j - 1 + n) % n : j - 1, next = p.closed ? (j + 1) % n : j + 1;
      if (prev < 0 || !isJump(p, prev)) walk(p, j, -1);   // take-off side
      if (next >= n || !isJump(p, next)) walk(p, j, 1);   // landing side
    }
  }
  return ids;
}

// Sections of a path, in driving order: [{path, j, seg, f0, f1, jump, nextToGap}]
// nextToGap: the neighbouring section in the same path is part of a jump.
function pathSections(path) {
  const fr = path.frames, n = path.closed ? fr.length : fr.length - 1;
  const out = [];
  for (let j = 0; j < n; j++) {
    const f0 = fr[j], f1 = fr[(j + 1) % fr.length];
    out.push({ path: path.key, j, seg: f0.seg, f0, f1, jump: path.jump[f0.seg] });
  }
  out.forEach((s, j) => {
    const prev = path.closed ? out[(j - 1 + n) % n] : out[j - 1];
    const next = path.closed ? out[(j + 1) % n] : out[j + 1];
    s.nextToGap = !s.jump && ((prev && prev.jump) || (next && next.jump));
  });
  return out;
}

// Sections in placement order: the main loop from the start; after the section
// ending at a fork node the branch, then the main loop on to the merge.
// Like the originals: fork (3), one parallel path, the other one, merge (6) with
// the highest number. Which path comes first is free; it is chosen so that a
// jump at the fork or merge gets consecutive numbers for take-off and landing
// (type 7 pair): a path ending with a jump at the merge is numbered second
// ("late"), a path starting with a jump at the fork first.
function orderSections(paths, errors = []) {
  const main = pathSections(paths.main);
  const ids = paths.main.ids, n = ids.length;
  const byFork = new Map(), late = new Map();       // fork node -> branch; branch key -> numbered after the main part
  for (const b of paths.branches) {
    byFork.set(b.from, b);
    const iF = ids.indexOf(b.from), iT = ids.indexOf(b.to);
    const branchFirst = b.jump[0], branchLast = b.jump[b.segs - 1];
    const mainFirst = paths.main.jump[iF], mainLast = paths.main.jump[(iT - 1 + n) % n];
    const wantLate = branchLast || mainFirst, wantEarly = branchFirst || mainLast;
    if (wantLate && wantEarly) {
      errors.push({ text: `Branch ${b.key}: jumps at both its fork and its merge cannot all get consecutive numbers; move one jump a segment away`,
                    at: b.frames[0].c });
    }
    late.set(b.key, wantLate && !wantEarly);
  }
  const mergeAt = new Map(paths.branches.map(b => [b.to, b]));
  // the merge section (type 6): the main section starting at the merge node (as the originals: an ordinary section of
  // the through lane, Brazil 48)
  const mergeHere = new Map();                       // index in main -> branch
  main.forEach((s, k) => { if ((k === 0 || main[k - 1].seg !== s.seg) && mergeAt.has(ids[s.seg])) mergeHere.set(k, mergeAt.get(ids[s.seg])); });
  const order = [];
  let parallel = false;                              // main loop between a fork and its merge
  main.forEach((s, k) => {
    if (mergeHere.has(k)) {
      s.merge = true;
      parallel = false;
      const b = mergeHere.get(k);
      if (late.get(b.key)) order.push(...pathSections(b));   // late branch right before its merge
    }
    if (parallel) s.parallel = true;
    order.push(s);
    const endNode = ids[(s.seg + 1) % n];
    const segEnd = k === main.length - 1 || main[k + 1].seg !== s.seg;
    if (segEnd && byFork.has(endNode)) {
      s.fork = true;
      parallel = true;
      const b = byFork.get(endNode);
      if (!late.get(b.key)) order.push(...pathSections(b));
    }
  });
  return order;
}

// opts.quick: the preview while dragging - the base without kerbs and markings, no compiler fixes, light, palette or
// meshes; returns only what the editor draws (report, paths, base, terrainInfo, sections)
export function compileLevel(level, opts = {}) {
  const track = level.track;
  // test switches for the compiler fixes (level.compileOptions, not in the UI): shade, steepDouble, steepSplit
  const opt = { light: true, steepDouble: true, steepSplit: true, avoidLightning: false, ...(level.compileOptions || {}) };
  const report = { errors: [], warnings: [], stats: {} };
  report.errors.push(...structureChecks(track));
  let paths = null;
  try { paths = buildPaths(track); }
  catch (e) { report.errors.push('Track cannot be built: ' + e.message); return { report, paths: null }; }
  const crossing = crossingChecks(paths, track);
  report.errors.push(...crossing.errors);
  report.warnings.push(...crossing.warnings);

  const an = analyseSections(paths), base = buildBase(level, paths, an, { quick: opts.quick, markingObjects: opt.markingObjects });
  report.warnings.push(...base.warnings);
  const placed = an.secs.filter(s => !s.jump);                          // the sections with road (jump gaps have none)
  // the placements: groups of consecutive sections, as many per placement as the budget needs (or compileOptions.group)
  const order0 = orderSections(paths, report.errors).filter(s => !s.jump);
  let group = Math.min(MAX_GROUP, Math.max(1, opt.group || 1));
  if (!opt.group) {
    const fixed = (level.objects?.length || 0), decorOf = n => (opt.kerbObjects || opt.markingObjects ? Math.ceil(n / OBJ_GROUP) : 0);
    while (group < MAX_GROUP && groupSections(order0, group).length + fixed + decorOf(groupSections(order0, group).length) > PLACEMENT_BUDGET - SCENERY_RESERVE) group++;
  }
  const groups = groupSections(order0, group);
  if (group > 1) report.warnings.push(`${group} sections per placement (${groups.length} placements for ${order0.length} sections) so that the level fits the game's ${PLACEMENT_BUDGET} placements`);
  // a cross section too wide for one mesh: its walls would lie beyond WALL_MAX of the placement point
  { const wide = placed.find(s => Math.hypot(s.half + Math.max(s.f0.vl, s.f0.vr), Math.hypot(s.c1[0] - s.c0[0], s.c1[1] - s.c0[1]) / 2) > WALL_MAX);
    if (wide) report.warnings.push({ text: `Road too wide for one mesh at ${wide.id} (road + verge reach beyond ${WALL_MAX} of the placement point; the game's wall check fails there)`, at: [wide.anchor[0], wide.y, wide.anchor[1]] }); }

  // ---- the faces: base, then the stored terrain
  // sec: the placement (section) a face goes to; own: the section it lies in (its flags give the road code)
  const faces = base.tris.map(t => ({ p: t.p, mat: t.mat, zone: t.zone, sec: t.sec, own: t.sec, facing: t.facing || null, base: t }));
  // The joined surface of a fork or merge (junction zones, base.js) as the originals cut it (Brazil 82 / 48,
  // LEVELFORMAT.md ch. 15): the main road runs through unchanged - a triangle inside the main road's lane belongs to
  // the main section there; the wedge beyond the lane up to the branch belongs to the branch (its placements take
  // their road, the wedge and their verge), the main road's verge on the far side stays with the main road.
  { const mainSecs = placed.filter(s => s.path.key === 'main'), branchSecs = placed.filter(s => s.path.key !== 'main');
    const mh = new Hash(1000), bh = new Hash(1000);
    for (const s of mainSecs) mh.add(s, ...quadBox(s.quad));
    for (const s of branchSecs) bh.add(s, ...quadBox(s.quad));
    for (const f of faces) {
      if (f.base.strip !== 'zone') continue;
      const c = [(f.p[0][0] + f.p[1][0] + f.p[2][0]) / 3, (f.p[0][2] + f.p[1][2] + f.p[2][2]) / 3], y = (f.p[0][1] + f.p[1][1] + f.p[2][1]) / 3;
      const lane = [...mh.near(c[0], c[1], 1)].find(s => Math.abs(s.y - y) < 150 && inQuad(c, s.quad));
      if (lane) { f.sec = lane.id; continue; }
      const own = an.byId.get(f.own);
      if (!own) continue;
      // the nearest main section beside the triangle and the nearest branch section whose stretch it lies beside
      // (not behind its end at the node)
      let m = null, dm = Infinity, b = null, db = Infinity;
      for (const s of mh.near(c[0], c[1], 1000)) { if (Math.abs(s.y - y) >= 150) continue; const d = segDist(c, s.c0, s.c1)[0] - s.half; if (d < dm) { dm = d; m = s; } }
      for (const s of bh.near(c[0], c[1], 1000)) { if (Math.abs(s.y - y) >= 150) continue; const [d, t] = segDist(c, s.c0, s.c1); if (t <= 0 || t >= 1) continue; if (d - s.half < db) { db = d - s.half; b = s; } }
      if (!m || !b) continue;
      const mverge = Math.max(m.f0.vl, m.f0.vr);
      const sideOf = q => Math.sign((m.c1[0] - m.c0[0]) * (q[1] - m.c0[1]) - (m.c1[1] - m.c0[1]) * (q[0] - m.c0[0]));
      const between = sideOf(c) === sideOf(b.anchor);                   // on the branch's side of the main road
      if (!between) { if (dm <= mverge) f.sec = m.id; }                   // the main road's verge on the far side is the main road's
      else if (own.path.key === 'main' && db <= dm + mverge) f.sec = b.id;   // the wedge up to the lane's edge is the branch's
    } }
  let terrainInfo = null;
  const floating = [];
  const hash = new Hash(1000);
  for (const s of placed) hash.add(s, ...quadBox(s.quad));
  // landscape (and the faces of solid objects) belongs to the placement whose point is nearest (the game draws a
  // placement only near its point, see FAR_OWN); beyond FAR_OWN of every point the not drivable landscape goes to
  // scenery placements by cell
  let sceneryCell = opt.sceneryCell ?? SCENERY_CELL;
  const sectionAt = (x, z, drivable) => {
    let best = null, bd = Infinity;
    for (let r = 1000; r <= 128000 && !best; r *= 2) {
      bd = Infinity;
      for (const s of hash.near(x, z, r)) {
        const dd = Math.hypot(s.anchor[0] - x, s.anchor[1] - z);
        if (dd < bd) { bd = dd; best = s; }
      }
      if (best && bd > r) best = null;                                  // nearer ones may hide in the next ring
    }
    if (!best) return placed[0]?.id ?? null;
    const far = opt.sceneryFar ?? FAR_OWN;
    if (bd > far && bd <= DRAW_RADIUS && !drivable && sceneryCell < Infinity) return `scenery:${Math.floor(x / sceneryCell)},${Math.floor(z / sceneryCell)}`;
    return best.id;
  };
  // near the track (where the camera comes close) steep faces are cut into smaller pieces
  const nearTrack = (x, z) => [...hash.near(x, z, 2000)].some(s => segDist([x, z], s.c0, s.c1)[0] < 2000);
  if (level.terrain && level.terrain.tris.length) {
    const ctx = dockContext(base), pos = resolve(level.terrain, ctx);
    const comps = components(level.terrain, pos, base.tris);
    const land = [];
    for (const c of comps) {
      const list = c.tris.filter(id => level.terrain.tris[id].slice(0, 3).every(i => pos[i]));
      if (c.docked) land.push(...list); else floating.push(list);
    }
    const tf = land.map(id => {
      const [a, b, c, mat] = level.terrain.tris[id], P = [pos[a], pos[b], pos[c]];
      return { p: P, mat, zone: mat, sec: null, terrain: id, near: nearTrack((P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3) };
    });
    if (opts.quick) {
      terrainInfo = { pos, holes: [], comps, ctx };
      return { report, paths, base, terrain: level.terrain, terrainInfo, sections: an.secs, entries: [], items: [], palette: null, quick: true };
    }
    if (!opt.steepSplit) for (const f of tf) f.near = false;
    const refined = refine(tf);
    for (const f of refined.faces) { f.landOwner = true; faces.push(f); }   // their placement: below, with the solid objects
    if (refined.splits) report.warnings.push('Long terrain edges were split by the compiler (the surface stays)');
    // the upright gaps at the corners of an underpass's mouths (bridges.js)
    for (const t of closeMouths(base.tris, level.terrain, pos)) { base.tris.push(t); faces.push({ p: t.p, mat: t.mat, zone: t.zone, sec: t.sec, own: t.sec, facing: t.facing, base: t }); }
    // the holes under the ends of a free-standing deck: closed by an abutment (bridges.js)
    if (base.deckEnds?.length) {
      const meshTris = [...base.tris.filter(t => !t.covered && !t.deck && !t.floating && !t.cap).map(t => t.p),
                        ...level.terrain.tris.map(t => t.slice(0, 3).map(i => pos[i])).filter(P => P.every(Boolean))];
      // upright and near the track: cut like the steep landscape beside it (MAX_STEEP_EDGE, the same middles)
      const abut = refine(closeDeckEnds(openEdges(level.terrain, pos, base.tris), base.deckEnds, meshTris).map(t => ({ ...t, mat: 'land', near: true })))
        .faces.map(({ near, ...t }, q) => ({ ...t, mat: 'deck', q }));
      for (const t of abut) { base.tris.push(t); faces.push({ p: t.p, mat: t.mat, zone: t.zone, sec: t.sec, own: t.sec, facing: t.facing, base: t }); }
    }
    const holes = openEdges(level.terrain, pos, base.tris);
    if (holes.length) report.warnings.push({ text: holes.length + ' open edge(s) in the terrain (holes), shown in red in mode 2', at: holes[0][0] });
    terrainInfo = { pos, holes, comps, ctx };
  } else if (opts.quick) return { report, paths, base, terrain: null, terrainInfo: null, sections: an.secs, entries: [], items: [], palette: null, quick: true };

  // ---- kerbs / markings as objects: taken out of the sections, the ground under them stays (see the top). The
  // marking quads of the base (base.js, markingObjects) float above the plain road already.
  const objOpt = { kerbs: !!opt.kerbObjects }, objectFaces = [];
  {
    const kerbH = base.kerb.height, ground = [];
    for (const f of faces) {
      if (!f.base) continue;
      const kerb = !!(f.zone && f.zone.startsWith('kerb')), marking = !!f.base.marking;
      if (!((kerb && objOpt.kerbs) || marking)) continue;
      f.object = true; objectFaces.push(f);
      if (marking) continue;
      if (!f.base.cap) {
        // the kerb's footprint on the ground: its raised corners lowered (zone triangles know their raise, strips: k1/k2)
        const raise = k => (f.base.raise ? f.base.raise[k] : f.base.n && (f.base.n[k] === 'k1' || f.base.n[k] === 'k2') ? kerbH : 0);
        ground.push({ ...f, object: false, mat: 'kerbGround', zone: 'drive', facing: null, p: f.p.map((p, k) => [p[0], p[1] - raise(k), p[2]]) });
      }
    }
    faces.push(...ground);
  }

  // ---- baked light over everything that is drawn (neighbours across sections smooth into each other)
  const floatFaces = floating.map(list => list.map(id => {
    const [a, b, c, mat] = level.terrain.tris[id];
    return { p: [terrainInfo.pos[a], terrainInfo.pos[b], terrainInfo.pos[c]], mat, zone: mat, terrain: id };
  }));
  // ---- placed objects (Assets tab, level.objects): the asset's geometry (level.assets, from an original level or
  // an own one) at every placement, rotation and scale baked into the vertices (core/objects.js). Faces under the
  // ground are dropped (nobody sees them). An object with `collide` is part of the landscape: its faces go into the
  // nearest section's mesh with the surface code its body asks for (wall 80 unless set), so the car collides with it
  // and it is in .SRF; the others are type 200 objects (code 300, drawn over the ground, no collision).
  const objFaces = [], objectList = [], texturedFaces = [], textures = opts.textures || new Map(), missingTex = new Set();
  // Animated textures: a PNG named "<name>_anim" of n x 64 by 64 pixels is a strip of n frames of one 64 x 64 tile.
  // A face showing it is cut as if the image were a single tile (every 64-texel cell shows frame 0), and the compiler
  // writes an animation table (type 250, LEVELFORMAT.md ch. 15) whose faces list the frames: the game copies them into
  // the tile of frame 0 one after another (about 13 per second), so every face with that tile blinks.
  const animOf = name => { const t = textures.get(name); return t && /_anim$/i.test(name) && t.h <= 64 && t.tw >= 2 ? t.tw : 0; };
  const tilesOf = (face, name, tex) => (animOf(name) ? splitByTiles(face, 1, 1) : splitByTiles(face, tex.tw, tex.th));
  const groundHash = new Hash(500);
  for (const f of faces) { const xs = f.p.map(p => p[0]), zs = f.p.map(p => p[2]); groundHash.add(f, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)); }
  const groundLayers = (x, z) => {                   // the heights of the ground surfaces at (x, z)
    const ys = [];
    for (const f of groundHash.near(x, z, 1)) {
      if (!inTri(x, z, f.p)) continue;
      const [a, b, c] = f.p, d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      if (!d) continue;
      const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / d, v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / d;
      ys.push(a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]));
    }
    return ys;
  };
  const groundAt = (x, z) => { const ys = groundLayers(x, z); return ys.length ? Math.max(...ys) : null; };
  let collided = 0, hidden = 0;
  // an animated object (anim.js) is placed at its pose at t = 0 and gets its path; one that is part of the landscape
  // cannot move (its faces sit in the section meshes): the animation is ignored with a warning
  let animated = 0;
  const objectsToPlace = (level.objects || []).map(o => {
    const ae = o.id ? animEntryOf(level, o.id) : null, p = ae && poseAt(ae.entry, 0);
    if (!p) return o;
    if (o.collide) { report.warnings.push({ text: `Object ${o.id} is part of the landscape and in animation "${ae.anim.name}": it cannot move, the animation is ignored for it`, at: [o.x, o.y, o.z] }); return o; }
    if (o.collide && o.hit) report.warnings.push({ text: `Object ${o.id} is part of the landscape: "Hits the car" is ignored for it`, at: [o.x, o.y, o.z] });
    return { ...o, x: p.pos[0], y: p.pos[1], z: p.pos[2], rot: p.rot, anim: ae };
  });
  for (const { o, asset, faces: of } of placedFaces({ ...level, objects: objectsToPlace }, ref => level.assets?.[ref])) {
    if (!asset) { report.warnings.push({ text: `Object ${o.asset} has no geometry in the level (assets); not written`, at: [o.x, o.y, o.z] }); continue; }
    const list = [];
    // an object under a bridge or in a tunnel (ground both below and above its point) keeps every face
    const layers = groundLayers(o.x, o.z), buried = layers.some(y => y > o.y + 2) && layers.some(y => y <= o.y + 2);
    for (const f of of) {
      if (!buried && f.p.every(p => { const g = groundAt(p[0], p[2]); return g !== null && p[1] < g - 1; })) { hidden++; continue; }
      const base = { p: f.p, mat: 'object', colour: f.colour, flags: f.flags || FACE_FLAGS, tile: f.tile, uv: f.uv, surf: f.surf, keep: true };
      // a face with one of the user's textures ("png:<name>", texels of the whole image): cut along the tile lattice
      // into pieces that each lie in one 64 x 64 tile "png/<name>/<i>/<j>" (core/texmap.js)
      if (f.tile && f.tile.startsWith('png:') && f.uv) {
        const name = f.tile.slice(4), tex = textures.get(name);
        if (!tex) { missingTex.add(name); list.push({ ...base, tile: null, uv: null }); continue; }
        for (const c of tilesOf(base, name, tex)) list.push({ ...c, tile: `png/${name}/${c.tileIJ[0]}/${c.tileIJ[1]}` });
        continue;
      }
      list.push(base);
    }
    texturedFaces.push(...list);
    if (o.collide) {
      // a solid object is landscape to the game: its faces get the landscape's fixes (long edges split, steep faces
      // double-sided in addFaces) and its placements (nearest point, scenery cells far off) - with its faces spread over
      // far placements and edges up to 2500, a large hall in RPR2 flickered (2026-10-11)
      collided++;
      const solid = list.map(f => ({ ...f, surf: f.surf ?? MATERIALS.land.code, own: null, solid: true }));
      for (const f of refine(solid, opt.steepSplit ? nearTrack : () => false).faces) { f.landOwner = true; faces.push(f); }
    } else { objFaces.push(...list); objectList.push({ o, asset, list }); }
  }
  // the placements of the landscape and the solid objects' faces: scenery cells as small as the placement budget
  // allows (the track placements and objects come first)
  { const own = faces.filter(f => f.landOwner);
    const cells = opt.sceneryCell ? [opt.sceneryCell] : SCENERY_CELLS.filter(c => c >= SCENERY_CELL);
    const decor = opt.kerbObjects || opt.markingObjects ? Math.ceil(groups.length / OBJ_GROUP) : 0;   // kerb / marking objects (below)
    const others = groups.length + objectList.length + decor;
    for (const c of cells) {
      sceneryCell = c;
      const keys = new Set();
      for (const f of own) {
        f.sec = sectionAt((f.p[0][0] + f.p[1][0] + f.p[2][0]) / 3, (f.p[0][2] + f.p[1][2] + f.p[2][2]) / 3, (f.solid ? f.surf : MATERIALS[f.mat].code) < 78);
        if (f.sec?.startsWith('scenery:')) keys.add(f.sec);
      }
      if (others + keys.size <= PLACEMENT_BUDGET || c === cells[cells.length - 1]) break;
    }
    if (own.length && sceneryCell !== SCENERY_CELL) report.warnings.push(`Scenery cells of ${sceneryCell === Infinity ? 'no' : sceneryCell} size so that the level fits the game's ${PLACEMENT_BUDGET} placements (${placed.length} track sections); far landscape may vanish beside the track`); }
  // ---- faces painted with one of the user's textures (the Paint tab, paint.js): texel coordinates from the face's
  // position (mapping and size of the paint), then cut along the image's tile lattice into pieces in one tile each,
  // like the textured faces of objects; without the image (the editor's own compile) the face keeps its flat colour
  const paintOf = f => (f.base ? baseColour(level, f.base, an) : f.terrain !== undefined ? level.terrain.tris[f.terrain]?.[4] : f.colour || null);
  const texturise = list => list.flatMap(f => {
    const p = parsePaint(paintOf(f));
    if (!p?.tex) return [f];
    const tex = textures.get(p.tex);
    if (!tex) { missingTex.add(p.tex); return [f]; }
    const uv = paintUV(f.p, p, tex, f.base ? roadFrame(an, f.base.sec) : null);
    const pieces = tilesOf({ ...f, uv }, p.tex, tex).map(c => ({ ...c, tile: `png/${p.tex}/${c.tileIJ[0]}/${c.tileIJ[1]}` }));
    texturedFaces.push(...pieces);
    return pieces.length ? pieces : [f];
  });
  faces.splice(0, faces.length, ...texturise(faces));
  floatFaces.forEach((list, i) => { floatFaces[i] = texturise(list); });
  if (opts.tiles) for (const name of missingTex) report.warnings.push(`Texture ${name}.png not found in data/textures: those faces get their flat colour`);   // the editor's own compile has no textures
  // colour of every face: painted (paint.js) or its material's, times its light (flat: the facets show), then all
  // colours into the palette (at most 156); a textured face's colour is its image's mean (shown where the tile did
  // not fit the atlas)
  const all = [...faces, ...floatFaces.flat(), ...objFaces];
  {
    const roadPts = base.tris.filter(t => t.zone === 'road').flatMap(t => t.p);
    const light = lightFaces(all, roadPts, { smooth: false });
    all.forEach((f, i) => {
      const p = parsePaint(paintOf(f)), painted = p?.tex ? textures.get(p.tex)?.mean || null : p?.colour || null;
      f.rgb = faceColour(rgb(painted || materialColour(f.mat, level)), opt.light ? light[i] : [0.954, 0.954, 0.954], f.p);
    });
  }
  const areaOf = f => { const u = [0, 1, 2].map(k => f.p[1][k] - f.p[0][k]), v = [0, 1, 2].map(k => f.p[2][k] - f.p[0][k]); return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2 + 1; };

  // ---- the texture atlas of the objects: textures 1..15 hold 64 x 64 tiles of the originals (opts.tiles: key ->
  // rgba, read by the server from the game directory); at most TILE_BUDGET of them, the busiest and most varied
  // first; a face whose tile is not there shows its flat colour (the plainest tiles lose least). The tiles' colours
  // take part in the palette, their texels are re-indexed to it.
  // Transparency in the 3dfx game (LEVELFORMAT.md ch. 16): palette index 0 is
  // see-through on a face only when the game draws it colour-keyed, and that draw mode is chosen at load time per
  // TILE NUMBER, fixed per level slot (SLOT_TILES.keyed) - the file's flag 0x12 is overwritten.
  // Flag 0x13 / 0x17 (colour key + 50 % blend) is honoured from the file on any tile. So a "cut" tile (holes only:
  // alpha 0 or 255, soft edges allowed) goes to one of the slot's keyed numbers; a "blend" tile (more than a quarter
  // of its visible texels with 0 < alpha < 255) gets 0x13 / 0x17 on any number; cut tiles beyond the keyed numbers
  // fall back to blend with a warning. Texels: cut tiles alpha below 255 -> index 0 (no fringe), blend tiles alpha
  // below 128 -> index 0.
  const tileSrc = opts.tiles || new Map(), tileUse = new Map();
  const tileClassCache = new Map();
  const tileClass = key => {                                                 // 'solid' | 'cut' | 'blend'
    if (!tileClassCache.has(key)) {
      const rgba = tileSrc.get(key); let holes = 0, partial = 0, visible = 0;
      if (rgba) for (let i = 0; i < 4096; i++) { const a = rgba[i * 4 + 3]; if (a === 0) holes++; else { visible++; if (a < 255) partial++; } }
      tileClassCache.set(key, !rgba ? 'solid' : visible && partial > visible / 4 ? 'blend' : holes || partial ? 'cut' : 'solid');
    }
    return tileClassCache.get(key);
  };
  const opaque = (rgba, i, cls) => rgba[i * 4 + 3] >= (cls === 'blend' ? 128 : 255);
  const slotName = SLOT_TILES[opts.slot] ? opts.slot : 'Canada', slotTiles = SLOT_TILES[slotName];
  const unusable = new Set(slotTiles.unusable), blendSet = new Set(slotTiles.blend);
  const keyedNumbers = slotTiles.keyed.filter(n => n >= 16 && !unusable.has(n)), keyedSet = new Set(keyedNumbers);
  const plainNumbers = []; for (let n = 16; n < 256; n++) if (!unusable.has(n) && !keyedSet.has(n) && !blendSet.has(n)) plainNumbers.push(n);
  const TILE_BUDGET = keyedNumbers.length + plainNumbers.length;
  for (const f of texturedFaces) if (f.tile && f.uv && tileSrc.has(f.tile)) tileUse.set(f.tile, (tileUse.get(f.tile) || 0) + areaOf(f));
  // the frames of the animated textures in use go into the atlas too (as busy as their frame 0), and first: the
  // game animates texture frames only within the first 400 000 texels of texture memory, so the frames sit in the
  // lowest textures
  const animTables = new Map();
  for (const key of [...tileUse.keys()]) {
    const m = key.match(/^png\/([^/]+)\/0\/0$/), n = m ? animOf(m[1]) : 0;
    if (!n) continue;
    animTables.set(m[1], n);
    for (let k = 1; k < n; k++) if (tileSrc.has(`png/${m[1]}/${k}/0`)) tileUse.set(`png/${m[1]}/${k}/0`, tileUse.get(key));
  }
  const animRank = k => { const m = k.match(/^png\/([^/]+)\/(\d+)\/0$/); return m && animTables.has(m[1]) ? [...animTables.keys()].indexOf(m[1]) * 1000 + Number(m[2]) : Infinity; };
  const tileStats = key => {
    const rgba = tileSrc.get(key), colours = new Map(), mean = [0, 0, 0], cls = tileClass(key);
    let n = 0;
    for (let i = 0; i < 4096; i++) {
      if (!opaque(rgba, i, cls)) continue;
      const k = rgba[i * 4] + ',' + rgba[i * 4 + 1] + ',' + rgba[i * 4 + 2];
      colours.set(k, (colours.get(k) || 0) + 1);
      for (let c = 0; c < 3; c++) mean[c] += rgba[i * 4 + c];
      n++;
    }
    let variance = 0;
    if (n) { for (let c = 0; c < 3; c++) mean[c] /= n; for (let i = 0; i < 4096; i++) if (opaque(rgba, i, cls)) for (let c = 0; c < 3; c++) variance += (rgba[i * 4 + c] - mean[c]) ** 2; variance /= n * 3; }
    return { colours, variance };
  };
  const tileInfo = new Map([...tileUse.keys()].map(k => [k, tileStats(k)]));
  let atlasKeys = [...tileUse.keys()].sort((a, b) => animRank(a) - animRank(b));
  if (atlasKeys.length > TILE_BUDGET) {
    atlasKeys.sort((a, b) => tileInfo.get(b).variance * tileUse.get(b) - tileInfo.get(a).variance * tileUse.get(a)).sort((a, b) => animRank(a) - animRank(b));
    report.warnings.push(`${atlasKeys.length} texture tiles used by the objects, ${TILE_BUDGET} fit: the ${atlasKeys.length - TILE_BUDGET} plainest get flat colours`);
    atlasKeys = atlasKeys.slice(0, TILE_BUDGET);
  }
  // tile numbers: cut tiles take the slot's keyed numbers (cut animation frames first, then by use), the rest the
  // plain numbers in atlas order (animation frames first, so they sit in the lowest textures)
  const tileNumber = new Map(), tileMode = new Map();
  { const cut = atlasKeys.filter(k => tileClass(k) === 'cut'), rest = atlasKeys.filter(k => tileClass(k) !== 'cut');
    const freeKeyed = keyedNumbers.slice(), freePlain = plainNumbers.slice();
    let fallback = 0;
    for (const k of cut) {
      if (freeKeyed.length) { tileNumber.set(k, freeKeyed.shift()); tileMode.set(k, 'key'); }
      else if (freePlain.length) { tileNumber.set(k, freePlain.shift()); tileMode.set(k, 'blend'); fallback++; }
    }
    for (const k of rest) { if (!freePlain.length) break; tileNumber.set(k, freePlain.shift()); if (tileClass(k) === 'blend') tileMode.set(k, 'blend'); }
    if (fallback) report.warnings.push(`${cut.length} see-through texture tiles, the ${slotName} slot has ${keyedNumbers.length} tile numbers the game keys: ${fallback} are drawn half transparent instead (flag 0x13)`);
    atlasKeys = atlasKeys.filter(k => tileNumber.has(k)); }
  const atlasSlot = new Map(atlasKeys.map((k, i) => [k, i]));
  const tileColours = [], tileWeights = [];
  for (const k of atlasKeys) for (const [c, n] of tileInfo.get(k).colours) { tileColours.push(c.split(',').map(Number)); tileWeights.push(tileUse.get(k) * n / 4096); }
  const pal = buildPalette([...all.map(f => f.rgb), ...tileColours], [...all.map(areaOf), ...tileWeights]);
  const atlas = atlasKeys.map(key => {
    const rgba = tileSrc.get(key), indices = new Uint8Array(4096), cache = new Map(), cls = tileClass(key), n = tileNumber.get(key);
    for (let i = 0; i < 4096; i++) {
      if (!opaque(rgba, i, cls)) continue;                                 // transparent texel: palette index 0
      const c = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]], k = c.join(',');
      if (!cache.has(k)) cache.set(k, PAL_FROM + pal.index(c));
      indices[i] = cache.get(k);
    }
    return { key, number: n, tex: n >> 4, tile: n & 15, mode: tileMode.get(key) || null, indices };
  });

  // ---- one mesh per section
  const ramps = rampSectionIds(paths);
  const bySection = new Map();
  for (const f of faces) {
    if (!f.sec || f.object) continue;
    if (!bySection.has(f.sec)) bySection.set(f.sec, []);
    bySection.get(f.sec).push(f);
  }
  // surface code of road-like faces from the flags of their section; ramp: before and after jumps, or marked
  const roadCode = sec => (!sec ? 0 : inRange(track.order, sec) ? 20 : inRange(track.ramp, sec) || ramps.has(sec.id) ? 10 : inRange(track.slippery, sec) ? 5 : 0);
  const flat = ([a, b, c]) => { const u = [0, 1, 2].map(k => b[k] - a[k]), v = [0, 1, 2].map(k => c[k] - a[k]);
    return !(u[1] * v[2] - u[2] * v[1]) && !(u[2] * v[0] - u[0] * v[2]) && !(u[0] * v[1] - u[1] * v[0]); };
  // A free-standing bridge deck (bridges.js) is drivable with the ramp behaviour all over: its underside and fascia,
  // and the landscape that hangs from the road's cross line where the deck ends (the cliff under the road's end:
  // a landscape-coded face with its top edge on the road stopped the car like a wall, game test 2026-10-08).
  const onEnd = p => (base.deckEnds || []).some(({ a, b }) => {
    const ab = [0, 1, 2].map(k => b[k] - a[k]), ap = [0, 1, 2].map(k => p[k] - a[k]), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const u = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (l2 || 1)));
    return Math.hypot(ap[0] - ab[0] * u, ap[1] - ab[1] * u, ap[2] - ab[2] * u) < 2;
  });
  const deckCode = f => (f.base ? (f.base.floating && f.base.deck) || f.base.abutment : f.p.filter(onEnd).length >= 2) ? 10 : null;
  // what a face shows: its tile in the atlas (textured object faces) or the palette cell of its colour.
  // The game filters textures bilinearly (minification and magnification, with wrap), so texels at a tile's edge mix
  // with the neighbouring tile of the atlas; with a colour key that mix is never
  // the key colour and shows as a dark line along the tile lattice (seen on RPR2's transparent road in the game). The pieces of
  // the user's textures (uv 0..64 in their tile) are therefore pulled in to TILE_INSET..64-TILE_INSET, as the originals
  // keep about 2 texels off the edge (their objects' uv come as they are).
  const TILE_INSET = 1, inset = t => TILE_INSET + t * (64 - 2 * TILE_INSET) / 64;
  const faceLook = f => {
    const slot = pal.index(f.rgb), s = f.tile && f.uv ? atlasSlot.get(f.tile) : undefined, n = s === undefined ? 0 : atlas[s].tile;
    const own = s !== undefined && f.tile.startsWith('png/');
    return s === undefined ? { uvs: cellUV(slot), tile: [0, slot], textured: false }
      : { uvs: f.uv.map(([u, v]) => [(n % 4) * 64 + (own ? inset(u) : u), Math.floor(n / 4) * 64 + (own ? inset(v) : v)]), tile: [atlas[s].tex, n], textured: true };
  };
  const addFaces = (mesh, list, sec = null, objectCode = null) => {
    list = list.slice().sort((a, b) => (RANK[a.mat] ?? 50) - (RANK[b.mat] ?? 50));   // stable: raised parts first, objects, ground last
    for (const f of list) {
      const mat = f.mat, { uvs, tile, textured } = faceLook(f);
      const code = objectCode ?? f.surf ?? deckCode(f) ?? (ROADLIKE.has(mat) ? roadCode((f.own && an.byId.get(f.own)) || sec) : MATERIALS[mat].code);
      const ix = f.p.map(p => mesh.vert(...p));
      if (flat(ix.map(i => mesh.verts[i]))) continue;                       // no area left after rounding
      // an asset's face keeps its winding and flags (closed bodies face every way); the base is wound by its facing
      // the face flags for a tile with holes: 'key' = colour key, 0x12 (0x16 double-sided; the game sets this from
      // the tile number anyway, a file flag 0x13 / 0x17 is kept: the original asset wants the blend); 'blend' = 0x13
      const mode = textured ? tileMode.get(f.tile) : undefined;
      const flagsOf = v => { v = v ?? FACE_FLAGS; if (mode === 'blend') return v | 0x03; if (mode === 'key' && (v & 0x03) !== 0x03) return (v & ~0x03) | 0x02; return v; };
      // a steep face of a solid object is double-sided like the steep landscape (0x04: the back face test drops it at
      // grazing angles)
      const twoSided = f.solid && opt.steepDouble && steep(f.p) ? 0x04 : 0;
      if (f.keep) { if (ix[0] === ix[1] || ix[1] === ix[2] || ix[0] === ix[2]) continue; mesh.faces.push({ a: ix[0], b: ix[1], c: ix[2], uvs, tile, surf: code, fuv: null, role: 'object', flags: flagsOf(f.flags) | twoSided, textured }); continue; }
      mesh.tri(ix[0], ix[1], ix[2], uvs, tile, code, !f.facing, f.facing || null, null, mat);
      if (mode) { const last = mesh.faces[mesh.faces.length - 1]; last.flags = flagsOf(last.flags); }
      // kerb faces are double-sided (flag 0x04): thin or grazing faces fail the game's back face test
      if ((f.zone && (f.zone.startsWith('kerb') || f.zone === 'deck')) || (opt.steepDouble && steep(f.p))) mesh.faces[mesh.faces.length - 1].flags = 0x15;
    }
  };
  const farWalls = [];
  const order = groups.map(members => {
    const first = members[0], last = members[members.length - 1];
    // the placement's section record: the first section, with the fork of the last and the gap neighbourhood of any
    const s = { ...first, fork: !!last.fork, merge: !!first.merge, nextToGap: members.some(m => m.nextToGap), members };
    const id = `${first.path}:${first.j}`, sec = an.byId.get(id), mesh = new Mesh();
    for (const m of members) addFaces(mesh, bySection.get(`${m.path}:${m.j}`) || [], an.byId.get(`${m.path}:${m.j}`));
    const gate = mesh.faces.length ? gateOf(mesh, sec) : null;
    if (!gate) return null;                                               // no drivable face of its own (a branch section inside the main lane)
    // placement point: the middle of the placement's road; when that is not over the mesh's own drivable faces (a
    // branch section at a junction holding only the wedge) the centre of those faces
    const q = members.flatMap(m => { const ms = an.byId.get(`${m.path}:${m.j}`); return [edgePoint(ms.f0, -1), edgePoint(ms.f0, 1), edgePoint(ms.f1, 1), edgePoint(ms.f1, -1)]; });
    let at = [0, 1, 2].map(k => q.reduce((sum, p) => sum + p[k], 0) / q.length);
    const drivable = mesh.faces.filter(f => f.surf < 78).map(f => [f.a, f.b, f.c].map(i => mesh.verts[i]));
    const area = P => Math.abs((P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) - (P[1][2] - P[0][2]) * (P[2][0] - P[0][0]));
    const centroid = list => { let w = 0; const sum = [0, 0, 0]; for (const P of list) { const a = area(P) + 1; w += a; for (let k = 0; k < 3; k++) sum[k] += a * (P[0][k] + P[1][k] + P[2][k]) / 3; } return sum.map(v => v / w); };
    if (!drivable.some(P => inTri(at[0], at[2], P))) {
      at = centroid(drivable);
      if (!drivable.some(P => inTri(at[0], at[2], P))) {                 // behind the gate, on the faces the gate crosses
        const mid = [0, 1, 2].map(k => (gate[0][k] + gate[1][k]) / 2), dir = [sec.f1.c[0] - sec.f0.c[0], sec.f1.c[2] - sec.f0.c[2]], dl = Math.hypot(...dir) || 1;
        at = [120, 60, 20, 0].map(k => [mid[0] + dir[0] / dl * k, mid[1], mid[2] + dir[1] / dl * k]).find(p => drivable.some(P => inTri(p[0], p[2], P))) || mid;
      }
    }
    mesh.anchor = at.map(pyRound);
    const wall = wallDistance(mesh, mesh.anchor);
    if (wall > WALL_MAX) farWalls.push({ id, wall, at: mesh.anchor });
    return { s, mesh, gate: gate.map(p => mesh.vert(...p)), wall };
  }).filter(Boolean);
  if (farWalls.length) report.warnings.push({ text: `Walls beyond ${WALL_MAX} of the placement point in ${farWalls.length} placement(s), farthest ${Math.round(Math.max(...farWalls.map(w => w.wall)))} at ${farWalls[0].id} (the game's wall check fails there${group > 1 ? '; compileOptions.group = 1 or shorter sections' : ''})`, at: farWalls[0].at });
  // Types 4 and 5 of the two paths between a fork and its merge: the longer path (more placements) is type 4. The
  // game pairs the placements of the type 5 chain with those of the type 4 chain, one type 5 per type 4 placement;
  // a longer type 5 chain runs past the merge and the AI crashes there. In every fork block of the originals
  // type 4 >= type 5 (Canada 19/9, Carib 30/24, Austria 22/17, Japan 16/4 ...); the test level RPR1 with 52/54
  // crashed in the game.
  const longMain = new Set();                       // placement indices of main parallel parts that are longer than their branch
  for (let i = 0; i < order.length; i++) {
    if (!order[i].s.fork) continue;
    let j = i + 1; const branch = [], main = [];
    for (; j < order.length && !order[j].s.merge; j++) (order[j].s.path !== 'main' ? branch : main).push(j);
    if (main.length > branch.length) for (const k of main.concat(branch)) longMain.add(k);
  }
  // types: first/last, fork/merge, next to jump gaps
  const items = order.map(({ s, mesh, gate, wall }, k) => {
    // The sections next to a jump gap are a type 7 pair on the main road outside fork/merge blocks: the game's track
    // walk (gameorder.js) continues from a type 7 to the nearest other type 7, so the landing is found across a long
    // gap (Canada 121/122, gap 1051). Inside a fork/merge block the walk only follows types 4 or 5, so there the
    // sections keep their path's type as Carib's branch jumps do (103/104, 122/123, gaps of 727 and 766); such a gap
    // must be short enough that the landing is the nearest placement, which the walk check reports otherwise.
    const jump7 = s.nextToGap && s.path === 'main' && !s.parallel && opt.jumpType7 !== false;
    const swapped = longMain.has(k);
    let type = jump7 ? TYPE.JUMP : s.path !== 'main' ? (swapped ? TYPE.PATH_B : TYPE.PATH_A) : s.parallel ? (swapped ? TYPE.PATH_A : TYPE.PATH_B) : TYPE.SECTION;
    if (s.fork) type = TYPE.FORK;
    if (s.merge) type = TYPE.MERGE;
    if (k === 0) type = TYPE.FIRST;
    if (k === order.length - 1) type = TYPE.START;
    return { mesh, gate, type, section: s, wall };
  });
  items.forEach((it, k) => {
    if (it.type !== TYPE.FORK) return;
    for (let j = Math.max(0, k - Math.ceil(FORK_AHEAD_SECTIONS / group) + 1); j <= k; j++) if (items[j].section.path === 'main') items[j].flags3 = FORK_AHEAD;
  });
  // warning signs (flags3 of the placement: the sign shown while a car is on the section): automatic from the
  // track (signs.js) where the fork sign is not, and the ones set by hand in mode 1 over everything
  const auto = track.autoSigns === false ? new Map() : autoSigns(paths, an, track, inRange);
  for (const it of items) {
    if (!it.section) continue;
    for (const m of it.section.members || [it.section]) {
      const id = `${m.path}:${m.j}`, sec = an.byId.get(id);
      if (!it.flags3 && auto.has(id)) it.flags3 = auto.get(id);
      for (const [v, map] of Object.entries(track.signs || {})) if (sec && inRange(map, sec)) it.flags3 = Number(v);
      // camera offset (flags2): 1-10 move it by -50 per step, 11-20 by +50 per step above 10 (LEVELFORMAT.md ch. 7)
      for (const [v, map] of Object.entries(track.camera || {})) if (sec && inRange(map, sec)) it.flags2 = Number(v);
    }
  }
  const rampCount = items.filter(it => it.section && (it.section.members || [it.section]).some(m => ramps.has(`${m.path}:${m.j}`))).length;
  // no lightning: the placement numbers the game strikes lightning on are filler objects (one triangle without area,
  // which the game's back face test drops, deep below the track)
  const [L0, L1] = LIGHTNING_PLACEMENTS;
  const fillers = opt.avoidLightning && String(level.slot || 'Canada').toLowerCase() === 'canada' && items.length > L0 ? L1 - L0 + 1 : 0;
  if (fillers) {
    const at = items[L0 - 1].mesh.anchor || [0, 0, 0];
    items.splice(L0, 0, ...Array.from({ length: fillers }, () => {
      const mesh = new Mesh(), v = mesh.vert(at[0], at[1] - 5000, at[2]);
      mesh.faces.push({ a: v, b: v, c: v, uvs: cellUV(0), tile: [0, 0], surf: OBJECT_CODE, fuv: null, role: 'filler' });
      return { mesh, gate: null, type: TYPE.OBJECT, filler: true };
    }));
  }
  // scenery placements (type 50): the landscape far from every track placement, by cell, point in the middle
  const scenery = [];
  for (const [key, list] of bySection) {
    if (!key.startsWith('scenery:')) continue;
    const mesh = new Mesh();
    addFaces(mesh, list, null);
    if (!mesh.faces.length) continue;
    let w = 0; const sum = [0, 0, 0];
    for (const f of list) { const a = areaOf(f); w += a; for (let k = 0; k < 3; k++) sum[k] += a * (f.p[0][k] + f.p[1][k] + f.p[2][k]) / 3; }
    mesh.anchor = sum.map(v => pyRound(v / w));
    scenery.push({ mesh, gate: null, type: TYPE.SCENERY });
  }
  items.push(...scenery);
  // kerbs / markings as objects: OBJ_GROUP sections (in placement order) share one object
  if (objectFaces.length) {
    const at = new Map(order.flatMap(({ s }, k) => (s.members || [s]).map(m => [`${m.path}:${m.j}`, k])));
    const groups = new Map();
    for (const f of objectFaces) {
      const k = at.get(f.sec) ?? 0, g = Math.floor(k / OBJ_GROUP);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    }
    for (const list of groups.values()) {
      const mesh = new Mesh();
      addFaces(mesh, list, null, OBJECT_CODE);
      if (!mesh.faces.length) continue;
      const c = [0, 1, 2].map(k => pyRound(list.reduce((sum, f) => sum + (f.p[0][k] + f.p[1][k] + f.p[2][k]) / 3, 0) / list.length));
      mesh.anchor = c;
      items.push({ mesh, gate: null, type: TYPE.OBJECT, decor: true });
    }
  }
  // floating landscape (not connected to anything docked): separate objects
  if (terrainInfo) {
    for (const list of floatFaces) {
      const mesh = new Mesh();
      addFaces(mesh, list, null, OBJECT_CODE);
      if (mesh.faces.length) items.push({ mesh, gate: null, type: TYPE.OBJECT });
    }
  }
  // placed objects without collision: one placement each at its point, type 200, code 300; an object that hits the
  // car (o.hit, objects.js HIT) is a placement of that type with flags1 = 1 and the face code the originals use for it.
  // A collision object (o.kick, objects.js KICK, or a placed original of type 150 / 152 / 153) and a warning light
  // (type 154) keep flags1 = 0: the game kicks them away, the light also flashes (objects.js LIGHT). The game's hit box
  // is a square of +-30 around the point, tested within 50 of its height, whatever the mesh's size.
  let hitting = 0, lights = 0, kicked = 0;
  const bigKick = [], highKick = [];
  for (const { o, asset, list } of objectList) {
    const mesh = new Mesh(), type = placementType(o, asset), hit = HIT[type] ? type : null;
    addFaces(mesh, list, null, hit ? HIT[hit].code : OBJECT_CODE);
    mesh.anchor = [o.x, o.y, o.z].map(pyRound);
    if (!mesh.faces.length) continue;
    const path = o.anim ? animFrames(o.anim.anim, o.anim.entry) : null;
    if (path) animated++;
    if (hit) hitting++; else if (KICK[type]) kicked++; else if (LIGHT[type]) lights++;
    if (KICK[type] || LIGHT[type]) {
      const reach = Math.max(...list.flatMap(f => f.p.map(p => Math.max(Math.abs(p[0] - o.x), Math.abs(p[2] - o.z)))));
      if (reach > 60) bigKick.push({ o, reach });
      const below = groundLayers(o.x, o.z).filter(y => y <= o.y + 60), g = below.length ? Math.max(...below) : null;   // not a bridge above
      if (g !== null && (o.y - g < -10 || o.y - g > 60)) highKick.push({ o, above: o.y - g });
      if (path) report.warnings.push({ text: `Object ${o.id ?? o.asset} is kicked away by the car and animated: the two together are untested in the game`, at: [o.x, o.y, o.z] });
    }
    items.push({ mesh, gate: null, type, flags1: hit ? 1 : 0, placed: true, path, objectId: o.id });
  }
  if (bigKick.length) report.warnings.push({ text: `${bigKick.length} kicked-away object(s) reach up to ${Math.round(Math.max(...bigKick.map(b => b.reach)))} from their point: the game's hit box is only 60 x 60 around the point, the car drives through the rest`, at: [bigKick[0].o.x, bigKick[0].o.y, bigKick[0].o.z] });
  if (highKick.length) report.warnings.push({ text: `${highKick.length} kicked-away object(s) have their point ${Math.abs(Math.round(highKick[0].above))} ${highKick[0].above < 0 ? 'below' : 'above'} the ground: the game tests the hit within 50 of the point's height (the originals' points are 4-40 above the ground); move the object's origin`, at: [highKick[0].o.x, highKick[0].o.y, highKick[0].o.z] });
  // animation tables (type 250): one per animated texture in use, parked above the first section: n tiny faces
  // (flags 0x11, as the game's table setup wants them) whose tiles are the frames 0..n-1 in order; the game
  // copies them into the tile of face 0 - the one the textured faces show - one after another
  for (const [name, n] of animTables) {
    const mesh = new Mesh(), c = order[0]?.s?.f0?.c || [0, 0, 0], at = [c[0], c[1] + 2000, c[2]], list = [];
    for (let k = 0; k < n; k++) {
      const key = `png/${name}/${k}/0`;
      if (!atlasSlot.has(key)) { report.warnings.push(`Animated texture ${name}: frame ${k} did not fit the atlas, the animation is cut there`); break; }
      const x = at[0] + k * 4;
      list.push({ p: [[x, at[1], at[2]], [x + 2, at[1], at[2]], [x, at[1], at[2] + 2]], mat: 'object', colour: '#808080', rgb: [128, 128, 128], flags: 0x11, tile: key, uv: [[0, 0], [63, 0], [0, 63]], keep: true });
    }
    addFaces(mesh, list, null, OBJECT_CODE);
    mesh.anchor = at.map(pyRound);
    if (mesh.faces.length > 1) items.push({ mesh, gate: null, type: 250, table: true });
  }
  // sound sources (sounds.js): a marker placement of type 144 + slot with one tiny invisible triangle at the source;
  // a source riding on an animated object gets the object's path (the game keeps the marker's offset to the path)
  let soundCount = 0;
  for (const m of soundMarkers(level)) {
    if (m.slot > SLOT_MAX) { report.errors.push({ text: `Sound ${m.sound.name}: no free slot (at most ${SLOT_MAX - SLOT_FIRST + 1} own sounds, slots ${SLOT_FIRST}-${SLOT_MAX})`, at: m.pos }); continue; }
    const mesh = new Mesh(), [x, y, z] = m.pos;
    const a = mesh.vert(x, y, z), b = mesh.vert(x + 1, y, z), c = mesh.vert(x, y, z + 1);
    mesh.faces.push({ a, b, c, uvs: cellUV(0), tile: [0, 0], surf: OBJECT_CODE, fuv: null, role: 'marker', flags: FACE_FLAGS });
    mesh.anchor = m.pos.map(pyRound);
    const host = m.object && items.find(it => it.objectId === m.object.id);
    const path = host?.path ? host.path.map(f => [0, f[1] + (m.pos[0] - host.mesh.anchor[0]), f[2] + (m.pos[1] - host.mesh.anchor[1]), f[3] + (m.pos[2] - host.mesh.anchor[2]), 0, 0]) : null;
    items.push({ mesh, gate: null, type: MARKER_TYPE + m.slot, flags1: 1, marker: true, path });
    soundCount++;
  }

  // Ground behind every take-off edge (game test RPR2 2026-10-11): a ramp-coded road lets the car leave its edge only
  // when the ground it comes over there is drivable or deadly; with only wall-coded landscape (80) beyond and below the
  // edge (a take-off in the air over a terrain without pit) the car stops at the edge as at a wall (LEVELFORMAT.md ch. 17).
  // Sampled across the road just behind the edge: the highest landscape face below the road there, as the game's
  // ground query finds it.
  { const land = [];
    for (const it of items) if (LANDSCAPE.has(it.type)) for (const f of it.mesh.faces) land.push({ surf: f.surf, P: [f.a, f.b, f.c].map(i => it.mesh.verts[i]) });
    const groundBelow = (x, z, top) => {               // code of the highest landscape face under (x, z) not above `top`
      let best = null, by = -Infinity;
      for (const { surf, P: [a, b, c] } of land) {
        const d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
        if (!d) continue;
        const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / d, v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
        if (y <= top && y > by) { by = y; best = surf; }
      }
      return best;
    };
    const blocks = code => code === null || (code >= 78 && code !== 110 && code !== 131);
    // take-off sections: a section with road whose next section on its path is a jump gap; a branch starting with a
    // gap takes off from the main section ending at its fork node
    const takeOffs = [];
    for (const p of paths.all) {
      const n = p.closed ? p.frames.length : p.frames.length - 1;
      for (let j = 0; j < n; j++) {
        const s = an.byId.get(`${p.key}:${j}`), next = an.byId.get(`${p.key}:${p.closed ? (j + 1) % n : j + 1}`);
        if (s && !s.jump && next?.jump) takeOffs.push(s);
      }
      if (p !== paths.main && an.byId.get(`${p.key}:0`)?.jump) {
        const c = p.frames[0].c, s = placed.find(m => m.path === paths.main && Math.hypot(m.f1.c[0] - c[0], m.f1.c[2] - c[2]) < 1);
        if (s) takeOffs.push(s);
      }
    }
    for (const s of takeOffs) {
      const e = s.f1, dir = [e.c[0] - s.f0.c[0], e.c[2] - s.f0.c[2]], dl = Math.hypot(...dir) || 1;
      let walls = 0, samples = 0;
      for (const ahead of [40, 120]) for (const k of [-0.8, -0.4, 0, 0.4, 0.8]) {
        const x = e.c[0] + dir[0] / dl * ahead + e.left[0] * e.half * k, z = e.c[2] + dir[1] / dl * ahead + e.left[1] * e.half * k;
        samples++;
        if (blocks(groundBelow(x, z, e.c[1] + 20))) walls++;
      }
      if (!walls) continue;
      const k = items.findIndex(it => it.section?.members?.some(m => m.path === s.path.key && m.j === s.j));
      report.warnings.push({ text: `Jump after placement ${k}: behind the take-off edge the ground is ${walls === samples ? '' : 'partly '}wall-coded or missing (e.g. landscape, code 80) - the car stops there as at a wall; paint the ground under the gap deadly (pit) or drivable / drop edge`, at: e.c.slice() });
    }
  }

  const entries = toEntries(items);
  // the game's own track walk over the placements (gameorder.js): where it leaves our order the AI, "Wrong way" and
  // the lap count go astray and the AI crashes at the first fork
  { const walk = gameTrackOrder(entries), t = walk.trouble[0];
    if (t) {
      const where = k => (k == null ? 'nothing' : `placement ${k} (type ${entries[k].type})`);
      const text = t.text || `The game's track walk leaves the intended order: from ${where(t.from)} it continues to ${where(t.to)} instead of ${where(t.expected)} - that placement is nearer (long jump gap, a stretch of track nearby, a junction too close; LEVELFORMAT.md ch. 15)`;
      report.errors.push({ text, at: t.from != null ? entries[t.from].pos : undefined });
    } else if (walk.unvisited.length) report.errors.push({ text: `The game's track walk does not reach ${walk.unvisited.length} track placement(s), first ${walk.unvisited[0]}`, at: entries[walk.unvisited[0]].pos });
    report.stats.walkOk = !t && !walk.unvisited.length; }
  const msh = writeMSH(entries);           // sets the mesh offsets used by the .PLC
  const srf = writeSRF(entries);
  const files = { MSH: msh, PLC: writePLC(entries), POS: writePOS(entries), TRI: writeTRI(entries), SRF: srf.bytes };
  const v = validate(entries, { srfRecords: srf.records });
  // validate.js points at placements by number; the editor wants positions
  const locate = e => (typeof e === 'object' && typeof e.at === 'number' ? { ...e, at: entries[e.at]?.pos } : e);
  report.errors.push(...v.errors.map(locate));
  report.warnings.push(...v.warnings.map(locate));
  const length = paths.all.reduce((sum, p) => sum + p.frames.reduce((a, f, i, fr) =>
    i ? a + Math.hypot(f.c[0] - fr[i - 1].c[0], f.c[2] - fr[i - 1].c[2]) : a, 0), 0);
  // Expected lap time: the originals' laps (user, 2026-10-11: Austria 47 s, Iceland 37, Japan 50, USA 25, Carib 39,
  // Brazil 47) against their shortest lap through the gates (65 900, 48 800, 67 500, 34 800, 74 200, 63 100 units)
  // give 0.71-0.74 s per 1000 units, Carib 0.53; LAP_SECONDS_PER_1000 is the typical value. Shortest lap = main loop
  // with every branch block taken the shorter way, longest the longer way (plan distances, as trackLength).
  const dist2 = (a, b) => Math.hypot(a.c[0] - b.c[0], a.c[2] - b.c[2]);
  const mainFr = paths.main.frames, mainN = mainFr.length;
  const mainLap = mainFr.reduce((s, f, i) => s + dist2(f, mainFr[(i + 1) % mainN]), 0);
  let lapShort = mainLap, lapLong = mainLap;
  for (const p of paths.branches) {
    const at = node => mainFr.findIndex(f => f.seg === paths.main.ids.indexOf(node) && f.t === 0);
    const fi = at(p.from), ti = at(p.to);
    if (fi < 0 || ti < 0) continue;
    let stretch = 0;
    for (let i = fi; i !== ti; i = (i + 1) % mainN) stretch += dist2(mainFr[i], mainFr[(i + 1) % mainN]);
    const own = p.frames.reduce((s, f, i) => (i ? s + dist2(f, p.frames[i - 1]) : s), 0);
    lapShort -= Math.max(0, stretch - own);
    lapLong += Math.max(0, own - stretch);
  }
  const lapTime = Math.round(lapShort * LAP_SECONDS_PER_1000 / 1000), lapTimeLong = Math.round(lapLong * LAP_SECONDS_PER_1000 / 1000);
  Object.assign(report.stats, v.stats, { trackLength: Math.round(length), lapShort: Math.round(lapShort), lapLong: Math.round(lapLong), lapTime, lapTimeLong, crossings: crossing.count,
    branches: paths.branches.length, jumps: (track.jumps || []).length, rampSections: rampCount, lightningFillers: fillers,
    decorObjects: items.filter(it => it.decor).length, objects: objectList.length + collided, collisionObjects: collided, hittingObjects: hitting, kickedObjects: kicked, warningLights: lights, animatedTextures: animTables.size, hiddenFaces: hidden, atlasTiles: atlas.length,
    terrainFaces: level.terrain ? level.terrain.tris.length : undefined, sceneryPlacements: scenery.length, sectionsPerPlacement: group, trackSections: order0.length, animated, sounds: soundCount });
  return { files, entries, items, paths, report, base, terrain: level.terrain || null, terrainInfo, sections: an.secs, palette: pal.palette, atlas };
}
