// The Assets tab (mode 'assets'): a library of objects (the original levels of the game directory, or this level's
// own assets, "Custom") shown as a grid with rendered previews, dragged from the grid into a view (drag and drop:
// the object lands on the ground under the cursor) or placed at the view's centre by a double-click. A placed object
// is {asset: "<level>/<ref>", x, y, z, rot?: [degrees x, y, z], scale?: [sx, sy, sz], collide?, hit?, kick?, light?} in
// level.objects (its collision and warning light: core/objects.js collisionOf / lightOf, LEVELFORMAT.md ch. 15, 17); its
// geometry is copied into level.assets once, so the level compiles without the game directory. Placed objects are
// picked by their faces or markers, box-selected, dragged and arrow-moved like control points (state.js),
// transformed with the gizmo (gizmo.js) or the fields of the "Selected object" box; the compiler bakes rotation and
// scale into every placement's mesh (core/objects.js, compile.js).
import * as THREE from '../vendor/three.module.js';
import { tidyObject, placedFaces, collisionOf, lightOf, setCollision, setLight } from '/core/objects.js';
import { atlasTexture, tileSlot, tileUV, whenTilesLoad } from '../tiles.js';
import { textureOf, textureMeta, whenTexturesChange } from '../textures.js';
import { newObjectId } from '/core/anim.js';
import { sourcePosition } from '/core/sounds.js';
import { $, S, sel, api, status, esc, T, collectEditable, assetOf } from '../state.js';
import { trackGroup, objectGroup, renderer, rayAt, host, views, viewAt } from '../views.js';
import { change } from '../edit.js';
import { draw } from '../draw.js';
import { syncPanel } from '../panels.js';
import { worldAt } from '../ruler.js';
import { startAssetEdit } from './assetedit.js';

const library = { sources: [], source: null, objects: [], selected: null, thumbs: new Map() };
const CUSTOM = 'Custom';

