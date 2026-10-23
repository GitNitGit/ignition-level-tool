// The transform gizmo: at the centre of the selection three arrows (move along x, y, z), three rings (rotate about
// the axis), three cubes (scale along the axis) and a centre cube (scale uniformly). It works on the placed objects
// (Assets tab) and on the bodies of the custom asset being built (asset editor) through the same adapter. It is
// drawn in gizmoGroup (views.js scales it to GIZMO_PX pixels per view); the maths is in game coordinates
// (core/objects.js), so a thing follows the mouse whatever the view's mirroring.
// Frames: in the 3D view the gizmo is the selection's own (local) frame - the axes turn with the first selected
// thing, so a body rotated by 30 degrees is moved, turned and scaled along its own edges; in the flat views (Top,
// Front, Left) it is the world frame with only the handles of the view's plane: two arrows, two cubes, one ring
// about the view's normal, no uniform cube. Ctrl snaps: 10 units, 15 degrees, 10 units of size / 0.1 of scale.
import * as THREE from './vendor/three.module.js';
import { S, sel, T, editedAsset, animEntry, poseOf, setPose } from './state.js';
import { gizmoGroup, gizmoSize, toScreen, rayAt, viewHooks } from './views.js';
import { axisRotation, rotationOf, composeRotation, eulerOf, tidyObject } from '/core/objects.js';
import { buildAsset, tidyBody } from '/core/csg.js';
import { frameOf as texFrameOf, setFrame } from '/core/texmap.js';
import { moveOrigin } from './tabs/assetedit.js';

// game axes with their basis (u, w) in the plane across (u x w = axis) and their colour
const AXES = [
  { dir: [1, 0, 0], u: [0, 1, 0], w: [0, 0, 1], color: 0xff5050 },
  { dir: [0, 1, 0], u: [0, 0, 1], w: [1, 0, 0], color: 0x50e050 },
  { dir: [0, 0, 1], u: [1, 0, 0], w: [0, 1, 0], color: 0x5090ff },
];
const ARROW = 1, CUBE = 1.35, RING = 0.8, RING_N = 48;
const UNIFORM = [1, 1, 1].map(x => x / Math.sqrt(3) * 1.15);   // the uniform-scale cube sits on the diagonal (the centre is the marker's)
const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const ringPoint = (C, a, k, r) => add(add(C, a.u, Math.cos(k) * r), a.w, Math.sin(k) * r);
{
  const line = (pts, color, part) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => T(...p))), new THREE.LineBasicMaterial({ color, depthTest: false })); l.userData.part = part; return l; };
  const solid = (geo, color, at, dir, part) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.copy(T(...at));
    if (dir) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), T(...dir).normalize());
    m.userData.part = part;
    return m;
  };
  const O = [0, 0, 0];
  AXES.forEach((a, axis) => {
    gizmoGroup.add(line([O, add(O, a.dir, ARROW)], a.color, { kind: 'move', axis }));
    gizmoGroup.add(solid(new THREE.ConeGeometry(0.05, 0.16, 10), a.color, add(O, a.dir, ARROW), a.dir, { kind: 'move', axis }));
    gizmoGroup.add(solid(new THREE.BoxGeometry(0.09, 0.09, 0.09), a.color, add(O, a.dir, CUBE), null, { kind: 'scale', axis }));
    const ring = [];
    for (let k = 0; k <= RING_N; k++) ring.push(ringPoint(O, a, k / RING_N * 2 * Math.PI, RING));
    gizmoGroup.add(line(ring, a.color, { kind: 'rotate', axis }));
  });
  gizmoGroup.add(line([O, UNIFORM], 0xc0c0c0, { kind: 'uscale' }));
  gizmoGroup.add(solid(new THREE.BoxGeometry(0.1, 0.1, 0.1), 0xf0f0f0, UNIFORM, null, { kind: 'uscale' }));
  gizmoGroup.traverse(o => { o.renderOrder = 20; });
}

