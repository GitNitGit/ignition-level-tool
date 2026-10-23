// Sections of a level (the pieces the game knows as placements) and the helpers around them:
// junctions, bridges, geometry tests and the section ranges stored in the level (kerbs, flags).

// point `off` beyond the road edge on side s (+1 left; negative off: inside the road), at the height of the centre line
// (the road is level across; at junctions base.js lifts the points, junctions.js)
export const edgePoint = (f, s, off = 0) => [f.c[0] + f.left[0] * s * (f.half + off), f.c[1], f.c[2] + f.left[1] * s * (f.half + off)];

// distance from p (x, z) to segment a-b (x, z); returns [distance, t]
export function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz), t];
}
export function inQuad(p, q) {                // q: 4 points (x, z), any winding, convex
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    const o = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (o === 0) continue;
    if (sign === 0) sign = Math.sign(o);
    else if (Math.sign(o) !== sign) return false;
  }
  return true;
}
export function segCross(p, q, r, s) {         // proper intersection point of p-q and r-s, or null
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (!d) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return [t, u];
}

// spatial hash of items with a bounding box (x0, z0, x1, z1)
export class Hash {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  add(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = i + ',' + j;
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(item);
      }
  }
  near(x, z, r) {
    const c = this.cell, out = new Set();
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++)
        for (const it of this.map.get(i + ',' + j) || []) out.add(it);
    return out;
  }
}
export const quadBox = q => { const xs = q.map(p => p[0]), zs = q.map(p => p[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };

// Sections of all paths: [{id, path, j, f0, f1, jump, quad, c0, c1, half, y}]
export function terrainSections(paths) {
  const out = [];
  for (const p of paths.all) {
    const fr = p.frames, n = p.closed ? fr.length : fr.length - 1;
    for (let j = 0; j < n; j++) {
      const f0 = fr[j], f1 = fr[(j + 1) % fr.length];
      out.push({
        id: `${p.key}:${j}`, path: p, j, f0, f1, jump: p.jump[f0.seg],
        quad: [edgePoint(f0, -1), edgePoint(f0, 1), edgePoint(f1, 1), edgePoint(f1, -1)].map(q => [q[0], q[2]]),
        c0: [f0.c[0], f0.c[2]], c1: [f1.c[0], f1.c[2]], half: (f0.half + f1.half) / 2, y: (f0.c[1] + f1.c[1]) / 2,
      });
    }
  }
  return out;
}

// Sections with the flags used by base and bake: jump (gap, no road). anchor = the middle of the road (x, z).
// Placements, gates and junction meshes are the compiler's business (compile.js); bridges are cut per triangle
// (bridges.js).
export function analyseSections(paths) {
  const secs = terrainSections(paths);
  for (const s of secs) s.anchor = s.quad.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]);
  const byId = new Map(secs.map(s => [s.id, s]));
  return { secs, byId, active: secs.filter(s => !s.jump && !s.covered) };
}

// ------------------------------------------------------------ ranges stored in the level
// track.kerbs["<a|b>:<side>"], track.slippery["<a|b>"], track.order["<a|b>"] = [[t0, t1], ...] in the
// canonical direction of the segment (node ids sorted; side flips with it), so they stay in
// place when the sections are re-cut. Side: +1 = left, -1 = right in driving direction.
export function sectionRange(sec, side = null) {
  const [p, q] = sec.path.edge(sec.f0.seg);
  const canon = p < q;
  const t0 = sec.f0.t, t1 = sec.f1.seg === sec.f0.seg ? sec.f1.t : 1;
  const base = canon ? p + '|' + q : q + '|' + p;
  return { key: side === null ? base : `${base}:${canon ? side : -side}`,
           t0: canon ? t0 : 1 - t1, t1: canon ? t1 : 1 - t0 };
}
export function inRange(map, sec, side = null) {
  const r = sectionRange(sec, side), mid = (r.t0 + r.t1) / 2;
  return ((map || {})[r.key] || []).some(([a, b]) => a <= mid && mid <= b);
}
// add (on) or remove the given sections (and sides) in the range map
export function setRange(map, sections, sides, on) {
  for (const sec of sections) {
    for (const side of sides) {
      const r = sectionRange(sec, side);
      let list = map[r.key] || [];
      if (on) {
        list.push([r.t0, r.t1]);
        list.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const x of list) {
          const last = merged[merged.length - 1];
          if (last && x[0] <= last[1] + 1e-4) last[1] = Math.max(last[1], x[1]);
          else merged.push(x.slice());
        }
        list = merged;
      } else {
        list = list.flatMap(([a, b]) => {
          if (b <= r.t0 + 1e-6 || a >= r.t1 - 1e-6) return [[a, b]];
          return [[a, r.t0], [r.t1, b]].filter(([x, y]) => y - x > 1e-6);
        });
      }
      list = list.map(([a, b]) => [Number(a.toFixed(5)), Number(b.toFixed(5))]);
      if (list.length) map[r.key] = list; else delete map[r.key];
    }
  }
}
