// How much depth bonus (in buckets) would a car on the road need so that no ground triangle is drawn over it?
// node editor/test/needbias.mjs <dir> <NAME> [firstPlacement lastPlacement]   (works on original and compiled levels)
// Painter: key = (z0+z1+z2)>>4 of the camera depths, smaller key = drawn later = on top. Car point on the road surface.
import { readFileSync } from 'node:fs';
const [,, dir, name, a0, a1] = process.argv;
const M = readFileSync(`${dir}/${name}.MSH`), C = readFileSync(`${dir}/${name}.PLC`), N = C.readInt32LE(0);
const pl = k => { const o = 4 + 20 * k; return { off: C.readInt32LE(o) * 4, type: C[o + 4], p: [C.readInt32LE(o + 8), C.readInt32LE(o + 12), C.readInt32LE(o + 16)] }; };
const meshes = [];
for (let k = 0; k < N; k++) {
  const c = pl(k); if (c.type > 8) continue;
  const nv = M.readInt32LE(c.off), nf = M.readInt32LE(c.off + 4), vb = c.off + 8, fb = vb + 12 * nv, tri = [];
  const V = i => [c.p[0] + M.readInt32LE(vb + 12 * i), c.p[1] - M.readInt32LE(vb + 12 * i + 4), c.p[2] + M.readInt32LE(vb + 12 * i + 8)];
  for (let i = 0; i < nf; i++) { const b = fb + 44 * i, sf = M.readUInt16LE(b + 2), ix = [4, 8, 12].map(s => M.readInt32LE(b + s));
    if (new Set(ix).size < 3) continue; tri.push({ v: ix.map(V), sf }); }
  meshes.push({ k, c, tri });
}
const first = +(a0 ?? 0), last = +(a1 ?? N - 2);
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const cams = [[600, 300, 0.35], [900, 500, 0.45], [400, 200, 0.25]];
const hist = {};
for (const [back, height, pitch] of cams) {
  const need = [];
  for (const m of meshes) {
    if (m.k < first || m.k > last) continue;
    const nx = pl(m.k + 1).p; let f = [nx[0] - m.c.p[0], nx[2] - m.c.p[2]]; const fl = Math.hypot(...f); f = f.map(v => v / fl); const left = [-f[1], f[0]];
    const roads = m.tri.filter(t => t.sf < 78 && t.sf % 5 === 0);
    const near = meshes.filter(o => Math.abs(o.c.p[0] - m.c.p[0]) < 2500 && Math.abs(o.c.p[2] - m.c.p[2]) < 2500);
    for (let s = 0; s < 60 && roads.length; s++) {
      const t = roads[(rnd() * roads.length) | 0]; let u = rnd(), w = rnd(); if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const c = [0, 1, 2].map(i => t.v[0][i] * (1 - u - w) + t.v[1][i] * u + t.v[2][i] * w);
      const lat = (c[0] - m.c.p[0]) * left[0] + (c[2] - m.c.p[2]) * left[1]; if (Math.abs(lat) > 110) continue;   // car drives near the middle
      const cam = [c[0] - f[0] * back, c[1] + height, c[2] - f[1] * back];
      const fw = [f[0] * Math.cos(pitch), -Math.sin(pitch), f[1] * Math.cos(pitch)], rt = [f[1], 0, -f[0]];
      const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
      const view = p => { const d = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]]; return [d[0]*rt[0]+d[1]*rt[1]+d[2]*rt[2], d[0]*up[0]+d[1]*up[1]+d[2]*up[2], d[0]*fw[0]+d[1]*fw[1]+d[2]*fw[2]]; };
      const vc = view(c), zc = vc[2], carKey = (3 * zc) >> 4, sx = vc[0] / zc, sy = vc[1] / zc;
      const proj = tt => tt.v.map(p => { const q = view(p); return { x: q[0] / q[2], y: q[1] / q[2], z: q[2] }; });
      const cross = q => (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[1].y - q[0].y) * (q[2].x - q[0].x);
      const inside = q => { const d = (p, r) => (r.x - p.x) * (sy - p.y) - (r.y - p.y) * (sx - p.x); const e = [d(q[0], q[1]), d(q[1], q[2]), d(q[2], q[0])]; return e.every(v => v >= 0) || e.every(v => v <= 0); };
      const own = cross(proj(t)); if (!own) continue;
      let best = 0;
      for (const o of near) for (const g of o.tri) {
        const q = proj(g); if (q.some(v => v.z <= 0) || q[0].z + q[1].z + q[2].z <= 600) continue;
        const cr = cross(q); if (!cr || (cr > 0) !== (own > 0)) continue;       // back face: not drawn
        if (!inside(q)) continue;
        best = Math.max(best, carKey - ((q[0].z + q[1].z + q[2].z) >> 4));       // buckets the car needs to stay above this triangle
      }
      need.push(best);
    }
  }
  need.sort((x, y) => x - y); const p = q => need[Math.min(need.length - 1, Math.floor(need.length * q))];
  console.log(`cam ${back}/${height}/${pitch}: samples ${need.length}  needed bonus (buckets) median ${p(.5)}  p90 ${p(.9)}  p99 ${p(.99)}  max ${p(1)}   share needing > 0: ${(100 * need.filter(v => v > 0).length / need.length).toFixed(0)} %`);
}