// what the gizmo moves: [{get: () => {p, rot, scale}, set: ({p, rot, scale}) => void, tidy: () => void, unit}]
// (positions in world game coordinates; a body's scale is its size, so its snap unit is 10, an object's 0.1)
function targets() {
  const objectTarget = o => ({
    get: () => ({ p: [o.x, o.y, o.z], rot: (o.rot || [0, 0, 0]).slice(), scale: (o.scale || [1, 1, 1]).slice() }),
    set: t => { [o.x, o.y, o.z] = t.p; o.rot = t.rot; o.scale = t.scale; },
    tidy: () => tidyObject(o), unit: 0.1,
  });
  if (S.mode === 'assets') return [...sel.objects].map(i => S.level.objects?.[i]).filter(Boolean).map(objectTarget);
  // the Animation tab: an object of the animation shown moves its pose at the playhead (a key with Auto-key), the
  // others their placement
  if (S.mode === 'anim') return [...sel.objects].map(i => {
    const o = S.level.objects?.[i];
    if (!o) return null;
    if (!animEntry(i)) return objectTarget(o);
    return { get: () => { const p = poseOf(i); return { p: p.pos.slice(), rot: p.rot.slice(), scale: [1, 1, 1] }; }, set: t => setPose(i, { pos: t.p, rot: t.rot }), tidy: () => { const p = poseOf(i); setPose(i, { pos: p.pos.map(Math.round), rot: p.rot.map(a => Math.round(a * 10) / 10) }); }, unit: 0.1 };
  }).filter(Boolean);
  if (S.mode === 'asset') {
    const A = editedAsset(), at = S.assetEdit.at;
    // the asset's origin (assetEdit.origin): moving it leaves the bodies and the placed copies where they are
    if (A && S.assetEdit.origin) return [{
      get: () => ({ p: S.assetEdit.at.slice(), rot: [0, 0, 0], scale: [1, 1, 1] }),
      set: x => { const d = x.p.map((v, k) => v - S.assetEdit.at[k]); if (d.some(v => v)) moveOrigin(d); },
      tidy: () => { const r = S.assetEdit.at.map(Math.round), d = r.map((v, k) => v - S.assetEdit.at[k]); if (d.some(v => v)) moveOrigin(d); },
      unit: 10, moveOnly: true,
    }];
    // the texture frame of the one selected body (assetEdit.frame): position, rotation, size as scale
    if (A && S.assetEdit.frame && sel.bodies.size === 1) {
      // stored in the body (texmap.js setFrame): it moves, turns and scales with it
      const b = A.bodies[[...sel.bodies][0]], f = b && texFrameOf(b);
      return f ? [{
        get: () => { const g = texFrameOf(b); return { p: g.origin.map((v, k) => v + at[k]), rot: g.rot.slice(), scale: [g.size[0], g.size[1], 1] }; },
        set: x => setFrame(b, { origin: x.p.map((v, k) => v - at[k]), rot: x.rot, size: [Math.max(1, x.scale[0]), Math.max(1, x.scale[1])] }),
        tidy: () => { const t = b.texture; for (const k of ['o', 'ax', 'ay']) if (t[k]) t[k] = t[k].map(v => Math.round(v * 1e5) / 1e5); },
        unit: 10,
      }] : [];
    }
    return A ? [...sel.bodies].map(i => A.bodies[i]).filter(Boolean).map(b => ({
      get: () => ({ p: b.pos.map((v, k) => v + at[k]), rot: (b.rot || [0, 0, 0]).slice(), scale: b.size.slice() }),
      set: t => { b.pos = t.p.map((v, k) => v - at[k]); b.rot = t.rot; b.size = t.scale.map(s => Math.max(1, s)); },
      tidy: () => tidyBody(b), unit: 10,
    })) : [];
  }
  return [];
}
// the centre of the selection (game coordinates), null when nothing is selected
export function centre() {
  const list = targets();
  if (!list.length) return null;
  const ps = list.map(t => t.get().p);
  return [0, 1, 2].map(k => ps.reduce((s, p) => s + p[k], 0) / ps.length);
}
// the frame of the gizmo in view v: the first selected thing's rotation (local) in the 3D view, else the world's (null)
function frameOf(v) {
  if (!v || v.type !== '3d') return null;
  const list = targets();
  if (!list.length) return null;
  const rot = list[0].get().rot;
  return rot && rot.some(a => a) ? rotationOf(rot) : null;
}
const turn = (R, p) => (R ? [0, 1, 2].map(i => R[i][0] * p[0] + R[i][1] * p[1] + R[i][2] * p[2]) : p);
export const axesFor = v => { const R = frameOf(v); return AXES.map(a => ({ ...a, dir: turn(R, a.dir), u: turn(R, a.u), w: turn(R, a.w) })); };
// the handles a view shows: all in 3D; a flat view the two arrows and cubes of its plane and the ring about its normal
const FLAT = { top: { plane: [0, 2], normal: 1 }, front: { plane: [0, 1], normal: 2 }, left: { plane: [2, 1], normal: 0 } };
export function allowed(v, kind, axis) {
  if (S.mode === 'asset' && S.assetEdit?.origin && kind !== 'move') return false;   // the origin only moves
  if (S.mode === 'anim' && (kind === 'scale' || kind === 'uscale')) return false;    // a path has no scale
  if (!v || v.type === '3d') return true;
  const f = FLAT[v.type];
  if (kind === 'uscale') return false;
  return kind === 'rotate' ? axis === f.normal : f.plane.includes(axis);
}
// after a change of the selection or the level: show the gizmo at the selection
export function updateGizmo() {
  const C = S.level ? centre() : null;
  gizmoGroup.visible = !!C;
  if (C) gizmoGroup.position.copy(T(...C));
}
// before a view is rendered: the gizmo turned into the view's frame, with the view's handles
viewHooks.push(v => {
  if (!gizmoGroup.visible) return;
  const R = frameOf(v);
  if (R) {                                           // game -> three flips z: M' = F R F
    const m = new THREE.Matrix4().set(R[0][0], R[0][1], -R[0][2], 0, R[1][0], R[1][1], -R[1][2], 0, -R[2][0], -R[2][1], R[2][2], 0, 0, 0, 0, 1);
    gizmoGroup.quaternion.setFromRotationMatrix(m);
  } else gizmoGroup.quaternion.identity();
  for (const o of gizmoGroup.children) if (o.userData.part) o.visible = allowed(v, o.userData.part.kind, o.userData.part.axis);
});

