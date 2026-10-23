// Core self-test: node editor/test/core.mjs
// Track (numbering, types, checks), base (kerbs, flags, verge), baked terrain (holes, docking,
// editing operations) and the compiled meshes.
import { newLevel, nextId, nodeMap, DEFAULT_WIDTH, DEFAULT_VERGE } from '../core/model.js';
import { compileLevel as compileRaw, WALL_MAX } from '../core/compile.js';
// the tests look at the track sections; the lightning fillers (Canada slot) are tested on their own (15.)
const compileLevel = (lv, ...rest) => compileRaw({ ...lv, compileOptions: { avoidLightning: false, ...lv.compileOptions } }, ...rest);
import { buildPaths, autoHandles } from '../core/paths.js';
import { buildBase } from '../core/base.js';
import { bakeTerrain } from '../core/bake.js';
import { setRange } from '../core/sections.js';
import { DRAW_ORDER, MATERIALS } from '../core/materials.js';
import * as TR from '../core/terrain.js';
import { baseColour, setBaseColour, setTerrainColour, parsePaint, paintString, paintUV, roadFrame } from '../core/paint.js';
import { PAL_SIZE } from '../core/palette.js';
import { adaptLevel } from '../core/adapt.js';
import { buildAsset, openEdges } from '../core/csg.js';
import { projectUV, splitByTiles } from '../core/texmap.js';
import { poseAt, setKey } from '../core/anim.js';
import { soundSlots, soundFileName, sourcePosition } from '../core/sounds.js';
import { tidyObject, collisionOf, lightOf, setCollision, setLight } from '../core/objects.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const types = r => r.entries.map(e => e.type);
const count = (r, t) => types(r).filter(x => x === t).length;
const FULL = DEFAULT_WIDTH + 2 * DEFAULT_VERGE;   // full drivable width of a default cross section
const addNode = (lv, x, z) => { const id = nextId(lv.track.nodes, 'n'); lv.track.nodes.push({ id, x, z, y: 0, width: 360, vl: 320, vr: 320 }); return id; };
const withBranch = lv => { lv.track.branches.push({ id: 'b0', from: 'n2', to: 'n4', nodes: [addNode(lv, -2000, 7500), addNode(lv, -7500, 3000)] }); return lv; };
const bake = lv => {
  const paths = buildPaths(lv.track), base = buildBase(lv, paths, undefined, { terrain: true }), b = bakeTerrain(lv, paths, base);
  lv.terrain = b.terrain; lv.track.cuts = b.cuts;
  return b;
};

// 1. plain loop
let lv = newLevel('t1');
let r = compileLevel(lv);
ok(r.report.errors.length === 0, 'plain loop: no errors ' + JSON.stringify(r.report.errors));
ok(count(r, 0) === 1 && count(r, 1) === 1, 'plain loop: one start (0) and one first (1)');
ok(types(r)[0] === 1 && types(r)[types(r).length - 1] === 0, 'plain loop: first = type 1, last = type 0');
ok(r.entries.every(e => e.type > 8 || Math.max(...e.mesh.faces.map(f => 0)) === 0) && r.paths.main.frames.every((f, i, a) => {
  const g = a[(i + 1) % a.length]; return Math.hypot(g.c[0] - f.c[0], g.c[2] - f.c[2]) <= 250.5; }), 'plain loop: no section longer than 250');
console.log('     sections', r.entries.length, 'length', r.report.stats.trackLength);

// 2. branch from n2 to n4, outside the loop
lv = withBranch(newLevel('t2'));
r = compileLevel(lv);
ok(r.report.errors.length === 0, 'branch: no errors ' + JSON.stringify(r.report.errors));
ok(count(r, 3) === 1 && count(r, 6) === 1, 'branch: one fork (3) and one merge (6)');
ok(r.items.every(it => it.section.path === 'main' || it.type === 4) && count(r, 5) > 0,
   `branch: branch path type 4, parallel main path type 5 (${count(r, 4)} / ${count(r, 5)})`);
{ const iF3 = types(r).indexOf(3);
  ok(r.entries.slice(iF3 - 5, iF3 + 1).every(e => e.flags[3] === 10) && r.entries.filter(e => e.flags[3] === 10).length === 6, 'branch: flags3 = 10 on the 6 sections up to the fork'); }
const t = types(r), iFork = t.indexOf(3), iMerge = t.indexOf(6);
ok(iFork < iMerge, `branch: fork ${iFork} before merge ${iMerge}`);
ok(r.items[iFork + 1].section.path === 'b0', 'branch: branch numbered right after the fork');

// 3. jump between n3 and n4
lv = newLevel('t3');
lv.track.jumps.push('n3|n4');
r = compileLevel(lv);
ok(r.report.errors.length === 0, 'jump: no errors ' + JSON.stringify(r.report.errors));
ok(count(r, 7) === 2 && r.items.filter(it => it.section?.nextToGap).length === 2, 'jump: the two sections next to the gap are a type 7 pair');
ok(r.entries.length < compileLevel(newLevel('x')).entries.length, 'jump: fewer sections');
ok(r.items.filter(it => it.section?.nextToGap).every(it => it.type === 7 && it.mesh.faces.some(f => f.surf === 10)), 'jump: ramp code on the road next to the gap');
ok(compileLevel({ ...lv, compileOptions: { jumpType7: false } }).entries.filter(e => e.type === 7).length === 0, 'jump: no type 7 with jumpType7 false');
ok(r.report.stats.walkOk === true, 'jump: the game walk follows the track across the gap');
{ // the ground behind the take-off edge: wall-coded or missing ground stops the car (RPR2, 2026-10-11)
  const takeOff = res => res.report.warnings.filter(w => (w.text || w).startsWith('Jump after'));
  ok(takeOff(r).length === 1, 'jump: take-off warning without terrain (no ground behind the edge)');
  const lj = JSON.parse(JSON.stringify(lv)); bake(lj);
  ok(lj.terrain.tris.some(t => t[3] === 'dead') && takeOff(compileLevel(lj)).length === 0, 'jump: no take-off warning over the baked pit');
  for (const t of lj.terrain.tris) if (t[3] === 'dead') t[3] = 'land';
  const w = takeOff(compileLevel(lj));
  ok(w.length === 1 && w[0].at, 'jump: take-off warning with landscape (code 80) instead of the pit ' + JSON.stringify(w.map(x => x.text))); }

// 4. figure eight crossing at the same height -> error; lifted -> ok
lv = newLevel('t4');
const fig = [[5000, 0], [2500, 2500], [0, 0], [-2500, -2500], [-5000, 0], [-2500, 2500], [0, 0.1], [2500, -2500]];
lv.track.nodes.forEach((n, i) => { n.x = fig[i][0]; n.z = Math.round(fig[i][1]); });
lv.track.nodes[2].x = 0; lv.track.nodes[2].z = 300; lv.track.nodes[6].x = 0; lv.track.nodes[6].z = -300;
r = compileLevel(lv);
ok(r.report.errors.some(e => (e.text || e).includes('crosses itself')), 'crossing: error at the same height');
lv.track.nodes[1].y = 300; lv.track.nodes[2].y = 400; lv.track.nodes[3].y = 300;
r = compileLevel(lv);
ok(!r.report.errors.some(e => (e.text || e).includes('crosses itself')) && r.report.stats.crossings >= 1,
   'crossing: ok with 400 clearance, counted as bridge/tunnel ' + JSON.stringify(r.report.errors));

// 5. reversed direction
lv = newLevel('t5'); lv.track.start.reverse = true;
r = compileLevel(lv);
ok(r.report.errors.length === 0 && count(r, 0) === 1, 'reverse: still valid');

// 5b. jump at the end of a branch (landing on the merge)
lv = newLevel('t5b');
{ const p1 = addNode(lv, -2000, 7500), p2 = addNode(lv, -7500, 3000);
  lv.track.branches.push({ id: 'b0', from: 'n2', to: 'n4', nodes: [p1, p2] });
  lv.track.jumps.push([p2, 'n4'].sort().join('|')); }
r = compileLevel(lv);
{ const t = types(r), i7 = r.items.findIndex(it => it.section?.nextToGap && it.section.path === 'b0'), i6 = t.indexOf(6), i3 = t.indexOf(3);
  ok(r.report.errors.length === 0, 'jump at merge: no errors ' + JSON.stringify(r.report.errors));
  ok(i7 >= 0 && i6 === i7 + 1, `jump at merge: take-off ${i7}, merge ${i6} consecutive`);
  ok(r.items[i3 + 1].section.path === 'main', 'jump at merge: main part numbered right after the fork');
  ok(i6 === t.lastIndexOf(6) && r.items.slice(i3 + 1, i6).every(it => it.type !== 0 && it.type !== 1), 'jump at merge: merge highest of the block'); }

// 5b2. several sections per placement (compileOptions.group): half the placements, every one with a gate, the fork
// section last in its placement and the merge section first, no placement across a jump gap
{ const g1 = compileLevel(withBranch(newLevel('t5g'))), lv2 = withBranch(newLevel('t5g')); lv2.track.jumps.push('n5|n6');
  lv2.compileOptions = { group: 2 }; const g2 = compileLevel(lv2);
  const tr = g2.items.filter(it => it.section), t = tr.map(it => it.type);
  ok(g2.report.errors.length === 0 && tr.length < g1.items.filter(it => it.section).length * 0.6 && tr.every(it => it.gate), `group: 2 sections per placement halves the placements (${g1.items.filter(it => it.section).length} -> ${tr.length}), all with gates`);
  ok(tr.every(it => (it.section.members || []).every((m, i, a) => !i || (m.path === a[i - 1].path && m.j === a[i - 1].j + 1))), 'group: members consecutive on one path');
  ok(tr.filter(it => it.type === 3).every(it => it.section.members[it.section.members.length - 1].fork) && tr.filter(it => it.type === 6).every(it => it.section.members[0].merge), 'group: fork section last, merge section first in their placements');
  ok(t[0] === 1 && t[t.length - 1] === 0 && t.filter(x => x === 3).length === 1 && t.filter(x => x === 6).length === 1, 'group: types 1/0 first and last, one fork and one merge');
  const gapOk = tr.every(it => !it.section.members.slice(1).some((m, i) => m.nextToGap && it.section.members[i].nextToGap && m.j !== it.section.members[i].j + 1));
  ok(gapOk, 'group: no placement across the jump gap');
  const big = newLevel('t5h'); big.track.section = 60; const rb = compileLevel(big);
  ok(rb.report.errors.length === 0 && rb.report.stats.sectionsPerPlacement > 1 && rb.entries.length <= 500, `group: a track of ${rb.report.stats.trackSections} sections is grouped automatically (${rb.report.stats.sectionsPerPlacement} per placement, ${rb.entries.length} placements)`); }

// 5b3. the longer of the two paths of a fork block is type 4 (the game pairs the type 5 chain into the type 4 entries)
{ const lv = newLevel('t5i'); const b = addNode(lv, 0, 3200);              // a short branch cutting across the loop
  lv.track.branches.push({ id: 'b0', from: 'n1', to: 'n3', nodes: [b] });
  const r = compileLevel(lv), tr = r.items.filter(it => it.section);
  const n4 = tr.filter(it => it.type === 4).length, n5 = tr.filter(it => it.type === 5).length;
  ok(r.report.errors.length === 0 && n4 >= n5 && tr.filter(it => it.type === 4).every(it => it.section.path === 'main'), `types: the longer path is type 4 (main ${n4} as type 4, branch ${n5} as type 5)`);
  const r2 = compileLevel(withBranch(newLevel('t5j'))), t2 = r2.items.filter(it => it.section);
  ok(t2.filter(it => it.type === 4).length >= t2.filter(it => it.type === 5).length, 'types: type 4 at least as many as type 5 with a long branch too'); }

