// The asset editor (mode 'asset', inside the Assets tab): a custom asset is built from simple bodies (core/csg.js)
// combined in order: every body is added to, cut out of or intersected with the result of the bodies before it. The
// boolean operations are applied to a selection (Union / Subtract / Intersect with two or more bodies selected: the
// first in the list is the base, the others get the operation and move right behind it); a body's operation can
// also be changed in its properties. The level is shown but frozen; the asset sits at `at` (a placed instance, else
// the ground in the middle of the view). Bodies are picked by clicking their faces or centre markers (Ctrl toggles,
// Shift adds), dragged by their faces in every view, Ctrl+drag copies them, moved with the gizmo, the arrow keys or
// the fields. The asset is edited in the level (level.assets["custom/..."]) so undo works; Cancel puts the state
// before the edit back.
import { buildAsset, bodyPolygons, KINDS, DEFAULT_BODY, openEdges } from '/core/csg.js';
import { frameOf, setFrame, fitFrameUnit } from '/core/texmap.js';
import { newObjectId } from '/core/anim.js';
import { $, S, sel, status, esc, T, editedAsset, collectEditable } from '../state.js';
import { views, rayAt, assetGroup } from '../views.js';
import { change, rebuild } from '../edit.js';
import { draw } from '../draw.js';
import { syncPanel, setMode, setTab } from '../panels.js';
import { worldAt } from '../ruler.js';
import { refreshLibrary } from './assets.js';
import { textureNames, textureMeta, whenTexturesChange } from '../textures.js';

const OPS = ['add', 'subtract', 'intersect'];
const OP_NAME = { add: 'added', subtract: 'cut out', intersect: 'kept where it overlaps' };
const OP_BADGE = { add: '+', subtract: '−', intersect: '∩' };
const KIND_GLYPH = { box: '▣', sphere: '●', cylinder: '⬭', cone: '▲', pyramid: '◭', tetra: '△', plane: '▬' };
const clone = x => JSON.parse(JSON.stringify(x));

export function startAssetEdit(ref = null) {
  const level = S.level;
  level.assets ||= {};
  let isNew = false;
  if (!ref) {
    const n = Object.keys(level.assets).filter(k => k.startsWith('custom/')).length + 1;
    ref = 'custom/' + Date.now().toString(36);
    level.assets[ref] = buildAsset({ name: `Asset ${n}`, custom: true, bodies: [clone(DEFAULT_BODY)] });
    isNew = true;
  }
  const A = level.assets[ref];
  if (!A || !A.custom) return status('Only own assets (Custom) can be edited.', 'warn');
  if (!A.bodies) A.bodies = [];
  // where it is shown: at a placed instance, else on the ground in the middle of the view
  const inst = (level.objects || []).find(o => o.asset === ref);
  let at = inst ? [inst.x, inst.y, inst.z] : null;
  if (!at) {
    const v = views.find(x => x.visible && x.type === '3d') || views.find(x => x.visible);
    at = worldAt(v, v.rect.x + v.rect.w / 2, v.rect.y + v.rect.h / 2).map(Math.round);
  }
  // the origin (`at`) is kept in the asset while it is edited (A.editAt), so undo brings an origin move back too
  S.assetEdit = { ref, get at() { return S.level.assets?.[ref]?.editAt || at; }, before: isNew ? null : JSON.stringify(A), isNew };
  A.editAt = at;
  sel.bodies = new Set(A.bodies.length ? [0] : []);
  setMode('asset');
  status(`Building ${A.name}: add bodies, drag them or use the gizmo, Done keeps the asset.`);
}
export function finishAssetEdit(keep) {
  const e = S.assetEdit;
  if (!e) return;
  const at = e.at.slice();
  if (!keep) { if (e.isNew) delete S.level.assets[e.ref]; else if (e.before) S.level.assets[e.ref] = JSON.parse(e.before); }
  else {
    const A = S.level.assets[e.ref];
    if (A) { A.name = $('aeName').value.trim() || A.name; delete A.editAt; buildAsset(A); }
    // a new asset's first copy stays where it was built
    if (A && e.isNew && A.bodies.length) { S.level.objects ||= []; S.level.objects.push({ id: newObjectId(S.level), asset: e.ref, x: at[0], y: at[1], z: at[2] }); sel.objects = new Set([S.level.objects.length - 1]); }
  }
  S.assetEdit = null; sel.bodies.clear();
  S.mode = 'assets';
  rebuild();
  setMode('assets');
  refreshLibrary();
  status('');
}
$('aeDone').onclick = () => finishAssetEdit(true);
$('aeCancel').onclick = () => finishAssetEdit(false);
$('aeName').onchange = () => { const A = editedAsset(); if (A) change(() => { A.name = $('aeName').value.trim() || A.name; }); };

