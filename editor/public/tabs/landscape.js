// The Landscape tab (mode 2, terrain): generate the terrain, pick points or triangles, the editing operations
// (split, flip, delete, add, cut loose, free, material, height), remove the terrain. Paint is its own tab (tools/paint.js).
import { buildPaths } from '/core/paths.js';
import { buildBase } from '/core/base.js';
import { bakeTerrain, BAKE_DEFAULTS } from '/core/bake.js';
import * as TR from '/core/terrain.js';
import * as THREE from '../vendor/three.module.js';
import { views, axes, rayAt, toScreen } from '../views.js';
import { $, S, sel, status, hasTerrain, tinfo, tpos, positionsOf, setPositions, T3 } from '../state.js';
import { change } from '../edit.js';
import { draw } from '../draw.js';
import { syncPanel, setMode } from '../panels.js';

const BAKE_FIELDS = [['gBand', 'band', 100, 800], ['gCell', 'cell', 500, 3000], ['gMargin', 'margin', 1000, 15000],
                     ['gPit', 'pit', 100, 3000], ['gRim', 'rim', 100, 3000], ['gMax', 'maxEdge', 1000, 3200]];
for (const [id, k] of BAKE_FIELDS) $(id).value = BAKE_DEFAULTS[k];
const bakeOpts = () => Object.fromEntries(BAKE_FIELDS.map(([id, k, lo, hi]) => [k, Math.max(lo, Math.min(hi, Number($(id).value) || BAKE_DEFAULTS[k]))]));

export function syncTerrainPanel() {
  const { level, pickTris } = S, has = hasTerrain();
  $('tGen').hidden = has; $('tTools').hidden = !has;
  const info = tinfo();
  $('tInfo').textContent = has
    ? `${level.terrain.points.length} points, ${level.terrain.tris.length} triangles` + (info.holes.length ? `, ${info.holes.length} open edges (red)` : ', no holes')
      + (info.comps.some(c => !c.docked) ? `, ${info.comps.filter(c => !c.docked).length} floating object(s)` : '')
    : 'No terrain yet.';
  if (!has) return;
  const np = sel.points.size, nt = sel.tris.size;
  $('tSelProps').hidden = !np || pickTris;
  if (np) {
    const ys = [...new Set([...positionsOf(sel.points).values()].map(p => Math.round(p[1])))];
    if (document.activeElement !== $('tHeight')) { $('tHeight').value = ys.length === 1 ? ys[0] : ''; $('tHeight').placeholder = ys.length > 1 ? 'mixed' : ''; }
  }
  const two = nt === 2 && TR.sharedEdge(level.terrain, ...[...sel.tris]);
  $('tSplit3').disabled = !nt; $('tSplit4').disabled = !nt; $('tDelete').disabled = !nt; $('tLoose').disabled = !nt; $('tToPoints').disabled = !nt;
  $('tSplitEdge').disabled = !two; $('tFlip').disabled = !two;
  $('tAdd').disabled = np !== 3; $('tFree').disabled = !np;
  $('tFill').disabled = np < 3; $('tDelPts').disabled = !np; $('tCopy').disabled = !trisToCopy().length; $('tPaste').disabled = !S.clipboard;
}
function terrainOp(fn) {
  if (!hasTerrain()) return;
  change(fn);
}
// switching between points and triangles drops the selection (user's wish)
export function setPick(tris) {
  if (tris !== S.pickTris) { sel.points.clear(); sel.tris.clear(); }
  S.pickTris = tris; draw(); syncPanel();
}
// the tool group of the Landscape tab: points or triangles
$('pickPoints').onchange = () => setPick(false);
$('pickTris').onchange = () => setPick(true);
$('tSplit3').onclick = () => terrainOp(() => { const ids = TR.splitTriangles(S.level.terrain, [...sel.tris], tpos(), tinfo().ctx); sel.tris = new Set(ids); });
$('tSplit4').onclick = () => terrainOp(() => { const ids = TR.splitTriangles4(S.level.terrain, [...sel.tris], tpos(), tinfo().ctx); sel.tris = new Set(ids); });
$('tSplitEdge').onclick = () => terrainOp(() => {
  const ids = TR.splitEdge(S.level.terrain, ...[...sel.tris], tpos(), tinfo().ctx);
  if (ids) sel.tris = new Set(ids);
});
$('tFlip').onclick = () => terrainOp(() => { if (!TR.flipEdge(S.level.terrain, ...[...sel.tris], tpos())) status('That quad is not convex: the diagonal cannot be swapped.', 'warn'); });
// the free points only these triangles used go with them (2026-10-11, user)
export function deleteTris() { if (sel.tris.size) terrainOp(() => { TR.deleteTrianglesAndPoints(S.level.terrain, [...sel.tris]); sel.tris.clear(); sel.points.clear(); S.anchor = null; }); }
$('tDelete').onclick = deleteTris;
$('tAdd').onclick = () => terrainOp(() => {
  const [a, b, c] = [...sel.points];
  const id = TR.addTriangle(S.level.terrain, a, b, c, S.newMat, tpos());
  if (id >= 0) { sel.tris = new Set([id]); sel.points.clear(); S.pickTris = true; }
});
$('tToPoints').onclick = () => {
  const pts = new Set();
  for (const id of sel.tris) for (const i of S.level.terrain.tris[id].slice(0, 3)) pts.add(i);
  sel.points = pts; sel.tris.clear(); S.pickTris = false; draw(); syncPanel();
};
$('tLoose').onclick = () => terrainOp(() => { TR.detachTriangles(S.level.terrain, [...sel.tris], tpos()); });
$('tFree').onclick = () => terrainOp(() => { TR.freePoints(S.level.terrain, [...sel.points], tpos()); });
$('tClean').onclick = () => terrainOp(() => { TR.compact(S.level.terrain); sel.points.clear(); sel.tris.clear(); });
for (const [id, mat] of [['mLand', 'land'], ['mDrive', 'drive'], ['mDead', 'dead'], ['mEdge', 'edge']]) {
  $(id).onclick = () => {
    S.newMat = mat;
    if (sel.tris.size) terrainOp(() => TR.setMaterial(S.level.terrain, [...sel.tris], mat));
  };
}
$('tHeight').onchange = () => {
  const v = Number($('tHeight').value);
  if ($('tHeight').value === '' || !Number.isFinite(v)) return;
  change(() => setPositions(new Map([...positionsOf(sel.points)].map(([id, p]) => [id, [p[0], v, p[2]]]))));
};
export function generateTerrain() {
  const { level, compiled } = S;
  if (!compiled.paths || compiled.report.errors.length) return status('Fix the errors of the track first.', 'warn');
  change(() => {
    delete level.track.cuts;                             // cut the sections afresh, then freeze them
    delete level.terrain;
    const paths = buildPaths(level.track), base = buildBase(level, paths, undefined, { terrain: true });
    const b = bakeTerrain(level, paths, base, bakeOpts());
    level.terrain = b.terrain; level.track.cuts = b.cuts;
    sel.points.clear(); sel.tris.clear();
    status(`terrain built: ${b.terrain.tris.length} triangles` + (b.warnings.length ? ' - ' + b.warnings.join('; ') : ''), b.warnings.length ? 'warn' : 'ok');
  });
}
$('tGenerate').onclick = generateTerrain;
$('tRegen').onclick = () => { if (confirm('Throw the terrain away (with all your edits) and generate it again? Ctrl+Z brings it back.')) generateTerrain(); };
$('tRemove').onclick = () => {
  if (!confirm('Remove the whole terrain? Ctrl+Z brings it back.')) return;
  change(() => { delete S.level.terrain; delete S.level.track.cuts; sel.points.clear(); sel.tris.clear(); });
};

