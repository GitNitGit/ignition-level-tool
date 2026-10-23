// Textures on own assets (core). A body's texture is a planar projector: a frame in the asset's coordinates (origin,
// rotation, size = the world extent of one repeat of the image) through which the image is projected onto the
// body's faces; a vertex gets its texel from where it lies in the frame's plane (beyond the frame the image repeats).
// The game shows a face with one 64 x 64 tile only, so the compiler cuts a textured face along the tile lattice of
// the image into pieces that each lie in one tile (splitByTiles).
import { rotationOf, eulerOf } from './objects.js';

export const TILE = 64;
// texel coordinates (pixels of the image; may exceed it: repeats) of a point p (asset coordinates) in projector `t`
// t = {name, origin: [x, y, z], rot: [rx, ry, rz], size: [w, h] (world units), px: [width, height] (image pixels)}
export function projectUV(t, p) {
  const R = rotationOf(t.rot || [0, 0, 0]), o = t.origin || [0, 0, 0], d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  // the frame's local axes are the columns of R: x = width, y = height (image rows run down: v grows with -y)
  const lx = R[0][0] * d[0] + R[1][0] * d[1] + R[2][0] * d[2], ly = R[0][1] * d[0] + R[1][1] * d[1] + R[2][1] * d[2];
  const [w, h] = t.size, [pw, ph] = t.px || [TILE, TILE];
  return [(lx / w + 0.5) * pw, (0.5 - ly / h) * ph];
}
// the frame's corners (asset coordinates), for drawing it
export function projectorQuad(t) {
  const R = rotationOf(t.rot || [0, 0, 0]), o = t.origin || [0, 0, 0], [w, h] = t.size;
  const at = (x, y) => [0, 1, 2].map(i => o[i] + R[i][0] * x + R[i][1] * y);
  return [at(-w / 2, h / 2), at(w / 2, h / 2), at(w / 2, -h / 2), at(-w / 2, -h / 2)];     // top-left, top-right, bottom-right, bottom-left
}

// A textured face {p: [[x, y, z] x 3], uv: [[u, v] x 3] (texels of an image of tw x th tiles), ...} cut along the tile
// lattice: pieces [{...face, p, uv (texels inside their tile), tile: [i, j]}], the tile indices wrapped into the image.
// The mapping is affine, so the corners of a piece are interpolated in uv space.
export function splitByTiles(face, tw, th) {
  let polys = [face.p.map((p, k) => ({ p, uv: face.uv[k] }))];
  const clip = (axis, line, keepBelow) => {
    const out = [];
    for (const poly of polys) {
      const res = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const da = a.uv[axis] - line, db = b.uv[axis] - line;
        const ina = keepBelow ? da <= 1e-9 : da >= -1e-9, inb = keepBelow ? db <= 1e-9 : db >= -1e-9;
        if (ina) res.push(a);
        if (ina !== inb) {
          const t = da / (da - db);
          res.push({ p: [0, 1, 2].map(k => a.p[k] + (b.p[k] - a.p[k]) * t), uv: [0, 1].map(k => a.uv[k] + (b.uv[k] - a.uv[k]) * t) });
        }
      }
      if (res.length >= 3) out.push(res);
    }
    polys = out;
  };
  // the cells the face touches; a face lying on a tile line (all its texels at the same multiple of 64) belongs to
  // the cell above it
  const span = axis => { const a = Math.floor(Math.min(...face.uv.map(q => q[axis])) / TILE); let b = Math.ceil(Math.max(...face.uv.map(q => q[axis])) / TILE); if (b <= a) b = a + 1; return [a, b]; };
  const [u0, u1] = span(0), [v0, v1] = span(1), cells = [];
  for (let i = u0; i < u1; i++) for (let j = v0; j < v1; j++) {
    polys = [face.p.map((p, k) => ({ p, uv: face.uv[k] }))];
    clip(0, i * TILE, false); clip(0, (i + 1) * TILE, true); clip(1, j * TILE, false); clip(1, (j + 1) * TILE, true);
    for (const poly of polys) {
      // pieces without area in space are dropped (a face seen edge-on by the frame keeps its area: one texel column)
      const area3 = (() => { const n = [0, 0, 0], o = poly[0].p; for (let k = 1; k < poly.length - 1; k++) { const a = poly[k].p, b = poly[k + 1].p; const u = [a[0] - o[0], a[1] - o[1], a[2] - o[2]], v = [b[0] - o[0], b[1] - o[1], b[2] - o[2]]; n[0] += u[1] * v[2] - u[2] * v[1]; n[1] += u[2] * v[0] - u[0] * v[2]; n[2] += u[0] * v[1] - u[1] * v[0]; } return Math.hypot(...n) / 2; })();
      if (area3 < 1e-3) continue;
      const wrap = (v, n) => ((v % n) + n) % n;
      for (let k = 1; k < poly.length - 1; k++) {
        const corners = [poly[0], poly[k], poly[k + 1]];
        cells.push({ ...face, p: corners.map(c => c.p), uv: corners.map(c => [Math.max(0, Math.min(TILE, c.uv[0] - i * TILE)), Math.max(0, Math.min(TILE, c.uv[1] - j * TILE))]), tileIJ: [wrap(i, tw), wrap(j, th)] });
      }
    }
  }
  return cells;
}