// a change of the bodies: one undo step, the mesh built again
const edit = fn => { const A = editedAsset(); if (!A) return; change(() => { fn(A); tidyGroups(A); buildAsset(A); }); };
// Groups (2026-10-11, user): folders in the outliner, nothing else - body.group is the id of one of A.groups
// [{id, name}]; the order of the bodies (and so the result of the combination) does not change. Groups nobody is in
// any more go.
function tidyGroups(A) {
  if (!A.groups) return;
  const used = new Set(A.bodies.map(b => b.group).filter(Boolean));
  A.groups = A.groups.filter(g => used.has(g.id));
  for (const b of A.bodies) if (b.group && !A.groups.some(g => g.id === b.group)) delete b.group;
  if (!A.groups.length) delete A.groups;
}
const groupOf = (A, id) => (A.groups || []).find(g => g.id === id) || null;
$('aeGroup').onclick = () => {
  if (!sel.bodies.size) return;
  edit(A => {
    A.groups ||= [];
    let n = A.groups.length + 1;
    while (A.groups.some(g => g.name === `Group ${n}`)) n++;
    const id = 'g' + Date.now().toString(36);
    A.groups.push({ id, name: `Group ${n}` });
    for (const i of sel.bodies) if (A.bodies[i]) A.bodies[i].group = id;
  });
};
$('aeUngroup').onclick = () => edit(A => { for (const i of sel.bodies) if (A.bodies[i]) delete A.bodies[i].group; });
// the group the selected bodies are all in (null: none, or several)
const groupOfSelection = A => { const gs = new Set([...sel.bodies].map(i => A.bodies[i]?.group)); return gs.size === 1 ? groupOf(A, [...gs][0]) : null; };
$('aeGroupName').onchange = () => edit(A => { const g = groupOfSelection(A), v = $('aeGroupName').value.trim(); if (g && v) g.name = v; });
$('aeBodyName').onchange = () => edit(A => {
  const v = $('aeBodyName').value.trim();
  for (const i of sel.bodies) { const b = A.bodies[i]; if (!b) continue; if (v) b.name = v; else delete b.name; }
});
export function addBody(kind = $('aeKind').value, op = 'add') {
  edit(A => {
    const b = { ...clone(DEFAULT_BODY), kind, op: A.bodies.length ? op : 'add', colour: $('aeColour').value || DEFAULT_BODY.colour };
    if (kind === 'plane') b.size = [200, 1, 200];
    const last = [...sel.bodies].pop();
    if (last !== undefined && A.bodies[last]) b.pos = A.bodies[last].pos.map((v, k) => v + (k === 0 ? 100 : 0));
    A.bodies.push(b);
    sel.bodies = new Set([A.bodies.length - 1]);
  });
}
$('aeAdd').onclick = () => addBody();
export function deleteBodies() {
  if (!sel.bodies.size) return;
  edit(A => { A.bodies = A.bodies.filter((b, i) => !sel.bodies.has(i)); sel.bodies.clear(); });
}
$('aeDelete').onclick = deleteBodies;
// copies of the selected bodies, selected afterwards; `beside` puts them next to the originals (the button), else
// on top of them (Ctrl+drag: the copies are dragged away)
export function duplicateBodies(A, beside) {
  const made = [];
  for (const i of [...sel.bodies].sort((a, b) => a - b)) { const c = clone(A.bodies[i]); if (beside) c.pos[0] += c.size[0]; A.bodies.push(c); made.push(A.bodies.length - 1); }
  sel.bodies = new Set(made);
  buildAsset(A);
  collectEditable();
}
$('aeDup').onclick = () => edit(A => duplicateBodies(A, true));
// the order matters: a body is combined with everything before it
const moveBody = dir => edit(A => {
  const i = [...sel.bodies][0], j = i + dir;
  if (sel.bodies.size !== 1 || j < 0 || j >= A.bodies.length) return;
  [A.bodies[i], A.bodies[j]] = [A.bodies[j], A.bodies[i]];
  sel.bodies = new Set([j]);
});
$('aeUp').onclick = () => moveBody(-1);
$('aeDown').onclick = () => moveBody(1);
// a boolean operation on the selection: the first selected body (in the list) is the base, the others get the
// operation and move right behind it
export function booleanOp(op) {
  if (sel.bodies.size < 2) return status('Select two or more bodies first (Shift+click adds).', 'warn');
  edit(A => {
    const ids = [...sel.bodies].sort((a, b) => a - b), base = A.bodies[ids[0]], moved = ids.slice(1).map(i => A.bodies[i]);
    for (const b of moved) b.op = op;
    const rest = A.bodies.filter(b => !moved.includes(b));
    rest.splice(rest.indexOf(base) + 1, 0, ...moved);
    A.bodies = rest;
    sel.bodies = new Set(rest.map((b, i) => (b === base || moved.includes(b) ? i : -1)).filter(i => i >= 0));
  });
  status(`${sel.bodies.size} bodies: the later ones are ${OP_NAME[op]} (the base is the first in the list).`, 'ok');
}
$('aeUnion').onclick = () => booleanOp('add');
$('aeSubtract').onclick = () => booleanOp('subtract');
$('aeIntersect').onclick = () => booleanOp('intersect');
// the fields of the selected bodies
const FIELDS = [['aesx', 'size', 0], ['aesy', 'size', 1], ['aesz', 'size', 2], ['aepx', 'pos', 0], ['aepy', 'pos', 1], ['aepz', 'pos', 2], ['aerx', 'rot', 0], ['aery', 'rot', 1], ['aerz', 'rot', 2]];
for (const [id, key, k] of FIELDS) $(id).onchange = () => {
  const v = Number($(id).value);
  if ($(id).value === '' || !Number.isFinite(v)) return;
  edit(A => { for (const i of sel.bodies) { const b = A.bodies[i]; if (!b) continue; b[key] = (b[key] || [0, 0, 0]).slice(); b[key][k] = key === 'size' ? Math.max(1, v) : v; } });
};
$('aeBodyOp').onchange = () => edit(A => { for (const i of sel.bodies) if (A.bodies[i]) A.bodies[i].op = $('aeBodyOp').value; });
$('aeBodyKind').onchange = () => edit(A => { for (const i of sel.bodies) if (A.bodies[i]) A.bodies[i].kind = $('aeBodyKind').value; });
$('aeSeg').onchange = () => edit(A => { const n = Math.max(3, Math.min(24, Number($('aeSeg').value) || 8)); for (const i of sel.bodies) if (A.bodies[i]) A.bodies[i].segments = n; });
$('aeColour').onchange = () => { if (sel.bodies.size) edit(A => { for (const i of sel.bodies) if (A.bodies[i]) A.bodies[i].colour = $('aeColour').value; }); };
$('aeSurf').onchange = () => edit(A => { const v = $('aeSurf').value; for (const i of sel.bodies) { const b = A.bodies[i]; if (!b) continue; if (v === '') delete b.surface; else b.surface = Number(v); } });
$('aeFaceClear').onclick = () => edit(A => { for (const i of sel.bodies) if (A.bodies[i]) delete A.bodies[i].faceColours; });
// Paint body (2026-10-11, user): all faces of the selected bodies in the paint colour - the body's colour, no face
// colours left over
$('aePaintBody').onclick = () => {
  const colour = $('aeFaceColour').value;
  edit(A => { for (const i of sel.bodies) { const b = A.bodies[i]; if (b) { b.colour = colour; delete b.faceColours; } } });
  status(`${sel.bodies.size} body(ies) painted ${colour}`, 'ok');
};
export const faceTool = () => $('aeFaceTool').checked;
$('aeFaceTool').onchange = () => { draw(); syncPanel(); };
// the outliner: a row per body; click selects, Ctrl toggles, Shift selects the range from the last clicked row
let lastRow = 0;
$('aeBodies').onclick = e => {
  const row = e.target.closest('.orow');
  if (!row || e.target.closest('input')) return;
  const A = editedAsset();
  if (row.dataset.g !== undefined) {                   // a group: the arrow folds it, the row selects its bodies
    const g = row.dataset.g;
    if (e.target.closest('.glyph')) { const c = S.assetEdit.closed ||= new Set(); c.has(g) ? c.delete(g) : c.add(g); syncPanel(); return; }
    const ids = A.bodies.map((b, k) => (b.group === g ? k : -1)).filter(k => k >= 0);
    if (e.ctrlKey && ids.every(k => sel.bodies.has(k))) ids.forEach(k => sel.bodies.delete(k));
    else if (e.ctrlKey || e.shiftKey) ids.forEach(k => sel.bodies.add(k));
    else sel.bodies = new Set(ids);
    draw(); syncPanel();
    return;
  }
  const i = Number(row.dataset.i);
  if (e.ctrlKey) { sel.bodies.has(i) ? sel.bodies.delete(i) : sel.bodies.add(i); }
  else if (e.shiftKey) { for (let k = Math.min(lastRow, i); k <= Math.max(lastRow, i); k++) sel.bodies.add(k); }
  else sel.bodies = new Set([i]);
  lastRow = i;
  draw(); syncPanel();
};