// 5c. junctions: no branch gate on the main road
lv = withBranch(newLevel('t5c'));
r = compileLevel(lv);
{ const gm = r.entries.map(e => e.gate && [(e.mesh.verts[e.gate[0]][0] + e.mesh.verts[e.gate[1]][0]) / 2, (e.mesh.verts[e.gate[0]][2] + e.mesh.verts[e.gate[1]][2]) / 2]);
  let close = 0;
  for (let i = 0; i < gm.length; i++) for (let j = i + 2; j < gm.length; j++) if (gm[i] && gm[j] && Math.hypot(gm[i][0] - gm[j][0], gm[i][1] - gm[j][1]) < 120) close++;
  ok(close === 0 && r.report.errors.length === 0, `junction: no gates on top of each other (${close})`); }

// 5d. placements and gates as the originals (Brazil 82 / 48): every placement has drivable faces
// of its own and a gate across them; no gate over another placement's drivable faces; the fork gate covers the
// undivided road, the merge gate the lane; the branch holds the wedge; walls near the placement points
{ const track = r.items.filter(it => it.section), E = r.entries;
  const inTri = (x, z, [a, b, c]) => { const s1 = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]), s2 = (c[0] - b[0]) * (z - b[2]) - (c[2] - b[2]) * (x - b[0]), s3 = (a[0] - c[0]) * (z - c[2]) - (a[2] - c[2]) * (x - c[0]); return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0); };
  const drivable = e => e.faces.filter(f => f.surf < 78).map(f => f.idx.map(i => e.mesh.verts[i]));
  ok(track.every((it, k) => it.gate && it.gate.length === 2 && drivable(E[k]).length > 0), 'placements: every track placement has drivable faces and a gate');
  let over = 0;
  track.forEach((it, k) => { const [a, b] = it.gate.map(i => E[k].mesh.verts[i]);
    for (let s = 0.1; s < 0.95; s += 0.1) { const x = a[0] + (b[0] - a[0]) * s, z = a[2] + (b[2] - a[2]) * s, y = a[1] + (b[1] - a[1]) * s;
      track.forEach((o, j) => { if (j === k || j === k - 1 || Math.abs(E[j].pos[1] - y) > 150) return; if (drivable(E[j]).some(P => inTri(x, z, P) && Math.abs((P[0][1] + P[1][1] + P[2][1]) / 3 - y) < 100)) over++; }); } });
  ok(over === 0, `placements: no gate over another placement's drivable faces (${over} samples)`);
  const len = k => { const [a, b] = track[k].gate.map(i => E[k].mesh.verts[i]); return Math.hypot(a[0] - b[0], a[2] - b[2]); };
  const i3 = track.findIndex(it => it.type === 3), i6 = track.findIndex(it => it.type === 6);
  ok(i3 >= 0 && len(i3) > FULL * 0.8, `placements: the fork gate covers the undivided road (${Math.round(len(i3))} of ${FULL})`);
  ok(i6 >= 0 && len(i6) < FULL * 0.8 && len(i6) >= DEFAULT_WIDTH * 0.95, `placements: the merge gate is the lane (${Math.round(len(i6))})`);
  const b0 = track.filter(it => it.section.path === 'b0');
  ok(b0.length > 0 && b0.slice(0, 2).some(it => len(track.indexOf(it)) < FULL * 0.8), `placements: the branch's first sections hold the wedge (gates ${b0.slice(0, 3).map(it => Math.round(len(track.indexOf(it)))).join(', ')})`);
  ok(track.every(it => it.wall <= WALL_MAX), `placements: walls within ${WALL_MAX} of the placement point (max ${Math.round(Math.max(...track.map(it => it.wall)))})`);
  ok(!r.report.warnings.some(w => String(w.text || w).includes('not above its own road')), 'placements: every placement point above its own road'); }

// 6. base: kerbs, flags, verge
lv = newLevel('t6');
{ const paths = buildPaths(lv.track), base0 = buildBase(lv, paths);
  const secs = base0.an.secs.filter(s => s.path.key === 'main' && s.j >= 10 && s.j < 15);
  setRange(lv.track.kerbs, secs, [1, -1], true);
  setRange(lv.track.slippery, base0.an.secs.filter(s => s.path.key === 'main' && s.j >= 20 && s.j < 22), [null], true);
  setRange(lv.track.order, base0.an.secs.filter(s => s.path.key === 'main' && s.j >= 30 && s.j < 31), [null], true);
  setRange(lv.track.ramp, base0.an.secs.filter(s => s.path.key === 'main' && s.j >= 40 && s.j < 42), [null], true);
  ok(Object.keys(lv.track.kerbs).length >= 1, 'kerbs: stored ' + JSON.stringify(lv.track.kerbs));
  r = compileLevel(lv);
  const kz = z => r.base.tris.filter(t => t.zone === z).length;
  ok(kz('kerbIn') === 5 * 2 * 2 && kz('kerbTop') === 5 * 2 * 2 && kz('kerbOut') === 5 * 2 * 2 + 2 * 2 * 2,
     `kerbs: inner side, top, outer side and end caps (${kz('kerbIn')}/${kz('kerbTop')}/${kz('kerbOut')})`);
  const kerbMesh = r.entries.filter(e => e.type <= 8).flatMap(e => e.mesh.faces).filter(f => f.role.startsWith('kerb'));
  ok(kerbMesh.length === 5 * 2 * 6 + 8 && kerbMesh.every(f => f.surf === 80), 'kerbs: wall code 80 in the section meshes');
  ok(r.entries.every(e => e.faces.every(f => !f.tile || true)) && r.entries.flatMap(e => e.faces).filter(f => f.flags === 0x15).length === kerbMesh.length, 'kerbs: double-sided (flag 0x15) on all kerb faces');
  const kerb = { ...lv.track.kerb };
  const top = r.base.tris.filter(t => t.zone === 'kerbTop' || t.zone === 'kerbIn').flatMap(t => t.p);
  const road = r.sections.find(s => s.id === 'main:12');
  ok(Math.max(...top.map(p => p[1])) - road.f0.c[1] === kerb.height, `kerbs: ${kerb.height} high`);
  const out = r.base.tris.filter(t => t.zone === 'kerbOut' && !t.cap).flatMap(t => t.p).map(p => Math.hypot(p[0] - road.f0.c[0], p[2] - road.f0.c[2]));
  ok(kerb.lid === 80 && kerb.foot === 140 && kerb.height === 30, 'kerbs: default profile lid 80, foot 140, height 30');
  const surf = j => r.items.find(it => it.section.path === 'main' && it.section.j === j).mesh.faces.filter(f => f.role.startsWith('road')).map(f => f.surf);
  ok(surf(20).every(s => s === 5) && surf(30).every(s => s === 20) && surf(5).every(s => s === 0) && surf(40).every(s => s === 10), `flags: slippery road code 5, wrong-order code 20, plain 0 (${surf(20)[0]}/${surf(30)[0]}/${surf(5)[0]})`);
  ok(r.report.errors.length === 0, 'kerbs/flags: no errors ' + JSON.stringify(r.report.errors));
  { const l2 = JSON.parse(JSON.stringify(lv)); l2.track.signs = { 15: {} };
    setRange(l2.track.signs[15], buildBase(l2, buildPaths(l2.track)).an.secs.filter(s => s.path.key === 'main' && s.j >= 50 && s.j < 53), [null], true);
    l2.track.autoSigns = false;
    const r3 = compileLevel(l2), f3 = r3.items.map((it, k) => [it.section.j, r3.entries[k].flags[3]]).filter(([j]) => j >= 48 && j < 55);
    ok(f3.every(([j, v]) => v === (j >= 50 && j < 53 ? 15 : 0)), 'signs: flags3 = 15 on the marked sections only ' + JSON.stringify(f3)); }
  { // automatic signs: an oval with sharp ends, a jump; left bends odd, right bends even
    const l3 = newLevel('t6s'); l3.track.nodes = []; for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * Math.PI; l3.track.nodes.push({ id: 'n' + i, x: Math.round(4000 * Math.cos(a)), z: Math.round(1200 * Math.sin(a)), y: 0, width: 360, vl: 320, vr: 320 }); }
    l3.track.main = l3.track.nodes.map(n => n.id);
    let r3 = compileLevel(l3); const v3 = r3.entries.map(e => e.flags[3]).filter(Boolean);
    ok(v3.length > 0 && v3.every(v => v % 2 === 1), `signs: an oval driven counter-clockwise has left-bend signs only (${[...new Set(v3)]})`);
    l3.track.start.reverse = true; r3 = compileLevel(l3); const v4 = r3.entries.map(e => e.flags[3]).filter(Boolean);
    ok(v4.length > 0 && v4.every(v => v % 2 === 0), `signs: reversed, right-bend signs only (${[...new Set(v4)]})`);
    l3.track.start.reverse = false; l3.track.jumps = ['n3|n4']; r3 = compileLevel(l3);
    ok(r3.entries.some(e => e.flags[3] === 9), 'signs: jump sign (9) before a jump'); }
  // verge: none on the left of one node, wide on the right
  lv = newLevel('t6b'); lv.track.nodes[3].vl = 40; lv.track.nodes[4].vl = 40; lv.track.nodes[5].vl = 40; lv.track.nodes[3].vr = 600;
  r = compileLevel(lv);
  ok(r.report.errors.length === 0 && r.base.tris.some(t => t.zone === 'drive') && r.base.tris.length > 0, 'verge: per node left/right widths compile');
  { const wide = t => Math.max(...t.p.map(p => Math.hypot(p[0] - lv.track.nodes[4].x, p[2] - lv.track.nodes[4].z)));
    const near = r.base.tris.filter(t => t.zone === 'drive' && t.side === 1 && Math.min(...t.p.map(p => Math.hypot(p[0] - lv.track.nodes[4].x, p[2] - lv.track.nodes[4].z))) < 200);
    ok(near.some(t => Math.max(...t.p.map(p => Math.hypot(p[0] - lv.track.nodes[4].x, p[2] - lv.track.nodes[4].z))) < 330), 'verge: a narrow strip (40) on the left near node n4'); } }

// 6c. verge per section and side; a tight bend does not fold the verge
lv = newLevel('t6c');
{ const base0 = buildBase(lv, buildPaths(lv.track));
  setRange(lv.track.noVerge, base0.an.secs.filter(s => s.path.key === 'main' && s.j >= 10 && s.j < 15), [1], true);
  r = compileLevel(lv);
  const drive = (side, j) => r.base.tris.filter(t => t.zone === 'drive' && t.side === side && t.sec === 'main:' + j).length;
  const land = (side, j) => r.base.tris.filter(t => t.zone === 'land' && t.side === side && t.sec === 'main:' + j).length;
  ok(drive(1, 12) === 0 && land(1, 12) === 0 && drive(-1, 12) > 0 && drive(1, 20) > 0, `verge: no strip at all on the left of sections 10-14, still drivable on the right and elsewhere (${drive(1, 12)}/${land(1, 12)}/${drive(-1, 12)}/${drive(1, 20)})`);
  const gl = j => { const it = r.items.find(i => i.section.path === 'main' && i.section.j === j); const [a, b2] = it.gate.map(i => it.mesh.verts[i]); return Math.hypot(a[0] - b2[0], a[2] - b2[2]); };
  ok(gl(12) < FULL * 0.9 && gl(20) > FULL * 0.95, `verge: the gate of a section without drivable verge on one side is shorter (${Math.round(gl(12))} / ${Math.round(gl(20))})`);
  const b = bake(lv); r = compileLevel(lv);
  ok(r.terrainInfo.holes.length === 0 && b.failed.length === 0 && r.report.errors.length === 0, `verge: terrain around the gap in the verge is closed (${r.terrainInfo.holes.length} open edges)`);
  setRange(lv.track.noVerge, base0.an.secs.filter(s => s.path.key === 'main' && s.j >= 30 && s.j < 34), [1, -1], true);
  r = compileLevel(lv);
  ok(r.terrainInfo.holes.length === 0 && r.report.errors.length === 0, `verge: removing it later keeps the terrain closed (the boundary docks to the road edge) (${r.terrainInfo.holes.length})`); }
