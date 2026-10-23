// Baked light. The game does not light anything: every face shows the colours of its texture. So the light is
// computed here, per corner of every face, and put into the texture coordinates: each material has a ramp tile
// (dark to bright, materials.js) and a corner's u coordinate points to its brightness, so the game interpolates the
// brightness across the face like Gouraud shading. The editor shows the same light (app.js).
//
// Brightness of a corner = ambient + diffuse * (normal . sun), darker the deeper the corner lies below the nearest
// road. Normals are smoothed over the faces around a corner whose normals differ by less than CREASE (a kerb box
// keeps its hard edges, a slope is smooth). Faces with other textures later can use the same per-corner values.
export const SUN = (() => { const l = [0.35, 1, 0.25], n = Math.hypot(...l); return l.map(x => x / n); })();
export const AMBIENT = 0.42, DIFFUSE = 0.58;
const CREASE = Math.cos(60 * Math.PI / 180);
const DEPTH_FULL = 900, DEPTH_DARK = 0.45;    // at DEPTH_FULL below the road a corner is 45 % darker

const key = p => Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]);
function normal(p) {
  const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n);
  if (!len) return { n: [0, 1, 0], area: 0 };
  n = n.map(x => x / len);
  return { n, area: len / 2 };
}

// faces: [{p: [A, B, C], facing?}] (game coordinates, y up); roadPoints: points of the road (depth reference).
// Returns [[b0, b1, b2]] brightness 0..1 per corner, in the order of faces.
// smooth: false lights every face with its own normal (flat shading: the facets show)
export function lightFaces(faces, roadPoints = [], { smooth = true } = {}) {
  // face normals: up-facing, or towards `facing` for upright faces with a given front (kerb caps)
  const N = faces.map(f => {
    const r = normal(f.p);
    const want = f.facing || [0, 1, 0];
    if (r.n[0] * want[0] + r.n[1] * want[1] + r.n[2] * want[2] < 0) r.n = r.n.map(x => -x);
    return r;
  });
  const around = new Map();                         // corner position -> face indices
  faces.forEach((f, i) => f.p.forEach(p => { const k = key(p); if (!around.has(k)) around.set(k, []); around.get(k).push(i); }));
  // road height near a point: nearest road point within 3000 (grid hash)
  const cell = 500, grid = new Map();
  for (const p of roadPoints) { const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[2] / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  const roadY = p => {
    for (let r = 1; r <= 6; r++) {
      let best = null, bd = Infinity;
      const cx = Math.floor(p[0] / cell), cz = Math.floor(p[2] / cell);
      for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++)
        for (const q of grid.get(i + ',' + j) || []) { const d = (q[0] - p[0]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; best = q; } }
      if (best) return best[1];
    }
    return null;
  };
  const depthCache = new Map();
  const depthFactor = p => {
    const k = key(p);
    if (!depthCache.has(k)) {
      const y = roadY(p), depth = y === null ? 0 : Math.max(0, y - p[1]);
      depthCache.set(k, 1 - DEPTH_DARK * Math.min(1, depth / DEPTH_FULL));
    }
    return depthCache.get(k);
  };
  return faces.map((f, i) => f.p.map(p => {
    const own = N[i].n, sum = [0, 0, 0];
    for (const o of smooth ? around.get(key(p)) : [i]) {
      const n = N[o].n;
      if (own[0] * n[0] + own[1] * n[1] + own[2] * n[2] < CREASE) continue;
      const w = N[o].area || 1e-6;
      sum[0] += n[0] * w; sum[1] += n[1] * w; sum[2] += n[2] * w;
    }
    const len = Math.hypot(...sum) || 1, n = sum.map(x => x / len);
    const b = AMBIENT + DIFFUSE * Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
    return Math.max(0, Math.min(1, b * depthFactor(p)));
  }));
}

// Colour of a face: its colour (painted or the material's) times the face's light (the mean of its corners),
// relative to flat ground in the sun (which shows the colour as it is), and a small fixed variation per face (a few
// per cent, from its position) so that faces of the same slope still read as facets.
const FLAT = AMBIENT + DIFFUSE * SUN[1];
export const JITTER = 0.05;
export function faceColour(rgb, light, p) {
  const b = (light[0] + light[1] + light[2]) / 3;
  const c = [0, 1, 2].map(k => (p[0][k] + p[1][k] + p[2][k]) / 3);
  let h = Math.imul(Math.round(c[0]) | 0, 73856093) ^ Math.imul(Math.round(c[1]) | 0, 19349663) ^ Math.imul(Math.round(c[2]) | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const j = 1 + JITTER * (((h >>> 0) % 1000) / 500 - 1);
  return rgb.map(v => Math.max(0, Math.min(255, Math.round(v * b / FLAT * j))));
}