// renaming in the outliner: double-click a body's or a group's row (or F2 for the selected body), Enter keeps, Esc drops
export function renameRow(row) {
  const A = editedAsset(), span = row?.querySelector('.name');
  if (!A || !span) return;
  const g = row.dataset.g !== undefined ? groupOf(A, row.dataset.g) : null, b = g ? null : A.bodies[Number(row.dataset.i)];
  if (!g && !b) return;
  const input = document.createElement('input');
  input.className = 'rename'; input.value = g ? g.name : b.name || '';
  input.placeholder = g ? 'group' : b.kind;
  span.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = keep => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (!keep || v === (g ? g.name : b.name || '')) { syncPanel(); return; }
    edit(B => {
      if (g) { const G = groupOf(B, g.id); if (G && v) G.name = v; return; }
      const body = B.bodies[Number(row.dataset.i)];
      if (body) { if (v) body.name = v; else delete body.name; }
    });
  };
  input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}
$('aeBodies').ondblclick = e => { const row = e.target.closest('.orow'); if (row && !e.target.closest('input')) renameRow(row); };
export function renameSelectedBody() {
  const A = editedAsset(), g = A && groupOfSelection(A);
  // a whole group selected (its row clicked): the group is renamed
  if (g && A.bodies.every((b, i) => (b.group === g.id) === sel.bodies.has(i))) return renameRow($('aeBodies').querySelector(`.orow.grp[data-g="${g.id}"]`));
  if (sel.bodies.size !== 1) return;
  renameRow($('aeBodies').querySelector(`.orow[data-i="${[...sel.bodies][0]}"]`));
}