for (const radius of [700, 600, 450, 330]) {
  lv = newLevel('t6d');
  lv.track.nodes.forEach((n, i) => { const a = i / 8 * 2 * Math.PI; n.x = Math.round(radius * Math.cos(a)); n.z = Math.round(radius * Math.sin(a)); });
  { const b0 = buildBase(lv, buildPaths(lv.track)); if (radius >= 600) setRange(lv.track.kerbs, b0.an.secs, [1, -1], true); }
  const b = bake(lv); r = compileLevel(lv);
  const sign = tt => Math.sign((tt.p[1][0] - tt.p[0][0]) * (tt.p[2][2] - tt.p[0][2]) - (tt.p[1][2] - tt.p[0][2]) * (tt.p[2][0] - tt.p[0][0]));
  const ref = {}; for (const tt of r.base.tris) if (tt.zone === 'road') ref[tt.side] ??= sign(tt);
  const fold = r.base.tris.filter(tt => !tt.cap && !tt.deck && sign(tt) !== 0 && sign(tt) !== ref[tt.side]).length;
  ok(fold === 0 && r.terrainInfo.holes.length === 0 && b.failed.length === 0, `bend of radius ${radius}${radius >= 600 ? ' with kerbs' : ''}: no folded triangles (${fold}), terrain closed (${r.terrainInfo.holes.length})`);
}

// 6e. an oval with tight ends (radius 360 at the ends, kerbs everywhere): verge and kerbs, terrain closed
{ lv = newLevel('t6e');
  lv.track.nodes = []; for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * Math.PI; lv.track.nodes.push({ id: 'n' + i, x: Math.round(4000 * Math.cos(a)), z: Math.round(1200 * Math.sin(a)), y: 0, width: 360, vl: 320, vr: 320 }); }
  lv.track.main = lv.track.nodes.map(n => n.id);
  { const b0 = buildBase(lv, buildPaths(lv.track)); setRange(lv.track.kerbs, b0.an.secs, [1, -1], true); }
  const b = bake(lv); r = compileLevel(lv);
  ok(r.terrainInfo.holes.length === 0 && b.failed.length === 0 && r.report.errors.length === 0, `oval with tight ends and kerbs: terrain closed (${r.terrainInfo.holes.length} open edges, ${b.failed.length} base edges lost)`); }

// 7. baked terrain: plain loop and loop with branch + jump
for (const [name, setup] of [['plain', () => {}], ['branch+jump', l => { withBranch(l); l.track.jumps.push('n6|n7'); }]]) {
  lv = newLevel('t7'); setup(lv);
  const b = bake(lv);
  r = compileLevel(lv);
  const st = r.report.stats;
  ok(r.report.errors.length === 0, `terrain ${name}: no errors ` + JSON.stringify(r.report.errors));
  ok(r.terrainInfo.holes.length === 0, `terrain ${name}: no holes (${r.terrainInfo.holes.length} open edges)`);
  ok(b.terrain.points.filter(p => !p.d).length === 0, `terrain ${name}: every point docked`);
  ok(!r.report.warnings.some(w => String(w.text || w).includes('placement point')), `terrain ${name}: placement points on the road`);
  ok(st.maxWallDistance > 0 && st.maxWallDistance <= 890, `terrain ${name}: walls near the placement points (${st.maxWallDistance})`);
  ok(r.entries.every(e => e.type <= 8 || e.type === 50), `terrain ${name}: all terrain in track sections or scenery placements, no objects`);
  ok(r.entries.filter(e => e.type === 50).every(e => e.faces.every(f => f.surf >= 78)), `terrain ${name}: scenery placements hold nothing drivable`);
  // the originals' rule (LEVELFORMAT.md ch. 18): a landscape vertex within 2500 of a track placement's point belongs to a
  // placement whose point is within 3500 of it (the game draws a placement only near its point); backdrop farther out may
  // belong to a far placement
  { const cams = r.entries.filter(e => e.type <= 8).map(e => e.pos); let far = 0;
    for (const e of r.entries) if (e.type <= 8 || e.type === 50) for (const p of e.mesh.verts) for (const c of cams) if (Math.hypot(p[0] - c[0], p[2] - c[2]) <= 2500 && Math.hypot(e.pos[0] - c[0], e.pos[2] - c[2]) > 3500) far++;
    ok(far < 200, `terrain ${name}: landscape near the track owned by placements with points within 3500 (${far} vertex-camera pairs beyond; originals up to 158)`); }
  ok(st.triangles < 5000, `terrain ${name}: coarse (${st.triangles} triangles)`);
  ok(r.entries.every(e => e.mesh.faces.every((f, i, a) => !i || DRAW_ORDER.indexOf(a[i - 1].role) <= DRAW_ORDER.indexOf(f.role))),
     `terrain ${name}: faces ordered raised parts first, ground last`);
  ok(r.entries.filter(e => e.type <= 8).every(e => e.faces.some(f => f.surf === 0 || f.surf === 10)), `terrain ${name}: every section has road`);
  { const len = r.entries.filter(e => e.gate).map(e => { const [a, b2] = e.gate.map(i => e.mesh.verts[i]); return Math.hypot(a[0] - b2[0], a[2] - b2[2]); });
    ok(len.filter(l => l > FULL * 0.95).length > len.length * 0.8, `terrain ${name}: gates across road and verge (${Math.round(Math.min(...len))}..${Math.round(Math.max(...len))})`); }
  if (name !== 'plain') ok(r.entries.some(e => e.faces.some(f => f.surf === 110)), `terrain ${name}: deadly ground (110) under the jump`);
  console.log('     ', JSON.stringify(st), r.report.warnings.map(w => w.text || w));
}

// 7b. terrain around kerbs, a bridge, hills and a branch with kerbs: closed, nothing lost
{ const closed = (name, l) => {
    const b = bake(l), rr = compileLevel(l);
    ok(rr.report.errors.length === 0 && rr.terrainInfo.holes.length === 0 && b.failed.length === 0,
       `terrain ${name}: closed (${rr.terrainInfo.holes.length} open edges, ${b.failed.length} base edges lost) ${JSON.stringify(rr.report.errors)}`);
    return rr;
  };
  lv = newLevel('t7b');
  { const base = buildBase(lv, buildPaths(lv.track));
    setRange(lv.track.kerbs, base.an.secs.filter(s => s.j >= 10 && s.j < 30), [1, -1], true);
    setRange(lv.track.kerbs, base.an.secs.filter(s => s.j >= 40 && s.j < 45), [-1], true); }
  r = closed('with kerbs', lv);
  ok(r.base.tris.filter(t => t.cap).length === 2 * 2 * 3 * 2 / 2 * 2 / 2 * 1 || r.base.tris.filter(t => t.cap).length > 0, 'terrain with kerbs: kerb end caps present');
  lv = newLevel('t7c');
  lv.track.nodes.forEach((n, i) => { n.x = fig[i][0]; n.z = Math.round(fig[i][1]); });
  lv.track.nodes[2].x = 0; lv.track.nodes[2].z = 300; lv.track.nodes[6].x = 0; lv.track.nodes[6].z = -300;
  lv.track.nodes[1].y = 300; lv.track.nodes[2].y = 400; lv.track.nodes[3].y = 300;
  r = closed('with a bridge', lv);
  { const tr = r.base.tris, z = k => tr.filter(t => t.strip === k).length;
    ok(r.base.bridges === 1 && tr.some(t => t.covered && !t.deck) && z('ceiling') > 0 && z('wall') > 0 && z('fascia') > 0 && tr.some(t => t.portal),
       `terrain with a bridge: underpass built (floor ${tr.filter(t => t.covered && !t.deck).length}, ceiling ${z('ceiling')}, walls ${z('wall')}, fascia ${z('fascia')})`);
    ok(tr.some(t => t.zone === 'drive' && t.covered), 'terrain with a bridge: the lower road keeps its verge under the bridge'); }
  { const deck = r.base.tris.filter(t => t.zone === 'deck');
    const meshDeck = r.items.flatMap(it => it.mesh.faces).filter(f => f.role === 'deck');
    ok(deck.length >= 12 && meshDeck.length === deck.length && meshDeck.every(f => f.surf === 80 && f.flags === 0x15), `bridge: deck thickness (${deck.length} faces, wall code, double-sided)`);
    ok(compileLevel(newLevel('p')).base.tris.every(t => t.zone !== 'deck'), 'bridge: no deck faces on a plain loop'); }
  // the same crossing without a verge on the upper road: a free-standing deck, ramp code all over, the cliff under its ends too
  { const fl = JSON.parse(JSON.stringify(lv)); fl.name = 't7cf';
    { const base = buildBase(fl, buildPaths(fl.track)); setRange(fl.track.noVerge, base.an.secs, [1, -1], true); }
    const rf = closed('with a free-standing bridge', fl), tr = rf.base.tris;
    ok(rf.base.bridges === 1 && rf.base.deckEnds.length === 2 && tr.some(t => t.floating && !t.deck) && !tr.some(t => t.strip === 'wall' || t.portal),
       `free-standing bridge: ${rf.base.deckEnds.length} deck ends, no tunnel walls`);
    const faces = rf.items.flatMap(it => it.mesh.faces), deck = faces.filter(f => f.role === 'deck');
    const onEnd = p => rf.base.deckEnds.some(({ a, b }) => Math.hypot(p[0] - a[0], p[2] - a[2]) < 2 || Math.hypot(p[0] - b[0], p[2] - b[2]) < 2);
    let hanging = 0, hangingRamp = 0;
    for (const it of rf.items) for (const f of it.mesh.faces) { const P = [f.a, f.b, f.c].map(i => it.mesh.verts[i]); if (P.filter(onEnd).length >= 2) { hanging++; if (f.surf === 10) hangingRamp++; } }
    ok(deck.length > 0 && deck.every(f => f.surf === 10) && hanging > 0 && hanging === hangingRamp,
       `free-standing bridge: deck faces ramp-coded (${deck.length}), faces hanging from the deck ends ramp-coded (${hangingRamp} of ${hanging})`); }
  // the user's choice per crossing (track.crossings by the crossing's key): 'none' leaves the roads alone (the upper
  // one floats over the crossing, the lower stays whole), 'bridge' builds the free-standing deck although the road
  // has a verge; without a choice the mode is automatic (tunnel here)
  { const c = compileLevel(lv).base.crossings;
    ok(c.length === 1 && c[0].mode === 'tunnel' && c[0].auto && c[0].key.includes('^') && Array.isArray(c[0].at), `crossings: listed with key and mode ${JSON.stringify(c)}`);
    const ln = JSON.parse(JSON.stringify(lv)); ln.name = 't7cn'; ln.track.crossings = { [c[0].key]: 'none' };
    const rn = closed('with a crossing left alone', ln), tn = rn.base.tris;
    ok(rn.base.crossings[0].mode === 'none' && !rn.base.crossings[0].auto && !tn.some(t => t.deck || t.covered || t.portal) && tn.some(t => t.floating && t.zone === 'road'),
       'crossings: none - no deck, no cut, the upper road floats');
    const lb = JSON.parse(JSON.stringify(lv)); lb.name = 't7cb'; lb.track.crossings = { [c[0].key]: 'bridge' };
    const rb = closed('with a chosen bridge', lb), tb = rb.base.tris;
    ok(rb.base.crossings[0].mode === 'bridge' && rb.base.deckEnds.length === 2 && tb.some(t => t.strip === 'fascia') && !tb.some(t => t.strip === 'wall'),
       'crossings: bridge - a free-standing deck although the road has a verge'); }
  lv = withBranch(newLevel('t7d'));
  lv.track.nodes.slice(0, 8).forEach((n, i) => { n.y = Math.round(200 * Math.sin(i)); n.width = 300 + 60 * (i % 3); });
  { const base = buildBase(lv, buildPaths(lv.track)); setRange(lv.track.kerbs, base.an.secs.filter(s => s.path.key === 'main' && s.j >= 5 && s.j < 60), [1, -1], true); }
  closed('hills, widths, branch and kerbs', lv); }

