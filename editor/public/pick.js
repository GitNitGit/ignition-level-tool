// Picking: the point, road section, segment or triangle under the cursor; what is visible in a screen box (an
// off-screen render with one colour per face); section ranges along the track for Shift-clicks.
import * as THREE from './vendor/three.module.js';
import { edgeKey } from '/core/model.js';
import { S, sel, T, T3, hasTerrain, tpos, selected } from './state.js';
import { renderer, toScreen, updateCamera } from './views.js';
import { draw } from './draw.js';
import { syncPanel } from './panels.js';

const PICK_NODE = 10, PICK_EDGE = 8;
export function pickNode(v, px, py) {           // the point of the current mode under the cursor
  if (S.mode === 'terrain' && S.pickTris) return null;
  // Selected points win: in the Front and Left views many points lie behind each other and the selected ones are
  // drawn on top, so they must be the ones a click takes (user, 2026-10-11). Among the rest the nearest on screen,
  // and between equals the one nearer the camera.
  const sl = selected(), radius = S.mode === 'terrain' ? 7 : PICK_NODE;
  let best = null, bk = null;
  for (const e of S.editable) {
    const [sx, sy, sz] = toScreen(v, T(e.pos[0], e.pos[1] + 10, e.pos[2]));
    if (!(sz > -1 && sz < 1)) continue;                 // behind the camera
    const d = Math.hypot(sx - px, sy - py);
    if (d >= radius) continue;
    const key = [sl.has(e.id) ? 0 : 1, d, sz];
    if (!bk || key[0] < bk[0] || (key[0] === bk[0] && (key[1] < bk[1] - 0.5 || (Math.abs(key[1] - bk[1]) <= 0.5 && key[2] < bk[2])))) { bk = key; best = e.id; }
  }
  return best;
}
// road section under the cursor (mode 1 in the sections pick mode)
export function pickSection(v, px, py) {
  if (S.mode !== 'track' || S.trackPick !== 'sections' || !S.compiled.sections) return null;
  let best = null, bz = Infinity;
  for (const s of S.compiled.sections) {
    if (s.jump) continue;
    const ys = [s.f0.c[1], s.f0.c[1], s.f1.c[1], s.f1.c[1]];
    const q = s.quad.map((c, k) => toScreen(v, T(c[0], ys[k], c[1])));
    let inside = false;
    for (let a = 0, b = 3; a < 4; b = a++) {
      if ((q[a][1] > py) !== (q[b][1] > py) && px < (q[b][0] - q[a][0]) * (py - q[a][1]) / (q[b][1] - q[a][1]) + q[a][0]) inside = !inside;
    }
    const z = q.reduce((m, c) => m + c[2], 0) / 4;
    if (inside && z < bz) { bz = z; best = s; }
  }
  return best;
}
// the sections from a to b along the track (driving direction), across forks and merges: the shorter of the two ways
// round (a -> b or b -> a); [] if there is none
function sectionRoute(a, b) {
  const secs = S.compiled.sections, byId = new Map(secs.map(o => [o.id, o]));
  const near = (p, c) => Math.hypot(p[0] - c[0], p[2] - c[2]) < 1;
  const next = o => {
    const p = o.path, n = p.closed ? p.frames.length : p.frames.length - 1, out = [];
    if (o.j + 1 < n) out.push(byId.get(`${p.key}:${o.j + 1}`)); else if (p.closed) out.push(byId.get(`${p.key}:0`));
    // a branch ending here goes on on the road it joins; a fork: the branch leaving here as well
    if (!p.closed && o.j === n - 1) out.push(...secs.filter(q => q.path !== p && near(q.f0.c, o.f1.c)));
    for (const q of S.compiled.paths.all) if (!q.closed && q !== p && near(q.frames[0].c, o.f1.c)) out.push(byId.get(`${q.key}:0`));
    return out.filter(Boolean);
  };
  const route = (from, to) => {
    const prev = new Map([[from.id, null]]), queue = [from];
    while (queue.length) {
      const o = queue.shift();
      if (o === to) { const r = []; for (let id = to.id; id; id = prev.get(id)) r.push(id); return r; }
      for (const q of next(o)) if (!prev.has(q.id)) { prev.set(q.id, o.id); queue.push(q); }
    }
    return null;
  };
  const r1 = route(a, b), r2 = route(b, a);
  return (r1 && r2 ? (r1.length <= r2.length ? r1 : r2) : r1 || r2) || [];
}
export function clickSection(s, e) {
  if (e.ctrlKey) { sel.sections.has(s.id) ? sel.sections.delete(s.id) : sel.sections.add(s.id); }
  else if (e.shiftKey && S.lastSection) {
    for (const id of sectionRoute(S.lastSection, s)) sel.sections.add(id);
    sel.sections.add(s.id);
  } else { sel.sections.clear(); sel.nodes.clear(); sel.edges.clear(); sel.sections.add(s.id); }
  S.lastSection = s;
  draw(); syncPanel();
}
// What is visible inside a screen box of a view: an off-screen render with one colour per face (index + 2).
let pickTarget = null;
const pickMaterial = new THREE.ShaderMaterial({
  vertexShader: 'attribute vec3 pid; varying vec3 vPid; void main() { vPid = pid; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec3 vPid; void main() { gl_FragColor = vec4(vPid, 1.0); }',
  side: THREE.DoubleSide,
});
// terrain triangles visible in the box (ids into level.terrain.tris)
export function visibleTris(v, x0, y0, x1, y1) {
  const out = new Set();
  for (const i of visibleFaces(v, x0, y0, x1, y1)) if (S.faceList[i].kind === 'terrain') out.add(S.faceList[i].id);
  return out;
}
// faces (indices into faceList) visible in the box; circle: only pixels within the circle the box encloses
export function visibleFaces(v, x0, y0, x1, y1, circle = false) {
  const pos = [], pid = [];
  const put = (P, id) => { const c = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255]; for (const p of P) { pos.push(p.x, p.y, p.z); pid.push(...c); } };
  S.faceList.forEach((f, i) => put(f.p.map(T3), i + 2));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('pid', new THREE.Float32BufferAttribute(pid, 3));
  const scene2 = new THREE.Scene();
  scene2.add(new THREE.Mesh(geo, pickMaterial));
  const { w, h } = v.rect;
  if (!pickTarget || pickTarget.width !== w || pickTarget.height !== h) { pickTarget?.dispose(); pickTarget = new THREE.WebGLRenderTarget(w, h); }
  const cam = updateCamera(v);
  renderer.setRenderTarget(pickTarget);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene2, cam);
  renderer.setRenderTarget(null);
  geo.dispose();
  const bx = Math.max(0, Math.floor(x0 - v.rect.x)), by = Math.max(0, Math.floor(h - (y1 - v.rect.y)));
  const bw = Math.min(w - bx, Math.ceil(x1 - x0) + 1), bh = Math.min(h - by, Math.ceil(y1 - y0) + 1);
  const out = new Set();
  if (bw <= 0 || bh <= 0) return out;
  const buf = new Uint8Array(bw * bh * 4);
  renderer.readRenderTargetPixels(pickTarget, bx, by, bw, bh, buf);
  const cx = (x0 + x1) / 2 - v.rect.x, cy = h - ((y0 + y1) / 2 - v.rect.y), r2 = ((x1 - x0) / 2) ** 2;
  for (let k = 0; k < buf.length; k += 4) {
    if (circle) { const q = k / 4, px = bx + (q % bw), py = by + Math.floor(q / bw); if ((px - cx) ** 2 + (py - cy) ** 2 > r2) continue; }
    const id = buf[k] | (buf[k + 1] << 8) | (buf[k + 2] << 16);
    if (id >= 2) out.add(id - 2);
  }
  return out;
}
// the face under the cursor (base or terrain), frontmost
export function faceAt(v, px, py) { const ids = [...visibleFaces(v, px, py, px, py)]; return ids.length ? S.faceList[ids[0]] : null; }