// ------------------------------------------------------------------ the frame baked into its body (2026-10-11, user)
// A body's projector is stored in the body's own unit space (the shape before its size, rotation and position):
// t = {name, px, space: 'body', o: origin, ax: the frame's full width, ay: its full height} (vectors in unit space).
// So the texture moves, turns and scales with the body, and a copy of the body carries it. The frame is placed in
// asset coordinates (origin, rotation, size; frameOf / setFrame) and converted.
const bodyR = b => rotationOf(b.rot || [0, 0, 0]);
// a point of the asset in the body's unit space, and back
export function toUnit(b, p) {
  const R = bodyR(b), s = b.size || [1, 1, 1], t = b.pos || [0, 0, 0], d = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
  return [0, 1, 2].map(i => (R[0][i] * d[0] + R[1][i] * d[1] + R[2][i] * d[2]) / s[i]);
}
const unitVec = (b, v) => { const R = bodyR(b), s = b.size || [1, 1, 1]; return [0, 1, 2].map(i => (R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2]) / s[i]); };
export function fromUnit(b, u) {
  const R = bodyR(b), s = b.size || [1, 1, 1], t = b.pos || [0, 0, 0], x = [u[0] * s[0], u[1] * s[1], u[2] * s[2]];
  return [0, 1, 2].map(i => R[i][0] * x[0] + R[i][1] * x[1] + R[i][2] * x[2] + t[i]);
}
const vecFromUnit = (b, v) => { const R = bodyR(b), s = b.size || [1, 1, 1], x = [v[0] * s[0], v[1] * s[1], v[2] * s[2]]; return [0, 1, 2].map(i => R[i][0] * x[0] + R[i][1] * x[1] + R[i][2] * x[2]); };
// set the frame of body b from asset coordinates {origin, rot (degrees), size: [w, h]}
export function setFrame(b, { origin, rot, size }) {
  const R = rotationOf(rot || [0, 0, 0]), X = [R[0][0] * size[0], R[1][0] * size[0], R[2][0] * size[0]], Y = [R[0][1] * size[1], R[1][1] * size[1], R[2][1] * size[1]];
  Object.assign(b.texture, { space: 'body', o: toUnit(b, origin), ax: unitVec(b, X), ay: unitVec(b, Y) });
  delete b.texture.origin; delete b.texture.rot; delete b.texture.size;
}
// the frame of body b in asset coordinates: {origin, rot, size, quad} - rot and size of the frame squared up (a body
// scaled unevenly after the texture was placed can skew it); quad: its true corners
export function frameOf(b) {
  const t = b.texture;
  if (!t) return null;
  if (t.space !== 'body') return t.size ? { origin: t.origin || [0, 0, 0], rot: t.rot || [0, 0, 0], size: t.size, quad: projectorQuad(t) } : null;
  const origin = fromUnit(b, t.o), X = vecFromUnit(b, t.ax), Y = vecFromUnit(b, t.ay);
  const w = Math.hypot(...X) || 1, h = Math.hypot(...Y) || 1, x = X.map(v => v / w);
  let y = Y.map(v => v / h);
  const xy = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  y = y.map((v, k) => v - xy * x[k]); const yl = Math.hypot(...y) || 1; y = y.map(v => v / yl);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const rot = eulerOf([[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]);
  const at = (a, c) => origin.map((v, k) => v + X[k] * a + Y[k] * c);
  return { origin, rot, size: [w, h], quad: [at(-0.5, 0.5), at(0.5, 0.5), at(0.5, -0.5), at(-0.5, -0.5)] };
}
// a frame still in asset coordinates (older levels): baked into its body as it lies now
export function bakeFrame(b) {
  const t = b.texture;
  if (!t || t.space === 'body' || !t.size) return false;
  setFrame(b, { origin: t.origin || [0, 0, 0], rot: t.rot || [0, 0, 0], size: t.size });
  return true;
}
// the frame on a side of the body's unit shape: 'front' (+z), 'top' (+y), 'side' (+x), as wide and high as that side
export function fitFrameUnit(b, how) {
  const f = how === 'top' ? { o: [0, 0.5, 0], ax: [1, 0, 0], ay: [0, 0, -1] } : how === 'side' ? { o: [0.5, 0, 0], ax: [0, 0, -1], ay: [0, 1, 0] } : { o: [0, 0, 0.5], ax: [1, 0, 0], ay: [0, 1, 0] };
  if (b.kind === 'plane' && how === 'top') f.o = [0, 0, 0];
  Object.assign(b.texture, { space: 'body', ...f });
  delete b.texture.origin; delete b.texture.rot; delete b.texture.size;
}
// texel coordinates of an asset point p on body b (its frame in unit space): the point's place in the frame's plane
export function projectUVBody(b, p) {
  const t = b.texture, u = toUnit(b, p), d = [u[0] - t.o[0], u[1] - t.o[1], u[2] - t.o[2]], A = t.ax, B = t.ay;
  const cr = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]], dt = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const n = cr(A, B), bA = cr(B, n), bB = cr(n, A), da = dt(A, bA), db = dt(B, bB);
  const a = da ? dt(d, bA) / da : 0, c = db ? dt(d, bB) / db : 0, [pw, ph] = t.px || [TILE, TILE];
  return [(a + 0.5) * pw, (0.5 - c) * ph];
}