async function loadSources() {
  try { library.sources = await api('assets'); } catch (e) { status('Assets: ' + e.message, 'err'); library.sources = []; }
  $('assetSource').innerHTML = '';
  for (const n of [...library.sources, CUSTOM]) $('assetSource').add(new Option(n, n));
  $('assetSource').value = library.sources.includes('Canada') ? 'Canada' : library.sources[0] || CUSTOM;
  await loadObjects();
}
// the objects of the chosen source with their geometry (one request), as cards with previews
async function loadObjects() {
  const src = library.source = $('assetSource').value;
  library.objects = []; library.selected = null;
  const grid = $('assetGrid');
  grid.innerHTML = '';
  if (src === CUSTOM) {
    const own = Object.entries(S.level?.assets || {}).filter(([ref]) => ref.startsWith('custom/'));
    $('assetInfo').textContent = own.length ? `${own.length} own asset${own.length === 1 ? '' : 's'}` : 'No own assets yet: New … builds one from simple bodies.';
    for (const [ref, A] of own) { library.thumbs.delete(ref); library.objects.push(ref); addCard(ref, A, `${A.name || ref} · ${A.faces.length} faces`); }
    return;
  }
  $('assetInfo').textContent = 'loading …';
  let all;
  try { all = await api(`assets/${src}/all`); } catch (e) { status('Assets: ' + e.message, 'err'); $('assetInfo').textContent = ''; return; }
  if ($('assetSource').value !== src) return;                    // the user switched meanwhile
  for (const [index, A] of Object.entries(all)) {
    const ref = `${src}/${index}`;
    S.assetCache.set(ref, A);
    library.objects.push(ref);
    addCard(ref, A, `#${index} · ${A.faces.length} faces` + (A.count > 1 ? ` · ×${A.count}` : ''));
  }
  const parts = Object.values(all).filter(A => A.part).length, copies = Object.values(all).reduce((s, A) => s + (A.count || 1), 0);
  $('assetInfo').textContent = `${library.objects.length} distinct objects in ${src} (${copies} in the level; ${parts} taken out of the landscape meshes)`;
}
function addCard(ref, A, caption) {
  const card = document.createElement('div');
  card.className = 'card'; card.dataset.ref = ref; card.draggable = true;
  card.append(thumbnail(ref, A));
  const label = document.createElement('div');
  label.textContent = caption;
  card.append(label);
  card.onclick = () => choose(ref);
  card.ondblclick = () => { choose(ref); placeAtViewCentre(); };
  // drag and drop into a view: the object lands on the ground under the cursor
  card.ondragstart = e => { choose(ref); e.dataTransfer.setData('text/plain', ref); e.dataTransfer.effectAllowed = 'copy'; };
  $('assetGrid').append(card);
}
function choose(ref) {
  library.selected = ref;
  $('assetGrid').querySelectorAll('.card').forEach(c => c.classList.toggle('on', c.dataset.ref === ref));
  $('assetEditBtn').disabled = !(ref && ref.startsWith('custom/'));
}
$('assetSource').onchange = loadObjects;
// own assets: New builds one, Edit builds on the chosen one; the list is read again after the editor closes
$('assetNew').onclick = () => startAssetEdit(null);
$('assetEditBtn').onclick = () => { if (library.selected?.startsWith('custom/')) startAssetEdit(library.selected); };
export function refreshLibrary() {
  if ($('assetSource').value !== CUSTOM) { $('assetSource').value = CUSTOM; }
  loadObjects();
}
// a card dropped onto the views: the object goes onto the ground under the cursor (the drawn surfaces; beside them
// the view's plane)
host.addEventListener('dragover', e => { if (S.mode === 'assets' && library.selected) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
host.addEventListener('drop', e => {
  e.preventDefault();
  const ref = e.dataTransfer.getData('text/plain') || library.selected;
  if (!ref || S.mode !== 'assets') return;
  const r = host.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, v = viewAt(px, py);
  if (!v) return;
  choose(ref);
  placeAt(worldAt(v, px, py));
});
function placeAtViewCentre() {
  const v = views.find(x => x.visible && x.index === S.hotView) || views.find(x => x.visible && x.type === '3d') || views.find(x => x.visible);
  placeAt(worldAt(v, v.rect.x + v.rect.w / 2, v.rect.y + v.rect.h / 2));
}

// a small rendered preview of an asset (the shared renderer draws into a render target; the pixels go to a canvas).
// The previews are rendered a few per frame after the page draws (a render straight after loading came out black).
const THUMB_W = 104, THUMB_H = 78, THUMBS_PER_FRAME = 6;
let thumbTarget = null;
const pending = [];
export function thumbnail(ref, A, now = false) {
  if (library.thumbs.has(ref)) return library.thumbs.get(ref);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W; canvas.height = THUMB_H;
  library.thumbs.set(ref, canvas);
  if (now) renderThumb(A, canvas);
  else { pending.push([A, canvas]); if (pending.length === 1) requestAnimationFrame(() => requestAnimationFrame(renderPending)); }   // after the page's own frame
  return canvas;
}
// A preview rendered in the first moments after the start comes out empty (the render target reads back zeros; cause
// not found): an empty one is rendered again a little later, a few times.
const thumbLog = { rendered: 0, frames: 0, retried: 0 };
function renderPending() {
  thumbLog.frames++;
  const retry = [];
  for (let i = 0; i < THUMBS_PER_FRAME && pending.length; i++) {
    const [A, canvas, tries = 0] = pending.shift();
    renderThumb(A, canvas);
    thumbLog.rendered++;
    if (canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 0 && tries < 6) retry.push([A, canvas, tries + 1]);
  }
  if (retry.length) { thumbLog.retried += retry.length; setTimeout(() => { const was = pending.length; pending.push(...retry); if (!was) requestAnimationFrame(renderPending); }, 400); }
  if (pending.length) requestAnimationFrame(renderPending);
}
export const thumbStats = () => ({ ...thumbLog, pending: pending.length, cached: library.thumbs.size });
// render every preview again (tests; a library whose previews came out empty)
export function rethumb() {
  library.thumbs.clear();
  for (const card of $('assetGrid').querySelectorAll('.card')) {
    const A = S.assetCache.get(card.dataset.ref) || S.level.assets?.[card.dataset.ref];
    if (A) card.querySelector('canvas').replaceWith(thumbnail(card.dataset.ref, A));
  }
}
// the preview: the faces with their textures (the originals' tiles through the atlas, own images), flat faces with
// their colours, every face shaded by its normal; an orthographic view from the front-right-above fitted to the
// projected extent of the object, so it fills the frame and nothing is cut off. A face whose tile has not arrived yet
// marks the preview as pending: it is rendered again when the tiles (or the images) have loaded.
function renderThumb(A, canvas) {
  const L = new THREE.Vector3(0.4, 0.8, 0.45).normalize();
  const flat = { pos: [], col: [] }, atlas = { pos: [], col: [], uv: [] }, own = new Map();
  const pts = [];
  // the originals' flat colours carry their textures' shading and can be very dark: exposed so the brightest is bright;
  // an own asset shows the colours it was given (2026-10-11, user: a grey box came out white)
  const peak = Math.max(0.05, ...A.faces.filter(f => !(f[6] && f[7])).map(f => Math.max(...[1, 3, 5].map(i => parseInt(f[3].slice(i, i + 2), 16) / 255))));
  const gain = A.custom ? 1 : Math.min(3, 0.95 / peak);
  // the originals' tiles are dark too (the game lights nothing): the previews show them brighter than the views do
  const TILE_GAIN = 1.4, OWN_GAIN = 1.0;
  // a render target gets linear values (no sRGB output conversion): flat colours go in linear, the whole picture is
  // encoded to sRGB when read back, so textures (decoded from sRGB by the shader) and flat faces come out alike
  const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), toSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  let pending = false;
  for (const [a, b, c, colour, , , tile, uv] of A.faces) {
    const P = [a, b, c].map(i => T(...A.verts[i]));
    pts.push(...P);
    const n = P[1].clone().sub(P[0]).cross(P[2].clone().sub(P[0])), len = n.length();
    const shade = len > 0 ? 0.6 + 0.4 * Math.abs(n.dot(L) / len) : 0.6;      // a degenerate face has no normal (NaN would break the draw)
    const add = (buf, rgb, uvs) => { for (let k = 0; k < 3; k++) { buf.pos.push(P[k].x, P[k].y, P[k].z); buf.col.push(...rgb); if (uvs) buf.uv.push(...uvs[k]); } };
    if (tile && uv && tile.startsWith('png:')) {
      const name = tile.slice(4), tex = textureOf(name), meta = textureMeta(name);
      if (tex && meta) {
        if (!own.has(name)) own.set(name, { pos: [], col: [], uv: [], tex });
        add(own.get(name), [shade * OWN_GAIN, shade * OWN_GAIN, shade * OWN_GAIN], uv.map(([u, v]) => [u / meta.w, 1 - v / meta.h]));
        continue;
      }
      pending = true;
    } else if (tile && uv) {
      const slot = tileSlot(tile);
      if (slot !== null) { add(atlas, [shade * TILE_GAIN, shade * TILE_GAIN, shade * TILE_GAIN], uv.map(q => tileUV(slot, q))); continue; }
      pending = true;
    }
    add(flat, [1, 3, 5].map(i => toLinear(Math.min(1, parseInt(colour.slice(i, i + 2), 16) / 255 * gain)) * shade));
  }
  canvas.dataset.pending = pending ? '1' : '';
  if (!pts.length) return;
  const scene = new THREE.Scene(), geos = [];
  const meshOf = (buf, mat) => {
    if (!buf.pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    if (buf.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    geos.push(geo);
    scene.add(new THREE.Mesh(geo, mat));
  };
  meshOf(flat, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  meshOf(atlas, new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }));
  for (const b of own.values()) meshOf(b, new THREE.MeshBasicMaterial({ map: b.tex, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }));
  // the camera: looking at the object's centre from the front-right-above; the frustum is the projected extent
  const box = new THREE.Box3().setFromPoints(pts), centre = box.getCenter(new THREE.Vector3()), radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, radius * 20);
  cam.position.copy(centre).add(new THREE.Vector3(1, 0.75, 1.3).normalize().multiplyScalar(radius * 4));
  cam.lookAt(centre);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse, v = new THREE.Vector3();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { v.copy(p).applyMatrix4(inv); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
  const aspect = THUMB_W / THUMB_H, pad = 1.08;
  let w = Math.max(1, x1 - x0) * pad, h = Math.max(1, y1 - y0) * pad;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  Object.assign(cam, { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 });
  cam.updateProjectionMatrix();
  if (!thumbTarget) thumbTarget = new THREE.WebGLRenderTarget(THUMB_W, THUMB_H);
  renderer.setRenderTarget(thumbTarget);
  renderer.setScissorTest(false);
  // no setViewport here: it multiplies by the screen's pixel ratio even for a render target, so at 125 / 150 % the
  // preview was drawn too big and cut off (2026-10-11); the target's own viewport covers it whole
  renderer.setClearColor(new THREE.Color(toLinear(0x1c / 255), toLinear(0x22 / 255), toLinear(0x2c / 255)), 1);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(THUMB_W * THUMB_H * 4);
  renderer.readRenderTargetPixels(thumbTarget, 0, 0, THUMB_W, THUMB_H, buf);
  renderer.setRenderTarget(null);
  renderer.setScissorTest(true);
  for (const g of geos) g.dispose();
  const img = canvas.getContext('2d').createImageData(THUMB_W, THUMB_H), lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(toSrgb(i / 255) * 255);
  for (let y = 0; y < THUMB_H; y++) {
    const row = buf.subarray((THUMB_H - 1 - y) * THUMB_W * 4, (THUMB_H - y) * THUMB_W * 4), o = y * THUMB_W * 4;
    for (let i = 0; i < row.length; i += 4) { img.data[o + i] = lut[row[i]]; img.data[o + i + 1] = lut[row[i + 1]]; img.data[o + i + 2] = lut[row[i + 2]]; img.data[o + i + 3] = row[i + 3]; }
  }
  canvas.getContext('2d').putImageData(img, 0, 0);
}
// tiles or images arrived: the pending previews are rendered again (a few per frame, as at the start)
function refreshPending() {
  const again = [...$('assetGrid').querySelectorAll('.card canvas')].filter(c => c.dataset.pending === '1');
  for (const c of again) { const ref = c.closest('.card').dataset.ref, A = S.assetCache.get(ref) || S.level.assets?.[ref]; if (A) pending.push([A, c]); }
  if (again.length && pending.length === again.length) requestAnimationFrame(renderPending);
}
whenTilesLoad(refreshPending);
whenTexturesChange(refreshPending);

// put the chosen object at p (game coordinates)
export function placeAt(p) {
  const ref = library.selected, A = ref && S.assetCache.get(ref) || (ref && S.level.assets?.[ref]);
  if (!A) return status('Choose an object in the library first.', 'warn');
  change(() => {
    const level = S.level;
    level.assets ||= {}; level.objects ||= [];
    if (!level.assets[ref]) { const { count, part, ...geom } = A; level.assets[ref] = geom; }
    level.objects.push({ id: newObjectId(level), asset: ref, x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]) });
    sel.objects = new Set([level.objects.length - 1]);
  });
}
// assets no object uses any more are dropped from the level (own assets stay)
function pruneAssets() {
  const level = S.level, used = new Set((level.objects || []).map(o => o.asset));
  for (const k of Object.keys(level.assets || {})) if (!used.has(k) && !k.startsWith('custom/')) delete level.assets[k];
  if (level.objects && !level.objects.length) delete level.objects;
  if (level.assets && !Object.keys(level.assets).length) delete level.assets;
}
export function deleteObjects() {
  if (!sel.objects.size) return;
  change(() => {
    const gone = new Set([...sel.objects].map(i => S.level.objects?.[i]?.id));
    for (const q of S.level.soundSources || []) if (gone.has(q.object)) { [q.x, q.y, q.z] = sourcePosition(S.level, q); delete q.object; delete q.off; }
    S.level.objects = (S.level.objects || []).filter((o, i) => !sel.objects.has(i)); sel.objects.clear(); pruneAssets();
    for (const a of S.level.animations || []) a.objects = a.objects.filter(e => !gone.has(e.object));     // their keys go with them
  });
}
$('objDelete').onclick = deleteObjects;
// copies of the selected objects, selected afterwards; `beside` puts them next to the originals (the button), else on
// top of them (Ctrl+drag: the copies are dragged away)
export function duplicateObjects(beside) {
  const objs = S.level.objects, made = [];
  for (const i of [...sel.objects].sort((a, b) => a - b)) { const c = JSON.parse(JSON.stringify(objs[i])); c.id = newObjectId(S.level); if (beside) c.x += 200; objs.push(c); made.push(objs.length - 1); }
  sel.objects = new Set(made);
  collectEditable();
}
$('objDup').onclick = () => { if (sel.objects.size) change(() => duplicateObjects(true)); };
// the placed object under the cursor (by its faces): {index, point (three coords)} or null
export function pickObject(v, px, py) {
  const meshes = [];
  objectGroup.traverse(m => { if (m.userData.objOf) meshes.push(m); });
  const hit = meshes.length ? rayAt(v, px, py).intersectObjects(meshes, false)[0] : null;
  if (!hit) return null;
  const index = hit.object.userData.objOf[hit.faceIndex];
  return index === undefined ? null : { index, point: hit.point };
}
// the ground under (x, z): the drawn surfaces hit by a ray from above (game height, null when there is nothing)
export function groundAt(x, z) {
  const ray = new THREE.Raycaster(T(x, 100000, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(trackGroup.children, true).find(h => h.object.visible);
  return hit ? hit.point.y : null;
}
// Drop to ground (2026-10-11, user: by collision, not by the origin): object i falls straight down until its first face
// touches another face - the landscape, the road and the other placed objects. The fall is the shortest of: a corner of
// the object down onto a face below it, and a corner of a face below up onto the object's faces. Returns the fall
// (0: touching or already in something), or null when there is nothing below.
function dropDistance(i) {
  const objs = placedFaces(S.level, assetOf), own = objs[i]?.faces.map(f => f.p) || [];
  if (!own.length) return null;
  const P = own.flat(), x0 = Math.min(...P.map(p => p[0])), x1 = Math.max(...P.map(p => p[0])), z0 = Math.min(...P.map(p => p[2])), z1 = Math.max(...P.map(p => p[2]));
  const extent = Math.max(...P.map(p => p[1])) - Math.min(...P.map(p => p[1]));
  const near = q => !(Math.max(...q.map(p => p[0])) < x0 || Math.min(...q.map(p => p[0])) > x1 || Math.max(...q.map(p => p[2])) < z0 || Math.min(...q.map(p => p[2])) > z1);
  const others = [...S.faceList.map(f => f.p), ...objs.filter((x, k) => k !== i).flatMap(x => x.faces.map(f => f.p))].filter(near);
  // the height of face q over (x, z), if (x, z) lies in it in plan
  const heightIn = ([a, b, c], x, z) => {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-6) return null;                                         // upright: no height
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, l3 = 1 - l1 - l2;
    return l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9 ? l1 * a[1] + l2 * b[1] + l3 * c[1] : null;
  };
  const TOL = 1;
  let fall = Infinity, inside = false;
  for (const p of new Map(P.map(p => [p.join(','), p])).values()) for (const q of others) {         // object corners down
    const h = heightIn(q, p[0], p[2]);
    if (h === null) continue;
    const d = p[1] - h;
    if (d >= -TOL) fall = Math.min(fall, Math.max(0, d)); else if (-d < extent) inside = true;
  }
  const below = new Map(others.flat().filter(p => p[0] >= x0 && p[0] <= x1 && p[2] >= z0 && p[2] <= z1).map(p => [p.join(','), p]));
  for (const q of below.values()) for (const f of own) {                                            // corners below up
    const h = heightIn(f, q[0], q[2]);
    if (h !== null && h - q[1] >= -TOL) fall = Math.min(fall, Math.max(0, h - q[1]));
  }
  if (inside) return 0;
  return Number.isFinite(fall) ? fall : null;
}
$('objGround').onclick = () => change(() => {
  let stuck = 0, none = 0;
  for (const i of sel.objects) {
    const o = S.level.objects[i], d = dropDistance(i);
    if (d === null) { none++; continue; }
    if (d < 0.5) { stuck++; continue; }
    o.y = Math.round(o.y - d);
  }
  if (stuck) status(`${stuck} object(s) touch something already`, 'hint');
  else if (none) status(`Nothing under ${none} object(s)`, 'warn');
});
$('objReset').onclick = () => change(() => { for (const i of sel.objects) { const o = S.level.objects[i]; delete o.rot; delete o.scale; } });
// collision of the selected objects (core/objects.js): off, solid (part of the landscape), hits the car (HIT), kicked
// away (KICK); anything but off switches the warning light off
$('objCol').onchange = () => {
  const raw = $('objCol').value;
  if (raw === '') return;
  const v = raw === 'solid' ? 'solid' : Number(raw);
  change(() => { for (const i of sel.objects) { const o = S.level.objects[i]; setCollision(o, v, assetOf(o.asset)); } });
};
// warning light (type 154, flashes in the game's chaser); on switches the collision off; a placed original pylon has it
$('litOn').onchange = $('litOff').onchange = () => change(() => { for (const i of sel.objects) { const o = S.level.objects[i]; setLight(o, $('litOn').checked, assetOf(o.asset)); } });
// the transform fields of a single selected object
const FIELDS = [['ox', 'x'], ['oy', 'y'], ['oz', 'z'], ['orx', 'rot', 0], ['ory', 'rot', 1], ['orz', 'rot', 2], ['osx', 'scale', 0], ['osy', 'scale', 1], ['osz', 'scale', 2]];
const DEFAULTS = { rot: [0, 0, 0], scale: [1, 1, 1] };
for (const [id, key, k] of FIELDS) {
  $(id).onchange = () => {
    const v = Number($(id).value);
    if ($(id).value === '' || !Number.isFinite(v) || sel.objects.size !== 1) return;
    change(() => {
      const o = S.level.objects[[...sel.objects][0]];
      if (k === undefined) o[key] = v;
      else { o[key] = (o[key] || DEFAULTS[key]).slice(); o[key][k] = v; }
      tidyObject(o);
    });
  };
}

export function syncAssetsPanel() {
  const objs = S.level.objects || [], n = sel.objects.size, one = n === 1 ? objs[[...sel.objects][0]] : null;
  $('objBox').hidden = !n;
  if (!n) return;
  const names = [...sel.objects].map(i => objs[i]).filter(Boolean).map(o => S.level.assets?.[o.asset]?.name || o.asset);
  $('objTitle').textContent = one ? names[0] : `${n} objects`;
  $('objFields').hidden = !one;
  if (one) for (const [id, key, k] of FIELDS) if (document.activeElement !== $(id)) $(id).value = k === undefined ? one[key] : (one[key] || DEFAULTS[key])[k];
  const list = [...sel.objects].map(i => objs[i]).filter(Boolean);
  const cols = new Set(list.map(o => String(collisionOf(o, assetOf(o.asset)))));
  $('objCol').value = cols.size === 1 ? [...cols][0] : '';
  const lit = o => lightOf(o, assetOf(o.asset));
  $('litOn').checked = list.every(lit); $('litOff').checked = !list.some(lit);
}
// called by app.js once the editor has started (the previews need the renderer up)
export const initLibrary = () => loadSources();