// ---------------------------------------------------------------- landscaping comfort (2026-10-11, user's list)
// the base's faces that the landscape meets (plan test of "Fill with triangles")
const baseFaces = () => (S.compiled?.base?.tris || []).filter(t => !t.covered && !t.deck && !t.floating && !t.cap && !t.marking).map(t => t.p);
const movable = () => [...sel.points].filter(i => !S.level.terrain.points[i]?.lock);

// Delete points: with every triangle using them; the free points left without a triangle go too
export function deletePoints() {
  if (!sel.points.size) return;
  terrainOp(() => { TR.deletePoints(S.level.terrain, [...sel.points]); sel.points.clear(); sel.tris.clear(); S.anchor = null; });
}
$('tDelPts').onclick = deletePoints;
$('tFill').onclick = () => {
  if (sel.points.size < 3) return status('Select three or more points.', 'warn');
  let made = 0;
  terrainOp(() => { made = TR.fillPoints(S.level.terrain, [...sel.points], tpos(), baseFaces()).length; });
  status(made ? `${made} triangle(s) made` : 'Nothing to fill between these points: there is landscape or road everywhere.', made ? 'ok' : 'hint');
};
// Copy / paste: the selected triangles (in point mode those whose corners are all selected)
const trisToCopy = () => {
  const T = S.level?.terrain;
  if (!T) return [];
  if (S.pickTris) return [...sel.tris];
  return T.tris.map((t, id) => id).filter(id => T.tris[id].slice(0, 3).every(i => sel.points.has(i)));
};
export function copyTerrain() {
  const ids = trisToCopy();
  if (!ids.length) return status(S.pickTris ? 'Select triangles first.' : 'Select the points of at least one whole triangle first.', 'warn');
  S.clipboard = TR.copyTriangles(S.level.terrain, ids, tpos());
  status(`${ids.length} triangle(s) copied`, 'ok');
  syncPanel();
}
// the position (game coordinates) under the mouse in view v at the depth of point c: flat views keep c's distance
// along the view's direction, the 3D view the plane at c's height
function placeAt(v, px, py, c) {
  const r = rayAt(v, px, py).ray, C = T3(c);
  let P;
  if (v.type === '3d') P = r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -C.y), new THREE.Vector3());
  else P = r.origin.clone().addScaledVector(r.direction, C.clone().sub(r.origin).dot(r.direction));
  return P ? [P.x, P.y, -P.z] : null;
}
export function pasteTerrain() {
  const clip = S.clipboard;
  if (!clip || !hasTerrain()) return status('Copy triangles first (Ctrl+C).', 'warn');
  const m = S.mouse, v = m && views[m.view];
  const at = (v && placeAt(v, m.px, m.py, clip.centre)) || clip.centre.map((x, k) => x + (k === 0 ? 500 : 0));
  terrainOp(() => {
    const made = TR.pasteTriangles(S.level.terrain, clip, at);
    sel.tris.clear(); sel.points = new Set(made.points); S.pickTris = false; S.anchor = null;
  });
  status(`${clip.tris.length} triangle(s) pasted - a floating piece until it is joined to the landscape (Fill with triangles)`, 'ok');
}
$('tCopy').onclick = copyTerrain;
$('tPaste').onclick = pasteTerrain;