// the body under the cursor: {body, point (three coords)} or null; with the face tool on, the face gets the chosen
// colour instead (and null is returned). The click's selection is handled here too (Ctrl toggles only on release
// without a drag, see input.js: a Ctrl+drag copies)
export function pickBody(v, px, py) {
  const A = editedAsset();
  if (!A) return null;
  const mesh = assetGroup.children.find(m => m.userData.preview);
  const hit = mesh && rayAt(v, px, py).intersectObject(mesh, false)[0];
  if (!hit) return null;
  const face = A.faces[hit.faceIndex];
  return face ? { body: face[8], prim: face[9], point: hit.point } : null;
}
export function assetClick(v, px, py, e) {
  const A = editedAsset();
  if (!A) return null;
  const hit = pickBody(v, px, py);
  if (!hit) { if (!faceTool() && !e.shiftKey && !e.ctrlKey) { sel.bodies.clear(); draw(); syncPanel(); } return null; }
  if (faceTool()) {
    const colour = $('aeFaceColour').value;
    edit(B => { const b = B.bodies[hit.body]; if (!b) return; b.faceColours ||= {}; b.faceColours[hit.prim] = colour; });
    status(`Face ${hit.prim} of body ${hit.body} coloured ${colour}.`, 'ok');
    return null;
  }
  if (e.ctrlKey) sel.bodies.add(hit.body);          // toggled off on release when it was selected and nothing was dragged
  else if (e.shiftKey) sel.bodies.add(hit.body);
  else if (!sel.bodies.has(hit.body)) sel.bodies = new Set([hit.body]);
  draw(); syncPanel();
  return hit;
}

