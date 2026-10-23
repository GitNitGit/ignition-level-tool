// Animations (the Animation tab): placed objects move along keyframes. level.animations = [{id, name, length (s),
// objects: [{object: <object id>, keys: [{t (s), pos: [x, y, z], rot: [degrees x, y, z]}]}]}]. The pose between two
// keys is interpolated linearly (angles on the shortest way); before the first key it is the first, after the last
// the last. The game plays an object's path from the level start at ANIM_FPS frames per second and restarts it hard
// after the last frame (LEVELFORMAT.md ch. 8), so an animation of `length` seconds becomes length * ANIM_FPS + 1
// frames (the last one at `length`). The frame rate is not in the data: 25 is the viewer's estimate, to be measured.
// Compile: the object's placement is its pose at t = 0 (key 0; rotation and scale baked into the mesh as for every
// object), the frames carry the position (the game takes them relative to the first frame) and the extra rotation
// P = R(key) * R(key0)^-1 about the mesh origin, as the game's angles r2 (about y), r1 (about x), r0 (about z) in
// 1/10 degree, continued over revolutions.
import { rotationOf } from './objects.js';

export const ANIM_FPS = 25;
export const ANIM_MAX_SECONDS = 120;          // the originals go up to 1201 frames (48 s)

// placed objects carry an id (animations refer to them by it); older levels get ids when loaded
export function newObjectId(level) {
  const used = new Set((level.objects || []).map(o => o.id));
  let id;
  do id = 'o' + Math.random().toString(36).slice(2, 8); while (used.has(id));
  return id;
}
export function ensureObjectIds(level) { for (const o of level.objects || []) if (!o.id) o.id = newObjectId(level); }
export const animOf = (level, id) => (level.animations || []).find(a => a.id === id) || null;
// the animation and entry an object belongs to, if any ({anim, entry} or null)
export function animEntryOf(level, objectId) {
  for (const a of level.animations || []) { const e = a.objects.find(x => x.object === objectId); if (e) return { anim: a, entry: e }; }
  return null;
}
const lerpAngle = (a, b, t) => { const d = ((b - a) % 360 + 540) % 360 - 180; return a + d * t; };
// the pose {pos, rot} of an entry at time t (seconds)
export function poseAt(entry, t) {
  const keys = entry.keys;
  if (!keys.length) return null;
  if (t <= keys[0].t) return { pos: keys[0].pos.slice(), rot: (keys[0].rot || [0, 0, 0]).slice() };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { pos: last.pos.slice(), rot: (last.rot || [0, 0, 0]).slice() };
  let k = 0;
  while (k + 1 < keys.length && keys[k + 1].t <= t) k++;
  const a = keys[k], b = keys[k + 1], u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const ra = a.rot || [0, 0, 0], rb = b.rot || [0, 0, 0];
  return { pos: [0, 1, 2].map(i => a.pos[i] + (b.pos[i] - a.pos[i]) * u), rot: [0, 1, 2].map(i => lerpAngle(ra[i], rb[i], u)) };
}
// set (or replace) the key of an entry at time t; keys stay sorted
export function setKey(entry, t, pose) {
  t = Math.round(t * 100) / 100;
  const key = { t, pos: pose.pos.map(v => Math.round(v)), rot: pose.rot.map(a => Math.round(a * 10) / 10) };
  const i = entry.keys.findIndex(k => Math.abs(k.t - t) < 0.005);
  if (i >= 0) entry.keys[i] = key; else { entry.keys.push(key); entry.keys.sort((p, q) => p.t - q.t); }
  return key;
}
// the game's angles of a rotation matrix M (game coordinates): M = Ry(r2) * Rx(r1) * Rz(r0); degrees [r0, r1, r2]
export function gameAngles(M) {
  const deg = 180 / Math.PI, x = Math.asin(-Math.max(-1, Math.min(1, M[1][2])));
  let y, z;
  if (Math.abs(M[1][2]) < 0.9999999) { y = Math.atan2(M[0][2], M[2][2]); z = Math.atan2(M[1][0], M[1][1]); }
  else { y = Math.atan2(-M[2][0], M[0][0]); z = 0; }
  return [z * deg, x * deg, y * deg];
}
const transpose = R => [0, 1, 2].map(i => [0, 1, 2].map(j => R[j][i]));
const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
// the frames of an entry for the .POS file: [[r0, x, y, z, r1, r2] ...] (1/10 degree, integers), rotation relative
// to the pose at t = 0 (which is baked into the mesh), angles continued over revolutions
export function animFrames(anim, entry, fps = ANIM_FPS) {
  const n = Math.max(1, Math.round((anim.length || 0) * fps)) + 1, base = poseAt(entry, 0);
  if (!base) return [];
  const R0t = transpose(rotationOf(base.rot)), out = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const p = poseAt(entry, i / fps), P = mul(rotationOf(p.rot), R0t);
    let a = gameAngles(P).map(v => v * 10);
    if (prev) a = a.map((v, k) => { const d = ((v - prev[k]) % 3600 + 5400) % 3600 - 1800; return prev[k] + d; });
    prev = a;
    out.push([Math.round(a[0]), Math.round(p.pos[0]), Math.round(p.pos[1]), Math.round(p.pos[2]), Math.round(a[1]), Math.round(a[2])]);
  }
  return out;
}