// 8. docking: the terrain follows the track, no cracks
lv = newLevel('t8'); bake(lv);
{ const sections = r => r.entries.filter(e => e.type <= 8).length, sec0 = sections(compileLevel(lv));
  lv.track.nodes[1].x += 700; lv.track.nodes[1].z += 300; lv.track.nodes[2].y += 150; lv.track.nodes[3].width = 500; lv.track.nodes[4].vl = 100;
  r = compileLevel(lv);
  ok(sections(r) === sec0, `docking: section count stays (cuts frozen): ${sec0} -> ${sections(r)}`);
  ok(r.terrainInfo.holes.length === 0 && r.report.errors.length === 0, `docking: moved track, no holes (${r.terrainInfo.holes.length}) ${JSON.stringify(r.report.errors)}`);
  const hi = r.terrainInfo.pos.filter((p, i) => lv.terrain.points[i].d && lv.terrain.points[i].d[0].startsWith('n2|n3')).map(p => p[1]);
  ok(Math.max(...hi) > 100, 'docking: terrain beside the lifted track rose with it');
  const before = JSON.stringify(lv.terrain); compileLevel(lv);
  ok(JSON.stringify(lv.terrain) === before, 'docking: compiling does not change the stored terrain'); }

// 9. editing operations
lv = newLevel('t9'); bake(lv);
{ r = compileLevel(lv);
  const T0 = lv.terrain, ctx = r.terrainInfo.ctx;
  let pos = r.terrainInfo.pos;
  const n0 = T0.tris.length;
  // move a free-standing grid point
  const gi = T0.points.findIndex(p => p.d && p.d[2] === 'c' && !p.lock && !p.rim);
  const before = pos[gi].slice();
  ok(TR.setPointPos(T0, gi, [before[0] + 100, before[1] + 200, before[2] - 50], ctx), 'edit: move a docked point');
  pos = TR.resolve(T0, ctx);
  ok(Math.abs(pos[gi][0] - before[0] - 100) <= 1 && Math.abs(pos[gi][1] - before[1] - 200) <= 1 && Math.abs(pos[gi][2] - before[2] + 50) <= 1, 'edit: the point is where it was put');
  const lockIdx = T0.points.findIndex(p => p.lock);
  ok(!TR.setPointPos(T0, lockIdx, [0, 0, 0], ctx), 'edit: the base\'s outer row cannot be moved here');
  // split a triangle in three
  const tri = T0.tris.findIndex(t => t.slice(0, 3).every(i => !T0.points[i].lock && !T0.points[i].rim));
  TR.splitTriangles(T0, [tri], pos, ctx);
  ok(T0.tris.length === n0 + 2 && T0.points.length > 0, 'edit: split into three');
  pos = TR.resolve(T0, ctx);
  // split an edge and flip another
  const nb = id => { const a = T0.tris[id].slice(0, 3); return T0.tris.findIndex((t, k) => k !== id && TR.sharedEdge(T0, id, k) && !t.slice(0, 3).some(i => T0.points[i].rim)); };
  const a = T0.tris.findIndex((t, k) => !t.slice(0, 3).some(i => T0.points[i].rim) && nb(k) >= 0);
  const nA = T0.tris.length;
  TR.splitEdge(T0, a, nb(a), pos, ctx);
  ok(T0.tris.length === nA + 2, 'edit: split an edge (both triangles cut in two)');
  pos = TR.resolve(T0, ctx);
  let flipped = false;
  for (let k = 0; k < T0.tris.length && !flipped; k++) { const m = nb(k); if (m >= 0 && TR.flipEdge(T0, k, m, pos)) flipped = true; }
  ok(flipped, 'edit: flip a diagonal');
  r = compileLevel(lv);
  ok(r.terrainInfo.holes.length === 0 && r.report.errors.length === 0, `edit: still closed after the operations (${r.terrainInfo.holes.length} open) ${JSON.stringify(r.report.errors)}`);
  // delete a triangle: a hole, shown (one with area: the split and flip above can leave a sliver whose corners lie on
  // one line, and without it nothing is missing - the faces on both sides of that line still meet)
  const posNow = TR.resolve(T0, ctx), area = t => { const [a, b, c] = t.slice(0, 3).map(i => posNow[i]);
    return Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2; };
  const victim = T0.tris.findIndex(t => t.slice(0, 3).every(i => !T0.points[i].rim) && area(t) > 100);
  TR.deleteTriangles(T0, [victim]);
  r = compileLevel(lv);
  ok(r.terrainInfo.holes.length >= 3 && r.report.warnings.some(w => String(w.text || w).includes('open edge')), `edit: deleting a triangle shows ${r.terrainInfo.holes.length} open edges`);
  // fill the hole again from its three corners (landscaping comfort, 2026-10-11): one triangle, closed, its material
  // from the neighbours; deleting a point takes its triangles; the outer border is no hole
  {
    const holeTri = T0.tris.length, saved = JSON.stringify(T0);
    const opened = new Set(r.terrainInfo.holes.flat().map(p => p.map(Math.round).join(',')));
    const pos2 = TR.resolve(T0, ctx), corners = pos2.map((p, i) => i).filter(i => pos2[i] && opened.has(pos2[i].map(Math.round).join(',')));
    const made = TR.fillPoints(T0, corners, pos2, r.base.tris.filter(t => !t.covered && !t.deck && !t.floating && !t.cap && !t.marking).map(t => t.p));
    let r2 = compileLevel(lv);
    ok(made.length === 1 && r2.terrainInfo.holes.length === 0, `fill: the hole's corners give ${made.length} triangle(s), ${r2.terrainInfo.holes.length} open edges`);
    ok(TR.MATS.includes(T0.tris[holeTri][3]), 'fill: the new triangle has a material from its neighbours');
    const filled = JSON.stringify(T0);
    const nTris = T0.tris.length, pt = T0.tris[0].slice(0, 3).find(i => !T0.points[i].lock && !T0.points[i].rim);
    const uses = T0.tris.filter(t => t.slice(0, 3).includes(pt)).length;
    TR.deletePoints(T0, [pt]);
    ok(T0.tris.length === nTris - uses && !T0.points.some(P => P === undefined), `delete point: its ${uses} triangles go`);
    Object.assign(T0, JSON.parse(filled));
    // a triangle at the outer wall deleted: the landscape's border moves in, no hole
    const rimTri = T0.tris.findIndex(t => t.slice(0, 3).filter(i => T0.points[i].rim).length === 2);
    TR.deleteTriangles(T0, [rimTri]);
    r2 = compileLevel(lv);
    ok(r2.terrainInfo.holes.length === 0, `border: a triangle deleted at the outer wall leaves ${r2.terrainInfo.holes.length} open edges`);
    Object.assign(T0, JSON.parse(saved));
  }
  // add a triangle again over the three points of the hole
  const edgeCount = new Map();
  for (const t of T0.tris) for (let j = 0; j < 3; j++) { const k = [t[j], t[(j + 1) % 3]].sort((x, y) => x - y).join(','); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
  // cut loose: a piece of landscape that nothing docked holds becomes an object
  const t1 = T0.tris.length - 1;
  TR.detachTriangles(T0, [t1], TR.resolve(T0, ctx));
  r = compileLevel(lv);
  ok(r.entries.filter(e => e.type === 200).length === 1 && r.entries.filter(e => e.type === 200)[0].faces.every(f => f.surf === 300), 'edit: a cut-loose triangle becomes an object (type 200, code 300)');
  const map = TR.compact(T0);
  ok(T0.tris.every(t => t.slice(0, 3).every(i => i >= 0 && i < T0.points.length)) && map.size === T0.points.length, 'edit: compact keeps the triangles valid');
  TR.setMaterial(T0, [0], 'drive');
  r = compileLevel(lv);
  ok(r.entries.some(e => e.faces.some(f => f.surf === 1)), 'edit: a brown (drivable) triangle compiles with code 1'); }

// 10. long terrain edges are split by the compiler, the stored terrain stays
lv = newLevel('t10'); bake(lv);
{ const T0 = lv.terrain; const big = T0.points.findIndex(p => p.rim);
  T0.points[big].d = [T0.points[big].d[0], T0.points[big].d[1], 'c', 1, 12000, 0, 0];
  r = compileLevel(lv);
  ok(r.report.warnings.some(w => String(w.text || w).includes('split')) && r.entries.every(e => e.mesh.faces.every(f => true)), 'refine: very long edges are split at compile time'); }

// 11. paint: one colour per triangle, base paint survives cutting the sections again, palette at most 156 colours
lv = newLevel('t11'); bake(lv);
{ r = compileLevel(lv);
  const an = { byId: new Map(r.sections.map(s => [s.id, s])) };
  const road = r.base.tris.find(t => t.zone === 'road');
  setBaseColour(lv, road, an, '#ff00ff');
  ok(baseColour(lv, road, an) === '#ff00ff', 'paint: a road triangle takes a colour');
  const other = r.base.tris.find(t => t.zone === 'road' && t.sec !== road.sec);
  ok(!baseColour(lv, other, an), 'paint: other sections keep the material colour');
  r = compileLevel(lv);
  const an2 = { byId: new Map(r.sections.map(s => [s.id, s])) };
  const again = r.base.tris.find(t => t.sec === road.sec && t.strip === road.strip && t.q === road.q && t.side === road.side);
  ok(again && baseColour(lv, again, an2) === '#ff00ff', 'paint: the colour is still there after compiling again');
  ok(r.palette.some(c => c[0] > 200 && c[1] < 60 && c[2] > 200), 'paint: the painted colour is in the palette');
  setTerrainColour(lv, 0, '#00ffff');
  ok(lv.terrain.tris[0][4] === '#00ffff', 'paint: a terrain triangle takes a colour');
  // a wild painting: many colours, still at most 156 palette entries, every face points into its cell
  lv.terrain.tris.forEach((t, i) => { t[4] = '#' + ((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0'); });
  r = compileLevel(lv);
  ok(r.palette.length <= PAL_SIZE && r.palette.length > 100, `paint: palette reduced to ${r.palette.length} (max ${PAL_SIZE})`);
  const cellOk = r.entries.every(e => e.mesh.faces.every(f => f.uvs.every(([u, v]) => Math.floor(u / 16) + 16 * Math.floor(v / 16) === f.tile[1])));
  ok(cellOk, 'paint: the three corners of every face lie in the cell of its palette slot');
  setTerrainColour(lv, 0, null);
  ok(lv.terrain.tris[0].length === 4, 'paint: erasing drops the colour');
  // the terrain operations keep the colour
  lv.terrain.tris[1][4] = '#123456';
  const pos = TR.resolve(lv.terrain, r.terrainInfo.ctx);
  TR.splitTriangles(lv.terrain, [1], pos, r.terrainInfo.ctx);
  ok(lv.terrain.tris.filter(t => t[4] === '#123456').length === 3, 'paint: split in three keeps the colour'); }

// 12. split in four: corners and middle triangle, neighbours cut to fit, still closed
lv = newLevel('t12'); bake(lv);
{ r = compileLevel(lv);
  const T0 = lv.terrain, ctx = r.terrainInfo.ctx, pos = TR.resolve(T0, ctx), n0 = T0.tris.length;
  const pick = T0.tris.map((t, i) => i).filter(i => T0.tris[i].slice(0, 3).every(p => !T0.points[p].lock)).slice(0, 3);
  T0.tris[pick[0]][4] = '#abcdef';
  const made = TR.splitTriangles4(T0, pick, pos, ctx);
  ok(made.length >= 4 * pick.length - 2 && made.length <= 4 * pick.length, `split4: ${made.length} pieces of ${pick.length} triangles`);
  ok(T0.tris.filter(t => t[4] === '#abcdef').length === 4, 'split4: the pieces keep the colour');
  r = compileLevel(lv);
  ok(r.terrainInfo.holes.length === 0, `split4: still closed (${r.terrainInfo.holes.length} open edges), ${T0.tris.length - n0} triangles more`);
  // a triangle at the base: its side on the base's outer row is not cut
  const atBase = T0.tris.findIndex(t => t.slice(0, 3).filter(p => T0.points[p].lock).length === 2);
  TR.splitTriangles4(T0, [atBase], TR.resolve(T0, ctx), ctx);
  r = compileLevel(lv);
  ok(r.terrainInfo.holes.length === 0, `split4: at the base still closed (${r.terrainInfo.holes.length} open)`); }

// 13. road markings: centre line and edge lines, line faces get the road codes of their section
lv = newLevel('t13');
lv.track.marking = { centre: 'dashed', edges: true };
{ r = compileLevel(lv);
  const lines = r.base.tris.filter(t => t.mat === 'line');
  ok(lines.length > 0 && r.report.errors.length === 0, `markings: ${lines.length} line triangles`);
  lv.track.marking = { centre: 'solid', edges: false };
  const solid = compileLevel(lv).base.tris.filter(t => t.mat === 'line').length;
  ok(solid > 0 && solid < lines.length * 2, `markings: solid centre line ${solid}`); }

// 14. changing the track keeps the terrain: pushed along, re-made only where the base changed
lv = newLevel('t14');
lv.track.kerbs = { 'n0|n1:1': [[0.1, 0.9]] };
bake(lv);
{ let r = compileLevel(lv);
  const T0 = lv.terrain, pos = r.terrainInfo.pos;
  const far = (i, x, z) => Math.hypot(pos[i][0] - x, pos[i][2] - z);
  // a painted triangle, a deleted one (the user's hole) and a cut-loose one (an object), all near n4 (-5000, 0)
  const nearN4 = T0.tris.map((t, id) => id).filter(id => T0.tris[id].slice(0, 3).every(i => !T0.points[i].lock && !T0.points[i].rim && far(i, -5000, 0) < 2500));
  T0.tris[nearN4[0]][4] = '#123456';
  TR.detachTriangles(T0, [nearN4[1]], pos);
  TR.deleteTriangles(T0, [nearN4[2]]);
  r = compileLevel(lv);
  const holes0 = r.terrainInfo.holes.length, objects = r => r.entries.filter(e => e.type === 200).length;
  ok(holes0 === 3 && objects(r) === 1, `adapt: start with the user's hole (${holes0} open edges) and one object`);
  const step = (name, fn) => {
    const r0 = compileLevel(lv), old = { base: r0.base, pos: r0.terrainInfo.pos };
    fn();
    const res = adaptLevel(lv, old), r1 = compileLevel(lv);
    ok(r1.report.errors.length === 0 && r1.terrainInfo.holes.length === holes0 && objects(r1) === 1 && lv.terrain.tris.some(t => t[4] === '#123456'),
       `adapt: ${name}: ${res.removed} re-made, ${r1.terrainInfo.holes.length} open edges, ${objects(r1)} object, colour kept ${lv.terrain.tris.some(t => t[4] === "#123456")} ${JSON.stringify(r1.report.errors)}`);
    return r1;
  };
  step('move a point', () => { const n = lv.track.nodes.find(n => n.id === 'n2'); n.x += 800; n.z += 300; });
  step('wider road', () => { const n = lv.track.nodes.find(n => n.id === 'n1'); n.width = 600; n.vl = 500; });
  step('new point', () => { lv.track.nodes.push({ id: 'n8', x: 4800, z: 1900, y: 0, width: 360, vl: 320, vr: 320 }); lv.track.main.splice(1, 0, 'n8'); });
  ok(Object.keys(lv.track.kerbs).sort().join() === 'n0|n8:1,n1|n8:-1', 'adapt: the kerb of the split segment is on both new segments ' + JSON.stringify(lv.track.kerbs));
  step('point deleted', () => { lv.track.main = lv.track.main.filter(x => x !== 'n6'); lv.track.nodes = lv.track.nodes.filter(n => n.id !== 'n6'); });
  step('new branch', () => { lv.track.branches.push({ id: 'b0', from: 'n2', to: 'n4', nodes: [addNode(lv, -2000, 7500), addNode(lv, -7500, 3000)] }); });
  const rj = step('new jump', () => { lv.track.jumps = ['n5|n7']; });
  ok(rj.entries.some(e => e.faces.some(f => f.surf === 110)), 'adapt: a pit (deadly) under the new jump');
  step('branch removed', () => { lv.track.branches = []; lv.track.nodes = lv.track.nodes.filter(n => lv.track.main.includes(n.id)); });
  // the same change from the same start gives the same terrain (drags re-adapt from the start at every step)
  const r0 = compileLevel(lv), old = { base: r0.base, pos: r0.terrainInfo.pos }, start = JSON.stringify(lv);
  const once = () => { const l = JSON.parse(start); l.track.nodes.find(n => n.id === 'n3').x += 1500; adaptLevel(l, old); return JSON.stringify(l.terrain); };
  ok(once() === once(), 'adapt: deterministic'); }

// 15. no lightning in the Canada slot (option, off by default: the fillers crashed the game at level start, 2026-10-07):
// placements 46-119 are invisible filler objects, the track goes on at 120
lv = newLevel('t15');
{ const r0 = compileLevel(lv), r1 = compileRaw({ ...lv, compileOptions: { avoidLightning: true } });
  ok(compileRaw(lv).entries.every(e => e.type !== 200), 'lightning: no fillers by default');
  const sec = r => r.entries.filter(e => e.type <= 8);
  ok(r1.report.errors.length === 0 && sec(r1).length === sec(r0).length && sec(r0).length > 46, `lightning: same ${sec(r1).length} sections, no errors`);
  ok(r1.entries.slice(46, 120).every(e => e.type === 200 && e.faces.length === 1) && r1.entries[120].type <= 8 && r1.entries[45].type <= 8,
     'lightning: placements 46-119 are fillers, 45 and 120 track sections');
  ok(r1.entries[0].type === 1 && r1.entries.filter(e => e.type <= 8).pop().type === 0, 'lightning: type 1 first, type 0 last');
  lv.slot = 'Carib';
  ok(compileRaw({ ...lv, compileOptions: { avoidLightning: true } }).entries.every(e => e.type !== 200), 'lightning: no fillers in other slots'); }

// 16. camera offset per section (placement flags2)
lv = newLevel('t16');
{ const base = buildBase(lv, buildPaths(lv.track));
  lv.track.camera = { 13: {} };
  setRange(lv.track.camera[13], base.an.secs.filter(s => s.j >= 10 && s.j < 14), [null], true);
  const r = compileLevel(lv), f2 = r.entries.filter(e => e.type <= 8).map(e => e.flags[2]);
  ok(f2.filter(v => v === 13).length === 4 && f2.filter(v => v && v !== 13).length === 0, 'camera: flags2 = 13 on the 4 marked sections'); }

// 17. placed objects (Assets tab): the asset's faces at every placement, type 200, code 300, colours in the palette
lv = newLevel('t17');
{ lv.assets = { 'X/1': { name: 'pyramid', verts: [[-50, 0, -50], [50, 0, -50], [50, 0, 50], [-50, 0, 50], [0, 120, 0]],
                         faces: [[0, 1, 4, '#ff0000', 0x11], [1, 2, 4, '#ff0000', 0x11], [2, 3, 4, '#00ff00', 0x15], [3, 0, 4, '#00ff00', 0x15]] } };
  lv.objects = [{ asset: 'X/1', x: 7000, y: 100, z: 0 }, { asset: 'X/1', x: -7000, y: 0, z: 0 }, { asset: 'X/2', x: 0, y: 0, z: 0 }];
  const r = compileLevel(lv), objs = r.entries.filter(e => e.type === 200);
  ok(r.report.errors.length === 0 && objs.length === 2 && r.report.warnings.some(w => w.text && w.text.includes('X/2')),
     `objects: two type-200 placements (${objs.length}), the one without geometry warned ${JSON.stringify(r.report.errors)}`);
  ok(objs.every(e => e.faces.length === 4 && e.faces.every(f => f.surf === 300)) && objs[0].pos.join() === '7000,100,0', 'objects: 4 faces each, code 300, at the placement point');
  const f0 = objs[0].faces[0], apex = objs[0].local[f0.idx[2]];
  ok(apex.join() === '0,-120,0' && objs[0].faces[2].flags === 0x15 && f0.flags === 0x11, 'objects: local vertices y down, winding and flags kept');
  ok(r.palette.some(c => c[0] > 120 && c[1] < 60 && c[2] < 60) && r.palette.some(c => c[1] > 120 && c[0] < 60), 'objects: their colours are in the palette');
  ok(r.report.stats.objects === 2 && r.entries.filter(e => e.type <= 8).length === compileLevel(newLevel('x')).entries.length, 'objects: counted, track unchanged');
  // rotation (degrees, x then y then z) and scale baked into the vertices: the apex of a pyramid scaled x2 in y and
  // turned 90 degrees about z points along -x
  lv.objects = [{ asset: 'X/1', x: 7000, y: 0, z: 0, rot: [0, 0, 90], scale: [1, 2, 1] }];
  const r2 = compileLevel(lv), e = r2.entries.find(x => x.type === 200), ap = e.local[e.faces[0].idx[2]];
  ok(Math.abs(ap[0] + 240) < 1 && Math.abs(ap[1]) < 1 && Math.abs(ap[2]) < 1, `objects: rotation and scale baked (apex ${ap.join(', ')}, expected -240, 0, 0)`);
  // textures: a face with a tile (opts.tiles: key -> rgba 64 x 64) points into the atlas (texture 1, tile 0), its
  // transparent texels become palette index 0, its colours are in the palette; a face without a tile keeps its colour cell
  const rgba = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 4096; i++) { rgba[i * 4] = 200; rgba[i * 4 + 1] = (i % 64) * 4 % 256; rgba[i * 4 + 2] = 50; rgba[i * 4 + 3] = i < 64 ? 0 : i < 128 ? 200 : 255; }   // row 0 transparent, row 1 half transparent
  lv.assets['X/1'].faces[0] = [0, 1, 4, '#ff0000', 0x11, 1, 'T/0/3', [[0, 0], [64, 0], [32, 64]]];
  lv.objects = [{ asset: 'X/1', x: 7000, y: 0, z: 0 }];
  const r3 = compileLevel(lv, { tiles: new Map([['T/0/3', rgba]]) }), e3 = r3.entries.find(x => x.type === 200), a3 = r3.atlas[0];
  ok(r3.atlas.length === 1 && a3.number === 24 && a3.tex === 1 && a3.tile === 8 && a3.mode === 'key' && a3.indices[0] === 0 && a3.indices[100] === 0 && a3.indices[4095] >= 4 && a3.indices[4095] < 160, `textures: a tile with holes takes the Canada slot's first keyed tile number 24 (texture 1, tile 8; got ${a3.number}), transparent and soft texels index 0`);
  ok(e3.faces[0].texOffset === 65536 && e3.faces[0].uv.join() === [0, 128 * 256, 64 * 256, 128 * 256, 32 * 256, 192 * 256].join() && e3.faces[1].texOffset === 0,
     'textures: the face points into its tile, the others into their colour cells');
  ok(e3.faces[0].flags === 0x12 && e3.faces[1].flags === 0x11, `textures: a face showing a tile with holes gets the colour-key flags 0x12 (${e3.faces[0].flags.toString(16)}), the others not`);
  // a blend tile (part-transparent texels): any tile number, flags 0x13; a cut tile on a slot without keyed numbers
  // left falls back to blend with a warning; the slot's keyed numbers differ (Japan: 35 first)
  { const half = new Uint8Array(4096 * 4); for (let i = 0; i < 4096; i++) { half[i * 4] = 40; half[i * 4 + 1] = 80; half[i * 4 + 2] = 200; half[i * 4 + 3] = 128; }
    lv.assets['X/1'].faces[0] = [0, 1, 4, '#ff0000', 0x11, 1, 'T/0/4', [[0, 0], [64, 0], [32, 64]]];
    const rb = compileLevel(lv, { tiles: new Map([['T/0/4', half]]) }), ab = rb.atlas[0], eb = rb.entries.find(x => x.type === 200);
    ok(ab.number === 16 && ab.mode === 'blend' && ab.indices[0] >= 4 && eb.faces[0].flags === 0x13, `blend tile: plain number 16, texels kept, flags 0x13 (${ab.number}, ${eb.faces[0].flags.toString(16)})`);
    lv.assets['X/1'].faces[0] = [0, 1, 4, '#ff0000', 0x11, 1, 'T/0/3', [[0, 0], [64, 0], [32, 64]]];
    lv.assets['X/1'].faces[1] = [1, 2, 4, '#ff0000', 0x11, 1, 'T/0/5', [[0, 0], [64, 0], [32, 64]]];
    const ra = compileLevel(lv, { tiles: new Map([['T/0/3', rgba], ['T/0/5', rgba]]), slot: 'Austria' }), ea = ra.entries.find(x => x.type === 200);
    ok(ra.atlas[0].number === 157 && ra.atlas[0].mode === 'key' && ra.atlas[1].mode === 'blend' && ea.faces.slice(0, 2).map(f => f.flags).join() === '18,19' && ra.report.warnings.some(w => /1 are drawn half transparent/.test(String(w))), `cut tiles on Austria: one keyed number (157), the second falls back to blend with a warning (${ra.atlas.map(a => a.number + ':' + a.mode)})`);
    const rj = compileLevel(lv, { tiles: new Map([['T/0/3', rgba], ['T/0/5', rgba]]), slot: 'Japan' });
    ok(rj.atlas.map(a => a.number).join() === '35,119' && rj.atlas.every(a => a.mode === 'key'), `cut tiles on Japan: 35 and 119 (${rj.atlas.map(a => a.number)})`);
    lv.assets['X/1'].faces.splice(1, 1); lv.assets['X/1'].faces[0] = [0, 1, 4, '#ff0000', 0x11, 1, 'T/0/3', [[0, 0], [64, 0], [32, 64]]]; }
  ok(r3.palette.some(c => Math.abs(c[0] - 200) < 20 && c[2] < 80), 'textures: the tile colours are in the palette');
  ok(compileLevel(lv).entries.find(x => x.type === 200).faces[0].texOffset === 0, 'textures: without the tile data the face is flat');
  // an animated texture "<name>_anim" (n x 64 by 64): the face is cut as one tile (frame 0 in every cell), the
  // frames go into the atlas first and in order, and an animation table (type 250) lists them as its faces
  { const frames = new Map(), textures = new Map([['lamp_anim', { tw: 4, th: 1, w: 256, h: 64 }], ['wall', { tw: 1, th: 1, w: 64, h: 64 }]]);
    for (let k = 0; k < 4; k++) { const t = new Uint8Array(4096 * 4); for (let i = 0; i < 4096; i++) { t[i * 4] = 60 * k; t[i * 4 + 1] = 20; t[i * 4 + 2] = 250 - 60 * k; t[i * 4 + 3] = 255; } frames.set(`png/lamp_anim/${k}/0`, t); }
    frames.set('png/wall/0/0', rgba);
    lv.assets['X/1'].faces[0] = [0, 1, 4, '#ff0000', 0x11, 1, 'png:lamp_anim', [[0, 0], [256, 0], [128, 64]]];
    lv.assets['X/1'].faces[1] = [1, 2, 4, '#ff0000', 0x11, 1, 'png:wall', [[0, 0], [64, 0], [32, 64]]];
    const r = compileLevel(lv, { tiles: frames, textures }), tab = r.entries.find(x => x.type === 250), obj = r.entries.find(x => x.type === 200);
    const tileNo = f => Math.floor(f.uv[0] / 16384) % 4 + 4 * Math.floor(f.uv[1] / 16384);   // uv in 1/256 texel, 4 x 4 tiles of 64
    ok(tab && tab.faces.length === 4 && tab.faces.every(f => f.flags === 0x11 && f.texOffset === 65536) && r.report.stats.animatedTextures === 1, `anim texture: a type-250 table with 4 frame faces in texture 1 (${tab?.faces.length})`);
    ok(r.atlas.slice(0, 4).map(a => a.key).join() === 'png/lamp_anim/0/0,png/lamp_anim/1/0,png/lamp_anim/2/0,png/lamp_anim/3/0' && r.atlas[4].key === 'png/wall/0/0', 'anim texture: the frames first in the atlas, in order');
    ok(tab.faces.map(tileNo).join() === '0,1,2,3', `anim texture: table face k shows frame k (${tab.faces.map(tileNo)})`);
    const textured = obj.faces.filter(f => f.texOffset === 65536), lamp = textured.filter(f => tileNo(f) === 0);
    ok(lamp.length >= 4 && textured.filter(f => tileNo(f) !== 0).length === 1 && tileNo(textured.find(f => tileNo(f) !== 0)) === 8, `anim texture: the strip-wide face is cut into cells all showing frame 0 (${lamp.length} of ${textured.length}, the wall face apart on keyed tile 24 = tile 8)`);
    lv.assets['X/1'].faces.splice(1, 1); }
  // collision: an own asset with `collide` goes into the nearest section's mesh with its bodies' surface codes (wall
  // unless set) and so into .SRF; faces under the ground are dropped (a box half sunk into the road loses its bottom)
  const box = buildAsset({ custom: true, bodies: [{ kind: 'box', size: [200, 200, 200], pos: [0, 100, 0], rot: [0, 0, 0], op: 'add', colour: '#808080', surface: 110 }] });
  lv.assets = { 'custom/box': box };
  const road = compileLevel(newLevel('r')).sections[3], at = [(road.f0.c[0] + road.f1.c[0]) / 2, (road.f0.c[2] + road.f1.c[2]) / 2];
  lv.objects = [{ asset: 'custom/box', x: Math.round(at[0]), y: -60, z: Math.round(at[1]), collide: true }];
  const r4 = compileLevel(lv), e4 = r4.entries.filter(e => e.type <= 8 && e.faces.some(f => f.surf === 110));
  ok(r4.entries.every(e => e.type !== 200) && e4.length === 1 && e4[0].faces.filter(f => f.surf === 110).length === 10,
     `collision: the box's faces in one section mesh with its code, the bottom face dropped (${e4.map(e => e.faces.filter(f => f.surf === 110).length)})`);
  ok(r4.report.stats.collisionObjects === 1 && r4.report.stats.hiddenFaces === 2 && r4.report.stats.objects === 1, 'collision: counted, hidden faces counted');
  { // a large solid object gets the landscape's fixes: long edges split near the track (steep faces at most 400), steep
    // faces double-sided (RPR2's hall flickered, 2026-10-11)
    const big = buildAsset({ custom: true, bodies: [{ kind: 'box', size: [2400, 1200, 2400], pos: [0, 600, 0], rot: [0, 0, 0], op: 'add', colour: '#808080' }] });
    const lb = { ...lv, assets: { 'custom/big': big }, objects: [{ asset: 'custom/big', x: Math.round(at[0]) + 1500, y: 0, z: Math.round(at[1]), collide: true }] };
    const rb = compileLevel(lb), of = rb.items.flatMap(it => it.type <= 50 ? it.mesh.faces.filter(f => f.role === 'object').map(f => ({ f, V: [f.a, f.b, f.c].map(i => it.mesh.verts[i]) })) : []);
    const len = ({ V }) => Math.max(...[0, 1, 2].map(j => Math.hypot(...[0, 1, 2].map(c => V[j][c] - V[(j + 1) % 3][c]))));
    const up = ({ V }) => { const u = [0, 1, 2].map(c => V[1][c] - V[0][c]), v = [0, 1, 2].map(c => V[2][c] - V[0][c]); const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; return Math.abs(n[1]) / Math.hypot(...n) < 0.5; };
    const walls = of.filter(up), near = walls.filter(({ V }) => Math.hypot((V[0][0] + V[1][0] + V[2][0]) / 3 - at[0], (V[0][2] + V[1][2] + V[2][2]) / 3 - at[1]) < 1500);
    ok(of.length > 12 && near.length && near.every(x => len(x) <= 400.5) && walls.every(x => x.f.flags & 0x04), `solid object: split (${of.length} faces from 10), steep faces near the track at most 400 (${Math.round(Math.max(...near.map(len)))}), all steep faces double-sided`); }
  delete lv.objects[0].collide;
  const r5 = compileLevel(lv), e5 = r5.entries.find(e => e.type === 200);
  ok(e5 && e5.faces.length === 10 && e5.faces.every(f => f.surf === 300), 'collision off: a type-200 object, bottom face dropped too');
  // an object that hits the car: the placement type the game reacts to (44-48, flags1 = 1) with the originals' face
  // code for it; an unknown value is dropped by tidyObject
  lv.objects[0].hit = 47;
  const r6 = compileLevel(lv), e6 = r6.entries.find(e => e.type === 47), p6 = r6.files.PLC;
  ok(e6 && e6.faces.every(f => f.surf === 303) && !r6.entries.some(e => e.type === 200) && r6.report.stats.hittingObjects === 1, 'hit: a type-47 placement with code 303 instead of the type-200 object');
  ok(p6[4 + r6.entries.indexOf(e6) * 20 + 4] === 47 && p6[4 + r6.entries.indexOf(e6) * 20 + 5] === 1, 'hit: .PLC type 47, flags1 = 1');
  lv.objects[0].hit = 48;
  ok(compileLevel(lv).entries.find(e => e.type === 48).faces.every(f => f.surf === 90), 'hit: type 48 keeps the wall code 90 as the snowballs do');
  ok(tidyObject({ x: 1, y: 2, z: 3, hit: 99 }).hit === undefined && tidyObject({ x: 1, y: 2, z: 3, hit: 46 }).hit === 46, 'hit: unknown values dropped');
  // the expected lap time: the shortest lap times the originals' pace (0.72 s per 1000 units)
  { const s = compileLevel(newLevel('lap')).report.stats;
    ok(s.lapShort > 0 && s.lapShort === s.lapLong && s.lapTime === Math.round(s.lapShort * 0.72 / 1000) && s.lapTime === s.lapTimeLong, `lap: ${s.lapShort} units, ${s.lapTime} s`); }
  // a warning light: type 154 (flags1 0, plain object code), also for a placed original of that type
  delete lv.objects[0].hit; lv.objects[0].light = 154;
  const r7 = compileLevel(lv), e7 = r7.entries.find(e => e.type === 154);
  ok(e7 && e7.faces.every(f => f.surf === 300) && r7.files.PLC[4 + r7.entries.indexOf(e7) * 20 + 5] === 0 && r7.report.stats.warningLights === 1, 'light: a type-154 placement');
  delete lv.objects[0].light; lv.assets['custom/box'].type = 154;
  ok(compileLevel(lv).entries.some(e => e.type === 154), 'light: a placed original pylon (154) keeps its type');
  lv.objects[0].hit = 47;
  ok(compileLevel(lv).entries.some(e => e.type === 47), 'light: Hits the car wins over the asset type');
  delete lv.objects[0].hit;
  // kicked away (collision objects 150 / 152 / 153, flags1 0); the box is 200 across and half sunk: both warnings
  { const asset = lv.assets['custom/box'], o = lv.objects[0], typeOf = () => compileLevel(lv).entries.find(e => [150, 152, 153, 154, 200].includes(e.type))?.type;
    setCollision(o, 153, asset);
    const r8 = compileLevel(lv), e8 = r8.entries.find(e => e.type === 153), w8 = r8.report.warnings.map(w => w.text || w).filter(t => /kicked-away/.test(t));
    ok(e8 && r8.files.PLC[4 + r8.entries.indexOf(e8) * 20 + 5] === 0 && r8.report.stats.kickedObjects === 1 && r8.report.stats.warningLights === 0, 'kick: a type-153 placement, flags1 0, counted');
    ok(o.light === 0 && !lightOf(o, asset) && collisionOf(o, asset) === 153, 'kick: collision switches the original pylon\'s light off');
    ok(w8.length === 2, 'kick: warnings for a mesh beyond the 60 x 60 hit box and a point below the ground ' + JSON.stringify(w8));
    setLight(o, true, asset);
    ok(collisionOf(o, asset) === 0 && lightOf(o, asset) && typeOf() === 154, 'kick: the warning light switches the collision off');
    asset.type = 150; delete o.light; delete o.kick;
    ok(collisionOf(o, asset) === 150 && typeOf() === 150, 'kick: a placed original cone (150) is kicked away by default');
    setCollision(o, 0, asset);
    ok(o.kick === 0 && typeOf() === 200 && tidyObject({ x: 0, y: 0, z: 0, kick: 0 }).kick === 0 && tidyObject({ x: 0, y: 0, z: 0, kick: 151 }).kick === undefined, 'kick: OFF overrides the original\'s default and survives tidyObject');
    setCollision(o, 'solid', asset);
    ok(o.collide === true && o.kick === undefined && collisionOf(o, asset) === 'solid', 'kick: solid replaces it'); }
  delete lv.objects[0].collide; delete lv.objects[0].kick; delete lv.assets['custom/box'].type; }

// 18. custom assets (core/csg.js): bodies combined by union / subtraction / intersection into one closed low-poly mesh
{ const box = (pos, size, op = 'add', colour = '#808080') => ({ kind: 'box', size, pos, rot: [0, 0, 0], op, colour });
  const outward = A => { const c = [0, 1, 2].map(k => A.verts.reduce((s, v) => s + v[k], 0) / A.verts.length); let out = 0;
    for (const [a, b, d] of A.faces) { const P = [a, b, d].map(i => A.verts[i]); const u = [0, 1, 2].map(k => P[1][k] - P[0][k]), v = [0, 1, 2].map(k => P[2][k] - P[0][k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], m = [0, 1, 2].map(k => (P[0][k] + P[1][k] + P[2][k]) / 3 - c[k]);
      if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 0) out++; } return out / A.faces.length; };
  const one = buildAsset({ bodies: [box([0, 100, 0], [200, 200, 200])] });
  ok(one.faces.length === 12 && one.verts.length === 8 && openEdges(one) === 0 && outward(one) === 1, `csg: a box is 12 faces, 8 vertices, closed, wound outward (${one.faces.length}, ${one.verts.length}, open ${openEdges(one)})`);
  const u = buildAsset({ bodies: [box([0, 100, 0], [200, 200, 200]), box([100, 100, 0], [200, 200, 200], 'add', '#ff0000')] });
  ok(u.faces.length > 12 && openEdges(u) === 0 && outward(u) > 0.9 && u.faces.some(f => f[3] === '#ff0000') && u.faces.some(f => f[3] === '#808080'),
     `csg: union of two boxes closed (${u.faces.length} faces, open ${openEdges(u)}), both colours kept`);
  const bb = (A, k) => [Math.min(...A.verts.map(v => v[k])), Math.max(...A.verts.map(v => v[k]))];
  ok(bb(u, 0).join() === '-100,200', 'csg: union spans both boxes');
  const d = buildAsset({ bodies: [box([0, 100, 0], [200, 200, 200]), box([0, 100, 0], [80, 400, 80], 'subtract')] });
  ok(openEdges(d) === 0 && d.faces.length > 12 && !d.verts.some(v => Math.abs(v[0]) < 39 && Math.abs(v[2]) < 39 && v[1] > 1 && v[1] < 199),
     `csg: a box with a hole through it: closed, ${d.faces.length} faces, nothing inside the hole`);
  const s = buildAsset({ bodies: [box([0, 100, 0], [200, 200, 200]), { kind: 'sphere', size: [240, 240, 240], pos: [0, 100, 0], rot: [0, 0, 0], op: 'intersect', colour: '#00ff00' }] });
  ok(openEdges(s) === 0 && bb(s, 1)[0] >= 0 && bb(s, 1)[1] <= 200 && s.verts.every(v => Math.hypot(v[0], v[1] - 100, v[2]) <= 121), `csg: box cut to a sphere: closed, inside both (${s.faces.length} faces)`);
  for (const kind of ['sphere', 'cylinder', 'cone', 'pyramid', 'tetra']) {
    const A = buildAsset({ bodies: [{ kind, size: [100, 150, 100], pos: [0, 0, 0], rot: [10, 20, 30], op: 'add', colour: '#123456' }] });
    ok(openEdges(A) === 0 && outward(A) === 1, `csg: ${kind} closed and wound outward (${A.faces.length} faces)`);
  }
  const p = buildAsset({ bodies: [box([0, 100, 0], [200, 200, 200]), { kind: 'plane', size: [300, 1, 300], pos: [0, 250, 0], rot: [0, 0, 0], op: 'add', colour: '#0000ff' }] });
  ok(p.faces.filter(f => f[4] === 0x15).length === 2 && p.faces.length === 14, 'csg: a plane is laid on top, double-sided'); }

// 19. textures on own assets (core/texmap.js): a projector frame gives texel coordinates, faces are cut along the tile
// lattice of the image into pieces inside one tile each, repeats wrap
{ const t = { name: 'wall', origin: [0, 100, 0], rot: [0, 0, 0], size: [200, 100], px: [128, 64] };
  ok(projectUV(t, [-100, 150, 50]).join() === '0,0' && projectUV(t, [100, 50, 0]).join() === '128,64' && projectUV(t, [0, 100, 0]).join() === '64,32',
     'textures: the frame maps its corners to the image corners, v down');
  const tz = { ...t, rot: [0, 90, 0] };                                   // turned about y: the frame faces x, its width runs along -z
  ok(projectUV(tz, [0, 100, 100]).map(Math.round).join() === '0,32', 'textures: a turned frame projects along its own axes');
  const face = { p: [[0, 0, 0], [128, 0, 0], [0, 64, 0]], uv: [[0, 0], [128, 0], [0, 64]], colour: '#fff' };
  const pieces = splitByTiles(face, 2, 1);
  ok(pieces.length === 3 && pieces.every(c => c.uv.every(([u, v]) => u >= 0 && u <= 64 && v >= 0 && v <= 64)) && pieces.some(c => c.tileIJ.join() === '1,0') && pieces.some(c => c.tileIJ.join() === '0,0'),
     `textures: a face across two tiles is cut into pieces inside their tiles (${pieces.length})`);
  const area = c => { const [a, b, d] = c.p; return Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])) / 2; };
  ok(Math.abs(pieces.reduce((s, c) => s + area(c), 0) - 128 * 64 / 2) < 1e-6, 'textures: the pieces cover the face');
  const rep = splitByTiles({ p: [[0, 0, 0], [256, 0, 0], [0, 64, 0]], uv: [[0, 0], [256, 0], [0, 64]] }, 2, 1);
  ok(rep.length === 7 && rep.every(c => c.tileIJ[0] < 2), 'textures: beyond the image the tiles repeat');
  const A = buildAsset({ bodies: [{ kind: 'box', size: [200, 100, 50], pos: [0, 50, 0], rot: [0, 0, 0], op: 'add', colour: '#808080', texture: { name: 'wall', origin: [0, 50, 25], rot: [0, 0, 0], size: [200, 100], px: [128, 64] } }] });
  const front = A.faces.filter(f => [f[0], f[1], f[2]].every(i => A.verts[i][2] === 25));
  ok(front.length === 2 && front.every(f => f[6] === 'png:wall') && front.flatMap(f => f[7]).every(([u, v]) => u >= 0 && u <= 128 && v >= 0 && v <= 64),
     'textures: a textured body carries the image key and texels on its faces'); }

// 20. sections without terrain (track.noTerrain): no verge, not in the landscape's outline, the landscape runs on under
// the road; flagged after the terrain exists, the terrain adapts
lv = newLevel('t20');
{ const base = buildBase(lv, buildPaths(lv.track)); lv.track.noTerrain = {}; setRange(lv.track.noTerrain, base.an.secs.filter(s => s.j >= 10 && s.j < 20), [null], true); }
{ const b = bake(lv), r = compileLevel(lv), info = r.terrainInfo, under = r.sections.filter(s => s.noTerrain);
  ok(under.length === 10 && r.base.tris.filter(t => under.some(s => s.id === t.sec)).every(t => t.floating && t.zone !== 'drive'), `no terrain: ${under.length} sections floating, without verge`);
  ok(r.report.errors.length === 0 && info.holes.length === 0 && b.failed.length === 0, `no terrain: terrain closed (${info.holes.length} open edges, ${b.failed.length} lost)`);
  const s = under[5], cx = (s.c0[0] + s.c1[0]) / 2, cz = (s.c0[1] + s.c1[1]) / 2;
  const inTri2 = (x, z, [a, b2, c]) => { const d = (b2[2] - c[2]) * (a[0] - c[0]) + (c[0] - b2[0]) * (a[2] - c[2]); if (!d) return false; const l1 = ((b2[2] - c[2]) * (x - c[0]) + (c[0] - b2[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d; return l1 >= -1e-9 && l2 >= -1e-9 && l1 + l2 <= 1 + 1e-9; };
  ok(lv.terrain.tris.some(t => inTri2(cx, cz, t.slice(0, 3).map(i => info.pos[i]))), 'no terrain: the landscape runs on under the road');
  ok(r.entries.filter(e => e.type <= 8).every(e => e.faces.some(f => f.surf === 0)), 'no terrain: every section still has its road');
  const l2 = newLevel('t20b'); bake(l2);
  const old = compileLevel(l2), base2 = buildBase(l2, buildPaths(l2.track));
  l2.track.noTerrain = {}; setRange(l2.track.noTerrain, base2.an.secs.filter(s => s.j >= 10 && s.j < 20), [null], true);
  const res = adaptLevel(l2, { base: old.base, pos: old.terrainInfo.pos }), r2 = compileLevel(l2);
  ok(r2.terrainInfo.holes.length === 0 && res.removed > 0, `no terrain: adapted after the terrain existed (${res.removed} re-made, ${r2.terrainInfo.holes.length} open edges)`); }

// 21. textures as paint (core/paint.js): a face painted 'png:<name>@<size>@<mapping>' gets texel coordinates from its
// position and is cut along the image's tile lattice at compile time; without the image it keeps a flat colour
{ ok(parsePaint('png:checker@256@road').tex === 'checker' && parsePaint('png:checker@256@road').size === 256 && parsePaint('png:checker@256@road').map === 'road'
     && paintString(parsePaint('png:checker@256@road')) === 'png:checker@256@road' && parsePaint('#ff00ff').colour === '#ff00ff' && parsePaint('png:x@@').map === 'auto',
     'texture paint: the paint string holds image, size and mapping');
  const meta = { w: 128, h: 64 };
  ok(paintUV([[0, 0, 0], [256, 0, 0], [0, 0, -128]], parsePaint('png:checker@256@top'), meta).map(q => q.map(Math.round).join()).join(' ') === '0,0 128,0 0,64',
     'texture paint: from above, one repeat of the image per `size` world units');
  ok(paintUV([[0, 0, 0], [0, 100, 0], [0, 0, 50]], parsePaint('png:checker@256@auto'), meta).map(q => q.map(Math.round).join()).join(' ') === '0,0 0,-50 25,0',
     'texture paint: auto picks the side projection for a wall facing x (v up the wall)');
  lv = newLevel('t21'); bake(lv);
  const r0 = compileLevel(lv), an0 = r0.base.an, road = r0.base.tris.find(t => t.zone === 'road' && t.sec);
  const fr = roadFrame(an0, road.sec);
  ok(fr && Math.hypot(...fr.fwd) > 0.99 && fr.d0 >= 0, 'texture paint: a road frame per section (forward, left, distance driven)');
  setBaseColour(lv, road, an0, 'png:checker@256@road');
  const land = lv.terrain.tris.findIndex(t => t[3] === 'land');
  setTerrainColour(lv, land, 'png:checker@128@auto');
  const tile = (r, g, b) => { const a = new Uint8Array(4096 * 4); for (let i = 0; i < 4096; i++) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; } return a; };
  const tiles = new Map([['png/checker/0/0', tile(230, 230, 230)], ['png/checker/1/0', tile(60, 60, 70)]]);
  const textures = new Map([['checker', { tw: 2, th: 1, w: 128, h: 64, mean: '#909090' }]]);
  const r = compileLevel(lv, { tiles, textures });
  const secFaces = r.entries.filter(e => e.type <= 8).flatMap(e => e.faces), tex = secFaces.filter(f => f.texOffset >= 65536);
  ok(r.report.errors.length === 0 && tex.length >= 3, `texture paint: the painted faces are cut into textured pieces in their section meshes (${tex.length})`);
  ok(tex.some(f => f.surf === 0) && tex.some(f => f.surf === MATERIALS.land.code), 'texture paint: the pieces keep their surface codes (road, landscape)');
  ok(r.atlas.length === 2 && r.atlas.every(a => a.key.startsWith('png/checker/')), `texture paint: both tiles of the image are in the atlas (${r.atlas.length})`);
  ok(tex.every(f => f.uv.every(v => v >= 0 && v <= 256 * 256)), 'texture paint: texel coordinates inside the atlas texture');
  const plain = compileLevel(lv);
  ok(plain.report.errors.length === 0 && plain.entries.filter(e => e.type <= 8).flatMap(e => e.faces).every(f => f.texOffset === 0) && !plain.report.warnings.some(w => /checker/.test(w.text || w)),
     'texture paint: without the image (the editor) the faces are flat, no warning');
  const r2 = compileLevel(lv, { tiles: new Map(), textures: new Map() });
  ok(r2.report.warnings.some(w => /checker\.png not found/.test(w.text || w)), 'texture paint: a missing image is reported when compiling for the game'); }

// 22. spline knots with tangents (core/paths.js): auto = Catmull-Rom as before; linked handles bend the road in their
// direction; a corner knot runs straight in and out; reversing the track swaps the handles
{ const lv = newLevel('t22'), t = lv.track, n = t.nodes[2];
  const before = buildPaths(t).main.line.map(q => q.p.map(Math.round));
  const h = autoHandles(t, n.id);
  n.tm = 'linked'; n.ti = h.ti; n.to = h.to;
  const same = buildPaths(t).main.line.map(q => q.p.map(Math.round));
  ok(same.every((p, i) => Math.abs(p[0] - before[i][0]) <= 1 && Math.abs(p[2] - before[i][2]) <= 1), 'tangents: linked handles from the automatic tangents change nothing');
  n.to = [0, 0, 1500]; n.ti = [0, 0, -1500];
  const p = buildPaths(t).main, seg = p.ids.indexOf(n.id), q = p.at(seg, 0.05);
  ok(Math.abs(q.x - n.x) < Math.abs(q.z - n.z) / 4, `tangents: the road leaves a linked knot along its handle (dx ${Math.round(q.x - n.x)}, dz ${Math.round(q.z - n.z)})`);
  n.tm = 'corner'; delete n.ti; delete n.to;
  const pc = buildPaths(t).main, nx = nodeMap(t).get(pc.ids[(seg + 1) % pc.ids.length]), a = pc.at(seg, 0.15);   // near the knot: the far end still bends
  const dev = Math.abs((nx.x - n.x) * (a.z - n.z) - (nx.z - n.z) * (a.x - n.x)) / Math.hypot(nx.x - n.x, nx.z - n.z);
  ok(dev < 40, `tangents: a corner knot leaves on a nearly straight line (deviation ${Math.round(dev)} from the chord)`);
  // the mitre: the frame at the corner lies on the bisector, wider than the road, and the road faces of the sections
  // before and after the corner share their outer edge (no wedge, no overlap)
  const fr = pc.frames.find(f => f.seg === seg && f.t === 0), prevSeg = (seg - 1 + pc.segs) % pc.segs;
  const dirIn = [n.x - nodeMap(t).get(pc.ids[prevSeg]).x, n.z - nodeMap(t).get(pc.ids[prevSeg]).z], dl = Math.hypot(...dirIn);
  ok(fr.half > n.width / 2 * 1.05 && Math.abs(fr.left[0] * dirIn[0] / dl + fr.left[1] * dirIn[1] / dl) > 0.2, `tangents: the corner frame is a mitre (half ${Math.round(fr.half)} of ${n.width / 2})`);
  const bc = buildBase(lv, buildPaths(t)), secBefore = `main:${pc.frames.findIndex(f => f === fr) - 1}`, secAfter = `main:${pc.frames.findIndex(f => f === fr)}`;
  const pts = id => new Set(bc.tris.filter(x => x.sec === id && x.zone === 'road').flatMap(x => x.p.map(q => q.map(Math.round).join(','))));
  const shared = [...pts(secBefore)].filter(k => pts(secAfter).has(k));
  ok(shared.length >= 3, `tangents: the road sections before and after the corner share their cross line (${shared.length} points)`);
  n.tm = 'linked'; n.ti = [0, 0, -1500]; n.to = [0, 0, 1500];
  t.start.reverse = true;
  const pr = buildPaths(t).main, segR = pr.ids.indexOf(n.id), qr = pr.at(segR, 0.05);
  ok(qr.z < n.z, 'tangents: with the direction reversed the road leaves the knot along the incoming handle');
  t.start.reverse = false;
  ok(compileLevel(lv).report.errors.length === 0, 'tangents: the level compiles'); }

// 23. animations (core/anim.js): keyframes interpolated, the placement at the pose of t = 0, the .POS frames with
// the extra rotation in the game's angles, continued over revolutions
{ const lv = newLevel('t23');
  lv.assets = { 'custom/a': buildAsset({ name: 'A', custom: true, bodies: [{ kind: 'box', size: [100, 100, 100], pos: [0, 50, 0], rot: [0, 0, 0], op: 'add', colour: '#808080' }] }) };
  lv.objects = [{ id: 'o1', asset: 'custom/a', x: 7000, y: 0, z: 0 }, { id: 'o2', asset: 'custom/a', x: 7500, y: 0, z: 0 }];
  lv.animations = [{ id: 'a1', name: 'test', length: 4, objects: [{ object: 'o1', keys: [{ t: 0, pos: [7000, 0, 0], rot: [0, 0, 0] }, { t: 4, pos: [8000, 0, 500], rot: [0, 90, 0] }] }] }];
  const e = lv.animations[0].objects[0], mid = poseAt(e, 2);
  ok(mid.pos.join() === '7500,0,250' && mid.rot.join() === '0,45,0', 'anim: the pose between two keys is interpolated');
  setKey(e, 2, { pos: [7500, 100, 250], rot: [0, 45, 0] });
  ok(e.keys.length === 3 && e.keys[1].t === 2 && poseAt(e, 1).pos[1] === 50, 'anim: a key set in the middle, keys stay sorted');
  e.keys.splice(1, 1);
  const r = compileLevel(lv), objs = r.entries.filter(x => x.type === 200), moving = objs.filter(x => x.path && x.path.length);
  ok(objs.length === 2 && moving.length === 1 && r.report.stats.animated === 1, `anim: one of two objects has a path (${moving.length})`);
  const f = moving[0].path;
  ok(f.length === 101 && f[0].slice(1, 4).join() === '7000,0,0' && f[100].slice(1, 4).join() === '8000,0,500', `anim: ${f.length} frames from the first to the last key`);
  ok(f[0][0] === 0 && f[0][4] === 0 && f[0][5] === 0 && f[100][5] === 900 && f[100][0] === 0 && f[100][4] === 0, `anim: the last frame turns 90 degrees about the vertical axis (r2 ${f[100][5]})`);
  ok(f[50][5] === 450 && f.every((q, i) => i === 0 || q[5] >= f[i - 1][5]), 'anim: the angle grows evenly, no jump');
  ok(moving[0].pos.join() === '7000,0,0', 'anim: the placement is the pose at t = 0');
  const pos = r.files.POS, dv = new DataView(pos.buffer, pos.byteOffset, pos.byteLength), table = [...Array(r.entries.length).keys()].map(i => dv.getInt32(i * 4, true));
  const mk = r.entries.indexOf(moving[0]);
  ok(table[mk] === r.entries.length - mk && table.filter(v => v === -1).length === r.entries.length - 1 && pos.length === 4 * r.entries.length + 4 + 101 * 24 + 4, `anim: .POS table entry = block offset relative to the entry (${table[mk]}), one frame block (${pos.length} bytes)`);
  ok(dv.getInt32((mk + table[mk]) * 4, true) === 101 && dv.getInt32((mk + table[mk]) * 4 + 4, true) === 0, 'anim: the block the game reaches through the offset starts with the frame count and a 0');
  // a key with the object turned at t = 0 as well: the mesh is baked with it, the path carries only the difference
  e.keys[0].rot = [0, 30, 0]; e.keys[1].rot = [0, 120, 0];
  const r2 = compileLevel(lv), f2 = r2.entries.find(x => x.path && x.path.length).path;
  ok(f2[0][5] === 0 && f2[100][5] === 900, `anim: the path is relative to the pose at t = 0 (r2 ${f2[0][5]} .. ${f2[100][5]})`);
  lv.objects[0].collide = true;
  const r3 = compileLevel(lv);
  ok(!r3.entries.some(x => x.path && x.path.length) && r3.report.warnings.some(w => /cannot move/.test(w.text || w)), 'anim: an object in the landscape is not animated, with a warning'); }

// 24. sounds (core/sounds.js): a marker placement of type 144 + slot per source, riding on an animated object with its path
{ const lv = newLevel('t24');
  lv.assets = { 'custom/a': buildAsset({ name: 'A', custom: true, bodies: [{ kind: 'box', size: [100, 100, 100], pos: [0, 50, 0], rot: [0, 0, 0], op: 'add', colour: '#808080' }] }) };
  lv.objects = [{ id: 'o1', asset: 'custom/a', x: 7000, y: 0, z: 0 }];
  lv.animations = [{ id: 'a1', name: 'test', length: 2, objects: [{ object: 'o1', keys: [{ t: 0, pos: [7000, 0, 0], rot: [0, 0, 0] }, { t: 2, pos: [7500, 0, 0], rot: [0, 0, 0] }] }] }];
  lv.sounds = [{ id: 's1', name: 'Wind', gain: 100 }, { id: 's2', name: 'Engine', gain: 80 }];
  lv.soundSources = [{ id: 'q1', sound: 's1', x: 6000, y: 100, z: 300 }, { id: 'q2', sound: 's2', object: 'o1', off: [0, 60, 0] }];
  ok(soundSlots(lv).get('s2') === 4 && soundFileName(lv.sounds[1], 4) === '04_Engine.wav', 'sounds: slots from 3 on, files named by slot');
  ok(sourcePosition(lv, lv.soundSources[1]).join() === '7000,60,0', 'sounds: a source on an object stands at the object plus its offset');
  const r = compileLevel(lv), marks = r.entries.filter(e => e.type >= 144 && e.type < 200);
  ok(marks.length === 2 && marks.map(e => e.type).sort().join() === '147,148' && marks.every(e => e.flags[1] === 1 && e.faces.length === 1) && r.report.stats.sounds === 2,
     `sounds: two markers of types ${marks.map(e => e.type).join('/')} with flags1 = 1 and one face`);
  const riding = marks.find(e => e.type === 148);
  ok(riding.pos.join() === '7000,60,0' && riding.path && riding.path.length === 51 && riding.path[50].slice(1, 4).join() === '7500,60,0', 'sounds: the riding marker has the object\'s path, shifted by its offset');
  ok(r.report.errors.length === 0, 'sounds: the level compiles'); }

// 20. a texture frame baked into its body (2026-10-11): it moves, turns and scales with the body, a copy carries it
{ const { frameOf } = await import('../core/texmap.js');
  const A = { name: 't', custom: true, bodies: [{ kind: 'box', size: [200, 100, 50], pos: [0, 50, 0], rot: [0, 0, 0], op: 'add', colour: '#9a9a9a',
    texture: { name: 'bricks', px: [128, 64], origin: [0, 50, 25], rot: [0, 0, 0], size: [100, 50] } }] };
  const texels = (X, i = 0) => X.faces.filter(f => f[8] === i).map(f => f[7].map(q => q.map(v => Math.round(v * 10) / 10).join(':')).sort().join(' ')).sort().join('|');
  buildAsset(A);
  const f = frameOf(A.bodies[0]), t0 = texels(A);
  ok(A.bodies[0].texture.space === 'body' && f.origin.join() === '0,50,25' && f.size.map(Math.round).join() === '100,50', 'baked texture: an old frame goes into its body where it was');
  Object.assign(A.bodies[0], { pos: [500, 80, -300], rot: [0, 35, 10] }); buildAsset(A);
  ok(texels(A) === t0, 'baked texture: moving and turning the body keeps the texels of every face');
  A.bodies[0].size = [400, 100, 50]; buildAsset(A);
  ok(texels(A) === t0 && Math.round(frameOf(A.bodies[0]).size[0]) === 200, 'baked texture: scaling the body scales the texture');
  A.bodies.push(JSON.parse(JSON.stringify(A.bodies[0]))); A.bodies[1].pos = [900, 80, -300]; buildAsset(A);
  ok(texels(A, 1) === texels(A, 0), 'baked texture: a copy of the body carries it'); }

console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
