// Inspect (the ? button, F1): a tooltip on the point under the mouse (control point in Track, terrain point in
// Landscape) or else on the face there, with the surface behaviour, the section's placement and flags. Clicks do
// nothing while it is on.
import { TYPE } from '/core/compile.js';
import { nodeRole, DEFAULT_WIDTH, DEFAULT_VERGE } from '/core/model.js';
import { inRange } from '/core/sections.js';
import { MATERIALS } from '/core/materials.js';
import { baseColour, parsePaint, materialColour } from '/core/paint.js';
import { hex } from '/core/palette.js';
import { $, S, esc, T, tinfo, secMap, assetOf } from './state.js';
import { host, canvas, toScreen } from './views.js';
import { faceAt } from './pick.js';

let tipAt = 0;
export function setInspect(on) {
  S.inspectOn = on;
  $('inspect').classList.toggle('on', on);
  if (!on) $('tip').hidden = true;
  canvas.style.cursor = on ? 'help' : '';
}
$('inspect').onclick = () => { setInspect(!S.inspectOn); $('inspect').blur(); };
const faceGeom = p => {                       // slope (degrees) of a face, game coordinates
  const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...n);
  return { slope: len ? Math.round(Math.acos(Math.min(1, Math.abs(n[1]) / len)) * 180 / Math.PI) : 0 };
};
// what a face does in the game, by its material (LEVELFORMAT.md ch. 17)
const SURFACE = { road: 'Road, drivable', ramp: 'Ramp road: the car lifts off at the edge', drive: 'Drivable ground', land: 'Landscape, not drivable (wall)',
  dead: 'Deadly ground', roadSlip: 'Slippery road', roadOrder: 'Road, deadly if driven in the wrong order', driveOrder: 'Verge, deadly if driven in the wrong order',
  line: 'Road marking (as the road around it)', kerbIn: 'Kerb (wall)', kerbTop: 'Kerb (wall)', kerbOut: 'Kerb (wall)', deck: 'Bridge deck (wall)',
  edge: 'Drop edge: drivable, the car lifts off at the edge', kerbGround: 'Ground under a kerb' };
const SEC_TYPE = { [TYPE.START]: 'last section', [TYPE.FIRST]: 'first section', [TYPE.SECTION]: 'section', [TYPE.FORK]: 'fork', [TYPE.PATH_A]: 'branch',
  [TYPE.PATH_B]: 'main loop beside a branch', [TYPE.MERGE]: 'merge', [TYPE.JUMP]: 'next to a jump gap' };