// ---------------------------------------------------------------- textures: a projector frame per body
// (stored in the body: core/texmap.js; Fit front / top / side put it on a side of the body's shape, fitFrameUnit)
function fillTextureSelect() {
  const sel0 = $('aeTex').value;
  $('aeTex').innerHTML = '';
  $('aeTex').add(new Option('(none)', ''));
  for (const n of textureNames()) $('aeTex').add(new Option(n, n));
  $('aeTex').value = sel0 && textureNames().includes(sel0) ? sel0 : '';
}
whenTexturesChange(() => {
  fillTextureSelect();
  // an image that changed its size: the frames keep their world size, the texel counts follow the image
  const A = editedAsset();
  if (A) { let touched = false; for (const b of A.bodies) { const m = b.texture && textureMeta(b.texture.name); if (m && m.w && (b.texture.px[0] !== m.w || b.texture.px[1] !== m.h)) { b.texture.px = [m.w, m.h]; touched = true; } } if (touched) { buildAsset(A); draw(); } }
  if (S.mode === 'asset') syncPanel();
});
$('aeTex').onchange = () => {
  const name = $('aeTex').value, meta = name ? textureMeta(name) : null;
  edit(A => {
    for (const i of sel.bodies) {
      const b = A.bodies[i];
      if (!b) continue;
      if (!name) { delete b.texture; continue; }
      const keep = b.texture && (b.texture.ax || b.texture.size);
      if (keep) Object.assign(b.texture, { name, px: [meta?.w || 64, meta?.h || 64] });
      else { b.texture = { name, px: [meta?.w || 64, meta?.h || 64] }; fitFrameUnit(b, 'front'); }
    }
  });
};
for (const [id, how] of [['aeTexFront', 'front'], ['aeTexTop', 'top'], ['aeTexSide', 'side']]) $(id).onclick = () => edit(A => {
  for (const i of sel.bodies) { const b = A.bodies[i]; if (b?.texture) fitFrameUnit(b, how); }
});
$('aeTexRemove').onclick = () => edit(A => { for (const i of sel.bodies) if (A.bodies[i]) delete A.bodies[i].texture; });
// what the gizmo moves: the bodies, the origin or the texture frame
for (const id of ['aeToolBodies', 'aeToolOrigin']) $(id).onchange = () => { if (S.assetEdit) { S.assetEdit.origin = $('aeToolOrigin').checked; if (S.assetEdit.origin) S.assetEdit.frame = false; } draw(); syncPanel(); };
// Place texture (2026-10-11, user): while it is on, the gizmo and the frame fields place the selected body's texture
// frame; off, the texture stays baked into the body (texmap.js: it moves, turns and scales with it, copies carry it)
$('aeTexFrame').onchange = () => { if (S.assetEdit) { S.assetEdit.frame = $('aeTexFrame').checked; if (S.assetEdit.frame) S.assetEdit.origin = false; } draw(); syncPanel(); };
const TEX_FIELDS = [['aetpx', 'origin', 0], ['aetpy', 'origin', 1], ['aetpz', 'origin', 2], ['aetrx', 'rot', 0], ['aetry', 'rot', 1], ['aetrz', 'rot', 2], ['aetw', 'size', 0], ['aeth', 'size', 1]];
for (const [id, key, k] of TEX_FIELDS) $(id).onchange = () => {
  const v = Number($(id).value);
  if ($(id).value === '' || !Number.isFinite(v)) return;
  edit(A => {
    const b = A.bodies[[...sel.bodies][0]], f = b && frameOf(b);
    if (!f) return;
    const g = { origin: f.origin.slice(), rot: f.rot.slice(), size: f.size.slice() };
    g[key][k] = key === 'size' ? Math.max(1, v) : v;
    setFrame(b, g);
  });
};
// moving the origin by d (game units): the bodies and the placed copies stay where they are in the world
export function moveOrigin(d) {
  const A = editedAsset(), e = S.assetEdit;
  if (!A) return;
  for (const b of A.bodies) { b.pos = b.pos.map((v, k) => v - d[k]); if (b.texture?.origin && b.texture.space !== 'body') b.texture.origin = b.texture.origin.map((v, k) => v - d[k]); }
  for (const o of S.level.objects || []) if (o.asset === e.ref) { o.x += d[0]; o.y += d[1]; o.z += d[2]; }
  A.editAt = e.at.map((v, k) => v + d[k]);
  buildAsset(A);
}
$('aeOriginCentre').onclick = () => {
  const A = editedAsset();
  if (!A || !A.verts.length) return;
  const xs = A.verts.map(v => v[0]), ys = A.verts.map(v => v[1]), zs = A.verts.map(v => v[2]);
  const d = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys), (Math.min(...zs) + Math.max(...zs)) / 2].map(Math.round);
  if (d.every(v => !v)) return status('The origin is at the bottom centre already.');
  change(() => moveOrigin(d));
  status(`Origin moved by ${d.join(', ')}: the bodies and the placed copies stay where they are.`, 'ok');
};

