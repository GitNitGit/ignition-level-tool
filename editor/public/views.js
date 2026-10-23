// The scene, the renderer and the four views (Top, Left, Front, 3D): layout with the draggable cross, cameras,
// screen <-> world helpers, framing.
import * as THREE from './vendor/three.module.js';
import { $, S, T } from './state.js';

// ---------------------------------------------------------------- scene
export const host = $('views');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setScissorTest(true);
host.prepend(renderer.domElement);
export const canvas = renderer.domElement;
export const scene = new THREE.Scene();
export const refScene = new THREE.Scene();           // drawn over the scene: the reference images (reference.js)
export const BG = new THREE.Color(0x10141a);
export const grid = new THREE.GridHelper(50000, 50, 0x3a4252, 0x283040);      // the ground, Top and 3D (under the lowest point)
// Front and Left: an upright grid every 500 far behind everything, the lines through 0 brighter (height 0 and x / z 0)
export const gridXY = new THREE.GridHelper(50000, 100, 0x56627a, 0x232a36);
gridXY.rotation.x = Math.PI / 2; gridXY.position.z = -150000;
export const gridZY = new THREE.GridHelper(50000, 100, 0x56627a, 0x232a36);
gridZY.rotation.z = Math.PI / 2; gridZY.position.x = 150000;
scene.add(grid, gridXY, gridZY);
// trackGroup: the ground (road, kerbs, verge, landscape; the ruler and the ground queries hit it); objectGroup: the
// placed objects; overlay: markers and selection; rulerGroup: the ruler
export const trackGroup = new THREE.Group(), objectGroup = new THREE.Group(), overlay = new THREE.Group(), rulerGroup = new THREE.Group();
export const assetGroup = new THREE.Group();          // the custom asset being built (tabs/assetedit.js)
export const gizmoGroup = new THREE.Group();          // the transform gizmo (gizmo.js), scaled per view to GIZMO_PX
gizmoGroup.visible = false;
scene.add(trackGroup, objectGroup, assetGroup, overlay, rulerGroup, gizmoGroup);
export const GIZMO_PX = 90;
export const viewHooks = [];                          // called with the view before it is rendered (gizmo.js)
// world size of one gizmo unit in view v, so the gizmo is GIZMO_PX pixels long (the 3D camera must be updated)
export function gizmoSize(v) {
  if (v.type !== '3d') return v.scale * GIZMO_PX;
  const c = v.persp, d = c.position.distanceTo(gizmoGroup.position);
  return d * 2 * Math.tan(c.fov / 2 * Math.PI / 180) / v.rect.h * GIZMO_PX;
}
export const solid = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
export const glass = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true,
                                                   opacity: 0.45, depthWrite: false });
export const onTop = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
                                                   depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

// ---------------------------------------------------------------- views
const VIEW_TYPES = { top: 'Top', left: 'Left', front: 'Front', '3d': '3D' };
export const views = ['top', '3d', 'front', 'left'].map((type, index) => ({
  index, type, rect: { x: 0, y: 0, w: 1, h: 1 },
  ortho: new THREE.OrthographicCamera(-1, 1, 1, -1, -400000, 400000), center: new THREE.Vector3(), scale: 20,
  persp: new THREE.PerspectiveCamera(50, 1, 20, 400000), target: new THREE.Vector3(), yaw: -0.6, pitch: 0.75, dist: 20000,
}));
export const camOf = v => (v.type === '3d' ? v.persp : v.ortho);