const ZONE = { road: 'Road', line: 'Marking', kerbIn: 'Kerb, inner side', kerbTop: 'Kerb top', kerbOut: 'Kerb, outer side', verge: 'Verge', deck: 'Bridge deck' };
const REF = { c: 'centre line', e: 'road edge', v: 'verge edge', k1: 'kerb row 1', k2: 'kerb row 2', k3: 'kerb row 3' };
const signName = n => { const o = [...$('signSel').options].find(x => Number(x.value) === n); return o ? o.text.replace(/ \(untested\)$/, '') : String(n); };
const sideName = d => (d > 0 ? 'left' : d < 0 ? 'right' : '');
// rows about the section a base face lies in: placement, type, flags that the face itself does not show
function sectionRows(id) {
  const s = secMap().byId.get(id);
  if (!s) return [];
  const items = S.compiled.items || [];
  const k = items.findIndex(it => it.section && `${it.section.path}:${it.section.j}` === id), it = k >= 0 ? items[k] : null;
  const t = S.level.track, flags = [];
  const sides = (map, name) => { const l = inRange(map || {}, s, 1), r = inRange(map || {}, s, -1); if (l || r) flags.push(`${name} ${l && r ? 'both sides' : l ? 'left' : 'right'}`); };
  sides(t.kerbs, 'kerbs'); sides(t.noVerge, 'no verge');
  if (s.jump) flags.push('jump gap');
  if (inRange(t.noTerrain, s)) flags.push('no terrain');
  const rows = [['Section', `${esc(s.id)}${it ? `, placement ${k}` : ''}`]];
  if (it) rows.push(['Type', `${it.type} ${SEC_TYPE[it.type] || ''}`]);
  rows.push(['Flags', flags.join(', ') || 'none']);
  if (it?.flags3) rows.push(['Sign', signName(it.flags3)]);
  if (it?.flags2) rows.push(['Camera', `${it.flags2} (${it.flags2 > 10 ? '+' : '-'}${(it.flags2 > 10 ? it.flags2 - 10 : it.flags2) * 50})`]);
  return rows;
}
// {title, rows: [[label, value], ...]} for the point under the cursor or else the face there; null when nothing is there
export function describeAt(v, px, py) {
  const { level, mode, tab } = S, info = tinfo();
  let best = null, bd = 8;
  const tryPt = (pos, make) => {
    const [sx, sy, sz] = toScreen(v, T(pos[0], pos[1] + 10, pos[2]));
    if (!(sz > -1 && sz < 1)) return;
    const d = Math.hypot(sx - px, sy - py);
    if (d < bd) { bd = d; best = make; }
  };
  if (mode === 'track') for (const n of level.track.nodes) tryPt([n.x, n.y ?? 0, n.z], () => {
    const r = nodeRole(level.track, n.id), roles = [];
    if (n.id === level.track.start?.node) roles.push('start');
    for (const b of r.endpointOf) roles.push(`${b.from === n.id ? 'fork' : 'merge'} of branch ${esc(b.id)}`);
    if ((level.track.jumps || []).some(k => k.split('|').includes(n.id))) roles.push('at a jump gap');
    return { title: `Control point ${esc(n.id)}`, rows: [
      ['On', r.main >= 0 ? `main loop, point ${r.main}` : r.branch ? `branch ${esc(r.branch.id)}` : '-'],
      ...(roles.length ? [['Role', roles.join(', ')]] : []),
      ['Height', String(Math.round(n.y ?? 0))],
      ['Width', String(n.width ?? DEFAULT_WIDTH)],
      ['Verge', `left ${n.vl ?? DEFAULT_VERGE}, right ${n.vr ?? DEFAULT_VERGE}`]] };
  });
  if (tab === 'landscape' && info) level.terrain.points.forEach((P, i) => { if (info.pos[i]) tryPt(info.pos[i], () => {
    const used = level.terrain.tris.filter(t => t[0] === i || t[1] === i || t[2] === i).length;
    const dock = P.d ? `segment ${esc(P.d[0])}, ${REF[P.d[2]] || P.d[2]}${P.d[3] ? ' ' + sideName(P.d[3]) : ''}${Math.round(P.d[4]) ? `, ${Math.round(P.d[4])} out` : ''}` : 'free (stays when the track moves)';
    return { title: `Terrain point ${i}`, rows: [
      ['Docked', dock + (P.lock ? '; locked, belongs to the road' : '') + (P.rim ? '; outer rim' : '')],
      ['Height', String(Math.round(info.pos[i][1]))],
      ['Triangles', String(used)]] };
  }); });
  if (mode === 'assets' || mode === 'anim') (level.objects || []).forEach((o, i) => tryPt([o.x, o.y, o.z], () => {
    const A = assetOf(o.asset);
    return { title: `Object ${i}`, rows: [['Asset', esc(A?.name || o.asset)], ['Faces', String(A ? A.faces.length : '?')], ['Position', `${o.x}, ${o.z}`], ['Height', String(o.y)]] };
  }));
  if (best) return best();
  const f = faceAt(v, px, py);
  if (!f) return null;
  const g = faceGeom(f.p), code = MATERIALS[f.mat].code;
  const painted = parsePaint(f.kind === 'base' ? baseColour(level, f.t, secMap()) : level.terrain.tris[f.id][4]);
  const MAPS = { auto: 'auto', road: 'along the road', top: 'from above', front: 'from the front', side: 'from the side' };
  const colour = painted?.tex ? `texture ${esc(painted.tex)}, size ${painted.size}, ${MAPS[painted.map]}` : painted ? `painted ${painted.colour}` : `material, ${materialColour(f.mat, level)}`;
  if (f.kind === 'terrain') {
    const floating = info.comps.some(c => !c.docked && c.tris.includes(f.id));
    return { title: `Terrain triangle ${f.id}`, rows: [
      ['Surface', `${SURFACE[f.mat] || f.mat}, code ${code}`],
      ...(floating ? [['Object', 'separate (not connected to the landscape)']] : []),
      ['Colour', colour], ['Slope', `${g.slope}°`]] };
  }
  const t = f.t, part = t.marking ? 'Marking' : ZONE[t.zone] || esc(t.zone);
  return { title: `${part} face`, rows: [
    ['Surface', `${SURFACE[f.mat] || f.mat}, code ${code}`],
    ...(sideName(t.side) ? [['Side', sideName(t.side) + ' of the driving direction']] : []),
    ...sectionRows(t.sec),
    ['Colour', colour], ['Slope', `${g.slope}°`]] };
}
export function showTip(v, px, py) {
  const el = $('tip');
  if (!v || !S.level) { el.hidden = true; return; }
  const now = performance.now();
  if (now - tipAt < 60) return;
  tipAt = now;
  const d = describeAt(v, px, py);
  if (!d) { el.hidden = true; return; }
  el.innerHTML = `<b>${d.title}</b><table>${d.rows.map(([k, val]) => `<tr><td>${k}</td><td>${val}</td></tr>`).join('')}</table>`;
  el.hidden = false;
  let x = px + 16, y = py + 16;
  if (x + el.offsetWidth > host.clientWidth) x = Math.max(0, px - 16 - el.offsetWidth);
  if (y + el.offsetHeight > host.clientHeight) y = Math.max(0, py - 16 - el.offsetHeight);
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
canvas.addEventListener('pointerleave', () => { $('tip').hidden = true; });