// the handle under the cursor: {kind: 'move' | 'rotate' | 'scale' | 'uscale', axis} or null
export function pickGizmo(v, px, py) {
  if (!gizmoGroup.visible) return null;
  const s = gizmoSize(v), C = centre(), ax = axesFor(v);
  if (!C) return null;
  const scr = p => { const [x, y, z] = toScreen(v, T(...p)); return z > -1 && z < 1 ? [x, y] : null; };
  const dist = q => (q ? Math.hypot(q[0] - px, q[1] - py) : Infinity);
  const segDist = (a, b) => {
    if (!a || !b) return Infinity;
    const L = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2, t = L ? Math.max(0, Math.min(1, ((px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1])) / L)) : 0;
    return Math.hypot(px - a[0] - t * (b[0] - a[0]), py - a[1] - t * (b[1] - a[1]));
  };
  const ok = (kind, axis) => allowed(v, kind, axis);
  if (ok('uscale') && dist(scr(add(C, turn(frameOf(v), UNIFORM), s))) <= 9) return { kind: 'uscale' };
  for (let i = 0; i < 3; i++) if (ok('scale', i) && dist(scr(add(C, ax[i].dir, CUBE * s))) <= 9) return { kind: 'scale', axis: i };
  for (let i = 0; i < 3; i++) if (ok('move', i) && dist(scr(add(C, ax[i].dir, ARROW * s))) <= 10) return { kind: 'move', axis: i };
  for (let i = 0; i < 3; i++) {                        // rings before the arrow shafts (they cross)
    if (!ok('rotate', i)) continue;
    let prev = scr(ringPoint(C, ax[i], 0, RING * s));
    for (let k = 1; k <= RING_N; k++) {
      const q = scr(ringPoint(C, ax[i], k / RING_N * 2 * Math.PI, RING * s));
      if (segDist(prev, q) <= 6) return { kind: 'rotate', axis: i };
      prev = q;
    }
  }
  for (let i = 0; i < 3; i++) if (ok('move', i) && segDist(scr(add(C, ax[i].dir, 0.25 * s)), scr(add(C, ax[i].dir, ARROW * s))) <= 6) return { kind: 'move', axis: i };   // the inner part is the marker's
  return null;
}
// the screen position of a handle (tests): the arrow tip, the cube, a point of the ring, the uniform cube
export function handleAt(v, kind, axis) {
  const s = gizmoSize(v), C = centre(), ax = axesFor(v);
  if (!C) return null;
  const p = kind === 'uscale' ? add(C, turn(frameOf(v), UNIFORM), s) : kind === 'scale' ? add(C, ax[axis].dir, CUBE * s) : kind === 'move' ? add(C, ax[axis].dir, ARROW * s) : ringPoint(C, ax[axis], Math.PI / 4, RING * s);
  const [x, y] = toScreen(v, T(...p));
  return [x, y];
}