// The tools in the heads of the flat views (views.js): align, move / rotate, to ground
export function syncViewTools() {
  const show = S.mode === 'terrain' && !S.pickTris && sel.points.size > 0;
  for (const v of views) {
    v.tools.hidden = !show || v.type === '3d';
    for (const b of v.tools.querySelectorAll('button')) {
      if (b.dataset.act === 'move' || b.dataset.act === 'rotate') b.classList.toggle('on', S.vtool === b.dataset.act);
      if (b.dataset.act === 'alignH' || b.dataset.act === 'alignV') b.disabled = sel.points.size < 2;
    }
  }
}
addEventListener('e2-viewtype', syncViewTools);
// the anchor: the point clicked last, if it is selected; else the middle of the selection
export function anchorPos() {
  const pos = tpos();
  if (S.anchor !== null && sel.points.has(S.anchor) && pos[S.anchor]) return pos[S.anchor];
  const ps = [...sel.points].map(i => pos[i]).filter(Boolean);
  return ps.length ? [0, 1, 2].map(k => ps.reduce((s, p) => s + p[k], 0) / ps.length) : null;
}
function align(v, along) {
  const A = anchorPos();
  if (!A) return;
  const ax = axes(v)[along], a = T3(A).dot(ax), pos = tpos();
  change(() => setPositions(new Map(movable().map(i => {
    const P = T3(pos[i]), Q = P.addScaledVector(ax, a - P.dot(ax));
    return [i, [Q.x, Q.y, -Q.z]];
  }))));
}
function toGround() {
  const ids = movable(), dy = TR.groundShift(S.level.terrain, ids, tpos());
  if (dy === null) return status('No point of the selection has a neighbour outside it.', 'warn');
  if (Math.abs(dy) < 0.5) return status('The selection meets its neighbours as well as it can already.', 'ok');
  const pos = tpos();
  change(() => setPositions(new Map(ids.map(i => [i, [pos[i][0], pos[i][1] + dy, pos[i][2]]]))));
  status(`Selection ${dy >= 0 ? 'raised' : 'lowered'} by ${Math.abs(Math.round(dy))}`, 'ok');
}
for (const v of views) {
  v.tools.addEventListener('pointerdown', e => e.stopPropagation());
  for (const b of v.tools.querySelectorAll('button')) b.onclick = () => {
    const act = b.dataset.act;
    if (act === 'alignH') align(v, 'up');                 // one horizontal line: the same height on the screen
    else if (act === 'alignV') align(v, 'right');         // one vertical line: the same place across the screen
    else if (act === 'move' || act === 'rotate') { S.vtool = act; syncViewTools(); }
    else if (act === 'ground') toGround();
    b.blur();
  };
}
// Rotating (the 'rotate' tool): a drag of a selected point turns the selection about the anchor in the view's plane.
// rotation(drag, v, px, py) -> new positions of drag.start (game coordinates)
export function rotateStart(v, px, py, start) {
  const pivot = anchorPos();
  if (!pivot || v.type === '3d') return null;
  const [sx, sy] = toScreen(v, T3(pivot));
  return { pivot, sx, sy, a0: Math.atan2(-(py - sy), px - sx), start };
}
export function rotation(r, v, px, py) {
  const th = Math.atan2(-(py - r.sy), px - r.sx) - r.a0, c = Math.cos(th), s = Math.sin(th);
  const { right, up } = axes(v), Q = T3(r.pivot), out = new Map();
  for (const [id, p] of r.start) {
    const d = T3(p).sub(Q), a = d.dot(right), b = d.dot(up);
    const n = d.clone().addScaledVector(right, -a).addScaledVector(up, -b);
    const P = Q.clone().add(n).addScaledVector(right, a * c - b * s).addScaledVector(up, a * s + b * c);
    out.set(id, [Math.round(P.x), Math.round(P.y), Math.round(-P.z)]);
  }
  return out;
}
