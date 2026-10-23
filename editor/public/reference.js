// A reference image under a flat view (Top, Front or Left): a picture (a sketch, a map, a photo) laid on the view's
// plane through the origin as a size reference while building. The "Reference" popover of the view bar loads it,
// turns, scales, shifts and fades it, shows or hides it, and removes it when it is no longer needed. Editor only:
// the compiler ignores level.reference; the image file lives beside the level (levels/<name>/ref_<view>.png) and
// is drawn in a pass after the scene, faded, so it lies over everything (the terrain would hide it otherwise).
import * as THREE from './vendor/three.module.js';
import { $, S, status } from './state.js';
import { refScene, viewHooks } from './views.js';
import { change } from './edit.js';

export const REF_VIEWS = ['top', 'front', 'left'];
const DEFAULT = { on: true, opacity: 50, size: 20000, rot: 0, u: 0, v: 0 };
// the plane of each view in three coordinates: the base orientation of a PlaneGeometry (faces +z, up +y), the
// normal towards the camera, screen right and up
const FRAME = {
  top: { base: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), normal: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, -1) },
  front: { base: new THREE.Quaternion(), normal: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  left: { base: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), normal: new THREE.Vector3(-1, 0, 0), right: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
};
const meshes = {};                                   // view -> {mesh, key, aspect, enabled}
const loader = new THREE.TextureLoader();
export const refOf = view => S.level?.reference?.[view] || null;
export const refMesh = view => meshes[view]?.mesh || null;
function dropMesh(view) {
  const cur = meshes[view];
  if (!cur) return;
  refScene.remove(cur.mesh); cur.mesh.material.map?.dispose(); cur.mesh.material.dispose(); cur.mesh.geometry.dispose();
  delete meshes[view];
}
// the meshes follow the level's reference settings (called by draw)
export function syncReference() {
  for (const view of REF_VIEWS) {
    const r = refOf(view);
    if (!r) { dropMesh(view); continue; }
    const key = `${S.levelName}/${r.file}/${r.stamp}`;
    if (!meshes[view] || meshes[view].key !== key) {
      dropMesh(view);
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, color: 0x000000 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      const entry = meshes[view] = { mesh, key, aspect: 1, enabled: false };
      loader.load(`/api/levels/${S.levelName}/ref/${view}?t=${r.stamp || 0}`, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
        entry.aspect = tex.image.width / tex.image.height;
        place(view);
      });
      refScene.add(mesh);
    }
    place(view);
  }
}
export function place(view) {
  const r = refOf(view), e = meshes[view];
  if (!r || !e) return;
  const f = FRAME[view], w = r.size, h = r.size / (e.aspect || 1);
  e.mesh.scale.set(w, h, 1);
  e.mesh.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(f.normal, r.rot * Math.PI / 180)).multiply(f.base);
  e.mesh.position.copy(f.right).multiplyScalar(r.u).addScaledVector(f.up, r.v);
  e.mesh.material.opacity = r.opacity / 100;
  e.enabled = r.on !== false;
}
// shown only in the view it belongs to
viewHooks.push(v => { for (const view of REF_VIEWS) { const e = meshes[view]; if (e) e.mesh.visible = e.enabled && v.type === view; } });

// ---------------------------------------------------------------- the popover
const view = () => $('refView').value;
export function syncRefPanel() {
  const r = refOf(view());
  $('refInfo').textContent = r ? `${r.file} in the ${view()} view` : `No image in the ${view()} view yet: choose a PNG or JPEG.`;
  for (const id of ['refOn', 'refOff', 'refOpacity', 'refSize', 'refRot', 'refU', 'refV', 'refRemove']) $(id).disabled = !r;
  if (!r) return;
  $('refOn').checked = r.on !== false; $('refOff').checked = r.on === false;
  for (const [id, k] of [['refOpacity', 'opacity'], ['refSize', 'size'], ['refRot', 'rot'], ['refU', 'u'], ['refV', 'v']]) if (document.activeElement !== $(id)) $(id).value = r[k];
}
$('refBtn').onclick = () => { $('refPanel').hidden = !$('refPanel').hidden; $('refBtn').classList.toggle('on', !$('refPanel').hidden); syncRefPanel(); $('refBtn').blur(); };
$('refClose').onclick = () => { $('refPanel').hidden = true; $('refBtn').classList.remove('on'); };
$('refView').onchange = syncRefPanel;
// the image goes to the server (beside the level), the settings into the level
export async function setReferenceImage(v, file) {
  const r = await fetch(`/api/levels/${S.levelName}/ref/${v}`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  change(() => { S.level.reference ||= {}; S.level.reference[v] = { ...DEFAULT, ...(S.level.reference[v] || {}), file: data.file, stamp: Date.now() }; });
  syncRefPanel();
}
$('refFile').onchange = async () => {
  const file = $('refFile').files[0];
  if (!file) return;
  try { await setReferenceImage(view(), file); status(`Reference image for the ${view()} view: ${file.name}`, 'ok'); } catch (e) { status('Reference image: ' + e.message, 'err'); }
  $('refFile').value = '';
};
// one setting changed: one undo step
export function setReference(v, patch) {
  const r = refOf(v);
  if (!r) return;
  change(() => Object.assign(r, patch));
  syncRefPanel();
}
$('refOn').onchange = $('refOff').onchange = () => setReference(view(), { on: $('refOn').checked });
for (const [id, k] of [['refSize', 'size'], ['refRot', 'rot'], ['refU', 'u'], ['refV', 'v']]) $(id).onchange = () => { const n = Number($(id).value); if (Number.isFinite(n)) setReference(view(), { [k]: k === 'size' ? Math.max(10, n) : n }); };
// the opacity slider shows live; the undo step is made on release from the value before the drag
let opacityBefore = null;
$('refOpacity').oninput = () => { const r = refOf(view()); if (!r) return; if (opacityBefore === null) opacityBefore = r.opacity; r.opacity = Number($('refOpacity').value); place(view()); };
$('refOpacity').onchange = () => { const r = refOf(view()); if (!r) return; const now = Number($('refOpacity').value); if (opacityBefore !== null) r.opacity = opacityBefore; opacityBefore = null; setReference(view(), { opacity: now }); };
$('refRemove').onclick = async () => {
  const v = view();
  if (!refOf(v)) return;
  try { await fetch(`/api/levels/${S.levelName}/ref/${v}`, { method: 'DELETE' }); } catch { /* the setting goes anyway */ }
  change(() => { delete S.level.reference[v]; if (!Object.keys(S.level.reference).length) delete S.level.reference; });
  syncRefPanel();
  status(`Reference image of the ${v} view removed.`, 'ok');
};