// parameter t of the point on the line C + dir * t nearest to the mouse ray (world units)
function axisParam(v, px, py, C, dir) {
  const ray = rayAt(v, px, py).ray, O = ray.origin, D = ray.direction;
  const A = T(...C), B = T(...dir).normalize(), w0 = O.clone().sub(A);
  const b = D.dot(B), d = D.dot(w0), e = B.dot(w0), denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return 0;
  return (e - b * d) / denom;
}
// angle of the mouse around the gizmo centre in the plane of ring `a` (radians); on a plane seen edge-on the angle
// on the screen instead
function ringAngle(v, px, py, C, a) {
  const ray = rayAt(v, px, py).ray;
  const n = T(...a.dir).normalize();
  if (Math.abs(ray.direction.dot(n)) >= 0.15) {
    const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, T(...C)), new THREE.Vector3());
    if (hit) {
      const d = [hit.x - C[0], hit.y - C[1], -hit.z - C[2]];
      const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      return { angle: Math.atan2(dot(d, a.w), dot(d, a.u)), screen: false };
    }
  }
  const [cx, cy] = toScreen(v, T(...C));
  return { angle: Math.atan2(py - cy, px - cx), screen: true };
}

// the start of a drag on handle h: what is needed to apply the mouse later (the frame is kept from the start)
export function gizmoStart(v, px, py, h) {
  const C = centre(), list = targets(), axes = axesFor(v);
  const g = { handle: h, C, list, axes, start: list.map(t => t.get()) };
  if (h.kind === 'move' || h.kind === 'scale') g.t0 = axisParam(v, px, py, C, axes[h.axis].dir);
  else if (h.kind === 'rotate') g.a0 = ringAngle(v, px, py, C, axes[h.axis]);
  else g.p0 = [px, py];                              // uniform: the mouse moving right / up grows the things
  return g;
}
// apply the mouse at (px, py) to the selection, from its state at the start of the drag; snap = Ctrl held
export function gizmoMove(v, px, py, g, snap = false) {
  const { handle: h, C, list, start, axes } = g;
  if (h.kind === 'move') {
    let t = axisParam(v, px, py, C, axes[h.axis].dir) - g.t0;
    if (snap) t = Math.round(t / 10) * 10;
    const d = axes[h.axis].dir;
    list.forEach((tg, i) => tg.set({ ...start[i], p: start[i].p.map((v2, k) => v2 + d[k] * t) }));
  } else if (h.kind === 'scale' || h.kind === 'uscale') {
    let f;
    if (h.kind === 'scale') { const t = axisParam(v, px, py, C, axes[h.axis].dir); f = Math.abs(g.t0) > 1e-6 ? t / g.t0 : 1; }
    else f = Math.exp(((px - g.p0[0]) - (py - g.p0[1])) / 150);
    f = Math.max(0.02, Math.min(50, f));
    list.forEach((tg, i) => tg.set({ ...start[i], scale: start[i].scale.map((s, k) => {
      if (!(h.kind === 'uscale' || k === h.axis)) return s;
      const u = tg.unit || 1;
      return snap ? Math.max(u, Math.round(s * f / u) * u) : s * f;
    }) }));
  } else {
    const a = ringAngle(v, px, py, C, axes[h.axis]);
    let da = a.angle - g.a0.angle;
    if (a.screen !== g.a0.screen) da = 0;
    if (snap) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
    const Rm = axisRotation(axes[h.axis].dir, da);
    list.forEach((tg, i) => {
      const s0 = start[i], p = [s0.p[0] - C[0], s0.p[1] - C[1], s0.p[2] - C[2]];
      tg.set({ ...s0, rot: eulerOf(composeRotation(Rm, rotationOf(s0.rot))), p: [0, 1, 2].map(r => C[r] + Rm[r][0] * p[0] + Rm[r][1] * p[1] + Rm[r][2] * p[2]) });
    });
  }
  if (S.mode === 'asset') { const A = editedAsset(); if (A) buildAsset(A); }
}
// the end of a drag: tidy numbers, drop identity transforms
export function gizmoEnd(g) { for (const t of g.list) t.tidy(); if (S.mode === 'asset') { const A = editedAsset(); if (A) buildAsset(A); } }