for (const v of views) {
  v.head = document.createElement('div');
  v.head.className = 'vphead';
  const sel = document.createElement('select');
  for (const [k, label] of Object.entries(VIEW_TYPES)) sel.add(new Option(label, k));
  sel.value = v.type;
  sel.onchange = () => { v.type = sel.value; frame(v, null); dispatchEvent(new Event('e2-viewtype')); };
  const max = document.createElement('button');
  max.textContent = '⛶';
  max.title = 'maximise / back to four views';
  max.onclick = () => { S.maxView = S.maxView === v.index ? -1 : v.index; layout(); };
  // tools for the selected landscape points in a flat view (tabs/landscape.js shows them and handles the clicks)
  v.tools = document.createElement('span');
  v.tools.className = 'vptools';
  v.tools.hidden = true;
  for (const [act, label, title] of [
    ['alignH', '⇹', 'align horizontally: all on one horizontal line of this view, through the point clicked last'],
    ['alignV', '⇳', 'align vertically: all on one vertical line of this view, through the point clicked last'],
    ['move', '✥', 'dragging a selected point moves the selection'],
    ['rotate', '⟳', 'dragging a selected point turns the selection about the point clicked last (in this view)'],
    ['ground', '⤓', 'to ground: raise or lower the selection so its border meets the points around it as well as it can'],
  ]) {
    const b = document.createElement('button');
    b.dataset.act = act; b.textContent = label; b.title = title;
    v.tools.append(b);
  }
  v.head.append(sel, max, v.tools);
  v.frameEl = document.createElement('div');
  v.frameEl.className = 'vpframe';
  host.append(v.head, v.frameEl);
}

// the cross between the four views: where the vertical and the horizontal split lie (fractions), dragged to resize
const split = { x: 0.5, y: 0.5 };
try { Object.assign(split, JSON.parse(localStorage.getItem('e2split') || '{}')); } catch { /* no storage: fine */ }
export function layout() {
  const W = host.clientWidth, H = host.clientHeight;
  renderer.setSize(W, H);
  const w = Math.round(W * split.x), h = Math.round(H * split.y);
  for (const v of views) {
    const show = S.maxView < 0 || S.maxView === v.index;
    v.visible = show;
    v.head.hidden = !show; v.frameEl.hidden = !show;
    if (!show) continue;
    if (S.maxView >= 0) v.rect = { x: 0, y: 0, w: W, h: H };
    else {
      const col = v.index % 2, row = Math.floor(v.index / 2);
      v.rect = { x: col * w, y: row * h, w: col ? W - w : w, h: row ? H - h : h };
    }
    Object.assign(v.head.style, { left: v.rect.x + 'px', top: v.rect.y + 'px' });
    Object.assign(v.frameEl.style, { left: v.rect.x + 'px', top: v.rect.y + 'px',
                                     width: v.rect.w - 2 + 'px', height: v.rect.h - 2 + 'px' });
  }
  for (const id of ['splitV', 'splitH', 'splitC']) $(id).hidden = S.maxView >= 0;
  $('splitV').style.left = w - 3 + 'px';
  $('splitH').style.top = h - 3 + 'px';
  Object.assign($('splitC').style, { left: w - 7 + 'px', top: h - 7 + 'px' });
}
addEventListener('resize', layout);
for (const [id, axesOf] of [['splitV', 'x'], ['splitH', 'y'], ['splitC', 'xy']]) {
  const el = $(id);
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId); el.classList.add('active');
    const move = ev => {
      const r = host.getBoundingClientRect();
      const clamp = f => Math.max(0.15, Math.min(0.85, f));
      if (axesOf.includes('x')) split.x = clamp((ev.clientX - r.left) / r.width);
      if (axesOf.includes('y')) split.y = clamp((ev.clientY - r.top) / r.height);
      layout();
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.classList.remove('active');
      try { localStorage.setItem('e2split', JSON.stringify(split)); } catch { /* no storage: fine */ }
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    e.preventDefault();
  });
}