export function syncAssetEditPanel() {
  const A = editedAsset();
  if (!A) { S.assetEdit = null; setMode('assets'); return; }
  if ($('aeTex').options.length !== textureNames().length + 1) fillTextureSelect();
  if (document.activeElement !== $('aeName')) $('aeName').value = A.name || '';
  // the bodies in their order; a group's run of bodies under a header row (a group split by other bodies gets a header
  // per run), folded groups show only the header
  const closed = S.assetEdit.closed || new Set(), rows = [];
  let run = null;
  A.bodies.forEach((b, i) => {
    const g = b.group ? groupOf(A, b.group) : null;
    if (g && run !== g.id) {
      const members = A.bodies.map((x, k) => (x.group === g.id ? k : -1)).filter(k => k >= 0), all = members.every(k => sel.bodies.has(k));
      rows.push(`<div class="orow grp${all ? ' on' : ''}" data-g="${esc(g.id)}" title="group: click selects its bodies, the arrow folds it, double-click renames">`
        + `<span class="glyph">${closed.has(g.id) ? '▸' : '▾'}</span><span class="name">${esc(g.name)} <small>${members.length}</small></span><span></span><span></span></div>`);
    }
    run = g ? g.id : null;
    if (g && closed.has(g.id)) return;
    rows.push(`<div class="orow${sel.bodies.has(i) ? ' on' : ''}${g ? ' ingrp' : ''}" data-i="${i}" title="${esc(b.kind)}, ${i ? OP_NAME[b.op || 'add'] : 'the first body'}">`
      + `<span class="glyph">${KIND_GLYPH[b.kind] || '?'}</span><span class="name">${esc(b.name || b.kind)} <small>${i}</small></span>`
      + `<span class="badge op-${i ? b.op || 'add' : 'base'}">${i ? OP_BADGE[b.op || 'add'] : '•'}</span><span class="dim">${b.size.map(Math.round).join(' × ')}</span></div>`);
  });
  $('aeBodies').innerHTML = rows.join('') || '<div class="muted">No bodies: Add one.</div>';
  const one = sel.bodies.size === 1 ? A.bodies[[...sel.bodies][0]] : null, any = sel.bodies.size > 0;
  $('aeProps').hidden = !any;
  if (one) {
    for (const [id, key, k] of FIELDS) if (document.activeElement !== $(id)) $(id).value = Math.round(((one[key] || [0, 0, 0])[k]) * 10) / 10;
    $('aeBodyOp').value = one.op || 'add'; $('aeBodyKind').value = one.kind;
    if (document.activeElement !== $('aeBodyName')) $('aeBodyName').value = one.name || '';
    $('aeSeg').value = one.segments || '';
    if (document.activeElement !== $('aeColour')) $('aeColour').value = one.colour || DEFAULT_BODY.colour;
    $('aeTex').value = one.texture?.name && textureNames().includes(one.texture.name) ? one.texture.name : '';
    $('aeSurf').value = one.surface === undefined ? '' : String(one.surface);
  }
  $('aeTexFrame').checked = !!S.assetEdit.frame; $('aeToolOrigin').checked = !!S.assetEdit.origin; $('aeToolBodies').checked = !S.assetEdit.origin;
  const f = one && S.assetEdit.frame ? frameOf(one) : null;
  $('aeTexFields').hidden = !f;
  if (f) for (const [id, key, k] of TEX_FIELDS) if (document.activeElement !== $(id)) $(id).value = Math.round(f[key][k] * 10) / 10;
  $('aeUngroup').disabled = ![...sel.bodies].some(i => A.bodies[i]?.group);
  const sg = any ? groupOfSelection(A) : null;
  if (document.activeElement !== $('aeGroupName')) $('aeGroupName').value = sg ? sg.name : '';
  $('aeGroupName').disabled = !sg;
  for (const id of ['aeDelete', 'aeDup', 'aeGroup', 'aeFaceClear', 'aePaintBody', 'aeBodyName', 'aeBodyOp', 'aeBodyKind', 'aeSeg', 'aeTex', 'aeSurf']) $(id).disabled = !any;
  $('aeUp').disabled = $('aeDown').disabled = sel.bodies.size !== 1;
  for (const id of ['aeUnion', 'aeSubtract', 'aeIntersect']) $(id).disabled = sel.bodies.size < 2;
  for (const id of ['aeTexFront', 'aeTexTop', 'aeTexSide', 'aeTexRemove', 'aeTexFrame']) $(id).disabled = !(one && one.texture);
  if ($('aeTexFrame').disabled && S.assetEdit.frame) { S.assetEdit.frame = false; $('aeToolBodies').checked = true; }
  $('aeFaceColour').disabled = !faceTool() && !any;                     // the paint colour: for faces and for Paint body
  const open = openEdges(A);
  $('aeInfo').textContent = `${A.bodies.length} bodies, ${A.faces.length} triangles, ${A.verts.length} vertices` + (open ? `, ${open} open edges` : ', closed');
}
// the body kinds and operations in the selects
for (const k of KINDS) $('aeKind').add(new Option(k, k));
for (const k of KINDS) $('aeBodyKind').add(new Option(k, k));
for (const o of OPS) $('aeBodyOp').add(new Option(OP_NAME[o], o));
