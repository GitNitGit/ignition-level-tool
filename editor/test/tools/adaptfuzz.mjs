// random track changes with adaptLevel, compared with a fresh bake after each step:
//   node adaptfuzz.mjs <seed> new|myfirst <steps>   (STOP=1: stop at the first worse step, writes fuzzprev/fuzzafter.json)
import { readFileSync } from 'node:fs';
import * as fs2 from 'node:fs';
const E = new URL('../../core/', import.meta.url).href;
const { newLevel, nextId, edgeKey } = await import(E + 'model.js');
const { compileLevel: CL } = await import(E + 'compile.js');
const compileLevel = lv => CL({ ...lv, compileOptions: { avoidLightning: false } });
const { buildPaths } = await import(E + 'paths.js');
const { buildBase } = await import(E + 'base.js');
const { bakeTerrain } = await import(E + 'bake.js');
const { adaptLevel } = await import(E + 'adapt.js');

let seed = Number(process.argv[2] || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const bake = lv => { const paths = buildPaths(lv.track), base = buildBase(lv, paths), b = bakeTerrain(lv, paths, base); lv.terrain = b.terrain; lv.track.cuts = b.cuts; return b; };

const start = process.argv[3] === 'myfirst' ? JSON.parse(readFileSync(new URL('../../../data/levels/MyFirst/level.json', import.meta.url), 'utf8')) : (() => { const l = newLevel('f'); l.track.kerbs = { 'n0|n1:1': [[0, 1]], 'n3|n4:-1': [[0.2, 0.8]] }; bake(l); return l; })();
let lv = start, bad = 0;
const N = Number(process.argv[4] || 40);
for (let s = 0; s < N; s++) {
  const r0 = compileLevel(lv);
  if (r0.report.errors.length) { console.log('errors before step', s, r0.report.errors.map(e => e.text || e)); break; }
  const prev = JSON.stringify(lv);
  const old = { base: r0.base, pos: r0.terrainInfo.pos };
  const t = lv.track, main = t.main;
  const op = pick(['move', 'move', 'width', 'insert', 'delete', 'jump', 'branch', 'unbranch', 'height']);
  let what = op;
  if (op === 'move') { const n = pick(t.nodes); const dx = (rnd() - 0.5) * 3000, dz = (rnd() - 0.5) * 3000; n.x = Math.round(n.x + dx); n.z = Math.round(n.z + dz); what += ' ' + n.id; }
  if (op === 'height') { const n = pick(t.nodes); n.y = Math.round((n.y || 0) + (rnd() - 0.5) * 800); what += ' ' + n.id; }
  if (op === 'width') { const n = pick(t.nodes); n.width = Math.round(250 + rnd() * 400); n.vl = Math.round(20 + rnd() * 500); what += ' ' + n.id; }
  if (op === 'insert') {
    const i = Math.floor(rnd() * main.length), a = t.nodes.find(n => n.id === main[i]), b = t.nodes.find(n => n.id === main[(i + 1) % main.length]);
    const id = nextId(t.nodes, 'n');
    t.nodes.push({ id, x: Math.round((a.x + b.x) / 2 + (rnd() - 0.5) * 1000), z: Math.round((a.z + b.z) / 2 + (rnd() - 0.5) * 1000), y: 0, width: 360, vl: 320, vr: 320 });
    main.splice(i + 1, 0, id); what += ' ' + id;
    const j = new Set(t.jumps); if (j.delete(edgeKey(a.id, b.id))) { j.add(edgeKey(a.id, id)); j.add(edgeKey(id, b.id)); } t.jumps = [...j];
  }
  if (op === 'delete') {
    const cand = main.filter(id => id !== t.start.node && !t.branches.some(b => b.from === id || b.to === id));
    if (main.length <= 5 || !cand.length) continue;
    const id = pick(cand);
    t.main = main.filter(x => x !== id); t.nodes = t.nodes.filter(n => n.id !== id); t.jumps = t.jumps.filter(k => !k.split('|').includes(id)); what += ' ' + id;
  }
  if (op === 'jump') { const i = Math.floor(rnd() * main.length), k = edgeKey(main[i], main[(i + 1) % main.length]); const j = new Set(t.jumps); j.has(k) ? j.delete(k) : j.add(k); t.jumps = [...j]; what += ' ' + k; }
  if (op === 'branch') {
    if (t.branches.length) continue;
    const i = 1 + Math.floor(rnd() * (main.length - 3)), a = main[i], b = main[i + 2];
    const na = t.nodes.find(n => n.id === a), nb = t.nodes.find(n => n.id === b);
    const cx = 0, cz = 0, mk = f => { const x = na.x + (nb.x - na.x) * f, z = na.z + (nb.z - na.z) * f, d = Math.hypot(x - cx, z - cz) || 1; const id = nextId(t.nodes, 'n'); t.nodes.push({ id, x: Math.round(x + (x - cx) / d * 2500), z: Math.round(z + (z - cz) / d * 2500), y: 0, width: 360, vl: 320, vr: 320 }); return id; };
    const n1 = mk(1 / 3), n2 = mk(2 / 3);
    t.branches.push({ id: 'b0', from: a, to: b, nodes: [n1, n2] }); what += ' ' + a + '-' + b;
  }
  if (op === 'unbranch') { if (!t.branches.length) continue; t.branches = []; t.nodes = t.nodes.filter(n => t.main.includes(n.id)); t.jumps = t.jumps.filter(k => k.split('|').every(id => t.main.includes(id))); }
  const r1 = compileLevel(lv);
  if (r1.report.errors.length) { lv = JSON.parse(prev); continue; }   // invalid tracks and bridges: not here       // the editor would show errors; skip invalid tracks
  const T0 = performance.now();
  const res = adaptLevel(lv, old);
  const ms = performance.now() - T0;
  const r = compileLevel(lv);
  const holes = r.terrainInfo.holes.length, objs = r.entries.filter(e => e.type === 200).length;
  const fresh = JSON.parse(JSON.stringify(lv)); delete fresh.track.cuts; const fb = bake(fresh);
  const bakeHoles = compileLevel(fresh).terrainInfo.holes.length;
  const worse = (holes > bakeHoles && !fb.warnings.length) || objs;
  if (worse) bad++;
  if (worse && process.env.STOP) {
    console.log(what, res);
    const P0 = JSON.parse(prev).terrain;
    for (const [a, b] of r.terrainInfo.holes) { const f = p => r.terrainInfo.pos.findIndex(q => q && Math.round(q[0]) === Math.round(p[0]) && Math.round(q[2]) === Math.round(p[2])); const ia = f(a), ib = f(b); console.log('   hole', a.map(Math.round), b.map(Math.round), ia, JSON.stringify(lv.terrain.points[ia]), ib, JSON.stringify(lv.terrain.points[ib])); }
    fs2.writeFileSync('fuzzprev.json', prev); fs2.writeFileSync('fuzzafter.json', JSON.stringify(lv));
    break;
  }
  console.log(String(s).padStart(3), what.padEnd(22), 'removed', String(res.removed).padStart(4), 'added', String(res.added).padStart(4), 'tris', lv.terrain.tris.length, 'holes', holes, '(bake ' + bakeHoles + ')', 'objects', objs, ms.toFixed(0) + 'ms', r.report.warnings.filter(w => !String(w.text || w).includes('Long')).map(w => String(w.text || w).slice(0, 60)).join('; '));
}
console.log('bad steps', bad);