// camera of a view for this frame
export function updateCamera(v) {
  const { w, h } = v.rect;
  if (v.type === '3d') {
    const c = v.persp;
    c.aspect = w / h;
    c.near = Math.max(1, Math.min(20, v.dist / 20));          // close zoom: the near plane comes along (no clipping)
    c.position.set(v.target.x + v.dist * Math.cos(v.pitch) * Math.sin(v.yaw),
                   v.target.y + v.dist * Math.sin(v.pitch),
                   v.target.z + v.dist * Math.cos(v.pitch) * Math.cos(v.yaw));
    c.up.set(0, 1, 0);
    c.lookAt(v.target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    return c;
  }
  const c = v.ortho, s = v.scale;
  Object.assign(c, { left: -w / 2 * s, right: w / 2 * s, top: h / 2 * s, bottom: -h / 2 * s });
  const p = v.center;
  if (v.type === 'top') { c.position.set(p.x, 200000, p.z); c.up.set(0, 0, -1); }
  if (v.type === 'front') { c.position.set(p.x, p.y, 200000); c.up.set(0, 1, 0); }
  if (v.type === 'left') { c.position.set(-200000, p.y, p.z); c.up.set(0, 1, 0); }
  c.lookAt(p);
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return c;
}

// world (three) -> pixel position inside the view
export function toScreen(v, p) {
  const q = p.clone().project(camOf(v));
  return [v.rect.x + (q.x + 1) / 2 * v.rect.w, v.rect.y + (1 - q.y) / 2 * v.rect.h, q.z];
}
export function rayAt(v, px, py) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((px - v.rect.x) / v.rect.w * 2 - 1, -((py - v.rect.y) / v.rect.h) * 2 + 1), camOf(v));
  return ray;
}
// screen axes of a flat view in three coordinates
export function axes(v) {
  const e = camOf(v).matrixWorld.elements;
  return { right: new THREE.Vector3(e[0], e[1], e[2]), up: new THREE.Vector3(e[4], e[5], e[6]) };
}
export function viewAt(px, py) {
  return views.find(v => v.visible && px >= v.rect.x && px < v.rect.x + v.rect.w && py >= v.rect.y && py < v.rect.y + v.rect.h);
}
// pixel position inside #views of a pointer event
export const local = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

// fit a view to the bounds of points (three coords); null = whole track
export function frame(v, pts) {
  if (!S.level) return;
  if (!pts || !pts.length) pts = S.level.track.nodes.map(n => T(n.x, n.y ?? 0, n.z));
  const box = new THREE.Box3().setFromPoints(pts);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, size.y, 1500) * 1.25;
  updateCamera(v);
  if (v.type === '3d') { v.target.copy(c); v.dist = span * 1.1; }
  else {
    v.center.copy(c);
    const wSpan = v.type === 'top' ? Math.max(size.x, 1500) : v.type === 'front' ? Math.max(size.x, 1500) : Math.max(size.z, 1500);
    const hSpan = v.type === 'top' ? Math.max(size.z, 1500) : Math.max(size.y, 1500);
    v.scale = Math.max(wSpan * 1.25 / v.rect.w, hSpan * 1.25 / v.rect.h, 2);
  }
}
$('frameAll').onclick = () => views.forEach(v => frame(v, null));

// one frame: every visible view with its camera and scissor rect (the grids per view type)
export function render() {
  renderer.setClearColor(BG);
  renderer.autoClear = false;
  for (const v of views) {
    if (!v.visible) continue;
    const cam = updateCamera(v);
    if (gizmoGroup.visible) gizmoGroup.scale.setScalar(gizmoSize(v));
    for (const h of viewHooks) h(v);
    grid.visible = v.type === 'top' || v.type === '3d';
    gridXY.visible = v.type === 'front';
    gridZY.visible = v.type === 'left';
    const { x, y, w, h } = v.rect, H = host.clientHeight;
    renderer.setViewport(x, H - y - h, w, h);
    renderer.setScissor(x, H - y - h, w, h);
    renderer.clear();
    renderer.render(scene, cam);
    // the asset being built: in the flat views over the landscape (seen from far outside, the ground would hide it;
    // 2026-10-11, user), its faces still sorted among themselves; the gizmo over it again
    if (S.mode === 'asset' && v.type !== '3d' && assetGroup.children.length) {
      renderer.clearDepth(); renderer.render(assetGroup, cam);
      if (gizmoGroup.visible) { renderer.clearDepth(); renderer.render(gizmoGroup, cam); }
    }
    if (refScene.children.length) { renderer.clearDepth(); renderer.render(refScene, cam); }   // the reference image over everything, faded
  }
}