// terrain triangle under the cursor (frontmost)
export function pickTri(v, px, py) {
  if (!hasTerrain()) return -1;
  // 3D: the triangle actually seen at the pixel (projected geometry is wrong for corners behind the camera)
  if (v.type === '3d') { const ids = [...visibleTris(v, px, py, px, py)]; return ids.length ? ids[0] : -1; }
  const pos = tpos(), tt = S.level.terrain.tris;
  let best = -1, bz = Infinity;
  const proj = new Map();
  const at = i => { if (!proj.has(i)) { const q = pos[i] ? toScreen(v, T3(pos[i])) : null; proj.set(i, q && q[2] > -1 && q[2] < 1 ? q : null); } return proj.get(i); };
  for (let id = 0; id < tt.length; id++) {
    const q = [at(tt[id][0]), at(tt[id][1]), at(tt[id][2])];
    if (!q[0] || !q[1] || !q[2]) continue;
    if (Math.max(q[0][0], q[1][0], q[2][0]) < px || Math.min(q[0][0], q[1][0], q[2][0]) > px
        || Math.max(q[0][1], q[1][1], q[2][1]) < py || Math.min(q[0][1], q[1][1], q[2][1]) > py) continue;
    const d = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]);
    if (!d) continue;
    const l1 = ((q[1][1] - q[2][1]) * (px - q[2][0]) + (q[2][0] - q[1][0]) * (py - q[2][1])) / d;
    const l2 = ((q[2][1] - q[0][1]) * (px - q[2][0]) + (q[0][0] - q[2][0]) * (py - q[2][1])) / d;
    if (l1 < 0 || l2 < 0 || 1 - l1 - l2 < 0) continue;
    const z = (q[0][2] + q[1][2] + q[2][2]) / 3;
    if (z < bz) { bz = z; best = id; }
  }
  return best;
}

export function pickEdge(v, px, py, radius = PICK_EDGE) {
  if (S.mode !== 'track') return null;
  let best = null, bd = radius;
  for (const p of S.compiled.paths?.all || []) {
    let prev = null;
    for (const s of p.line) {
      const cur = toScreen(v, T(...s.p));
      if (prev) {
        const [ax, ay] = prev, [bx, by] = cur;
        const L = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = L ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L)) : 0;
        const d = Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
        if (d < bd) { bd = d; best = { key: edgeKey(...p.edge(s.seg)), p: s.p }; }
      }
      prev = cur;
    }
  }
  return best;
}
