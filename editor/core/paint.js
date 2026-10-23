// Painted colours (mode 3): one colour per triangle.
//   terrain triangles: level.terrain.tris[k][4] = '#rrggbb'
//   base triangles (road, markings, kerbs, verge, deck): level.paint.base["<a|b>:<side>|<strip>|<q>"] = [[t0, t1, '#rrggbb']]
//     the strip between two rows of a section (or 'cap0'/'cap1', 'deck'), q = the triangle of it; t0..t1 is the range
//     of the section on its segment in the canonical direction (sections.js), so the paint stays when the sections
//     are cut again.
// Unpainted triangles show their material's colour (materials.js).
import { sectionRange } from './sections.js';
import { MATERIALS } from './materials.js';
import { hex } from './palette.js';

export function baseSlot(t, an) {
  const s = an.byId.get(t.sec);
  if (!s) return null;
  const r = sectionRange(s, t.side || 1);
  return { key: `${r.key}|${t.strip}|${t.q}`, t0: r.t0, t1: r.t1, mid: (r.t0 + r.t1) / 2 };
}
export function baseColour(level, t, an) {
  const slot = baseSlot(t, an), list = slot && level.paint?.base?.[slot.key];
  const hit = list && list.find(([a, b]) => a <= slot.mid && slot.mid <= b);
  return hit ? hit[2] : null;
}
export function setBaseColour(level, t, an, colour) {
  const slot = baseSlot(t, an);
  if (!slot) return;
  level.paint ||= {};
  level.paint.base ||= {};
  let list = (level.paint.base[slot.key] || []).flatMap(([a, b, c]) => {
    if (b <= slot.t0 + 1e-6 || a >= slot.t1 - 1e-6) return [[a, b, c]];
    return [[a, slot.t0, c], [slot.t1, b, c]].filter(([x, y]) => y - x > 1e-6);
  });
  if (colour) list.push([Number(slot.t0.toFixed(5)), Number(slot.t1.toFixed(5)), colour]);
  list.sort((x, y) => x[0] - y[0]);
  if (list.length) level.paint.base[slot.key] = list; else delete level.paint.base[slot.key];
}
export const terrainColour = (level, k) => level.terrain?.tris[k]?.[4] || null;
export function setTerrainColour(level, k, colour) {
  const t = level.terrain.tris[k];
  if (!t) return;
  if (colour) t[4] = colour; else t.length = 4;
}
// the colour a material shows unpainted: the kerb colours of the level (track.kerb.colours in / top / out) or the
// material's own
const KERB_MAT = { kerbIn: 'in', kerbTop: 'top', kerbOut: 'out' };
export const materialColour = (mat, level = null) => (KERB_MAT[mat] && level?.track?.kerb?.colours?.[KERB_MAT[mat]]) || hex(MATERIALS[mat].color);

// ---------------------------------------------------------------- textures as paint (the Paint tab, "Texture")
// A painted value is a colour '#rrggbb' or a texture 'png:<name>@<size>@<mapping>': one of the user's images
// (data/textures/<name>.png), `size` = the world units one repeat of the image covers (its width), `mapping` how
// the image lies on the face: 'auto' (projected along the face's main axis: from above onto flat ground, from the
// side onto walls), 'road' (across and along the road: image up = driving direction, base faces only), 'top',
// 'front' (looking along z) or 'side' (along x). The texel coordinates follow from the face's position alone, so
// neighbouring faces continue the image seamlessly and nothing has to be stored per corner.
export const isTexturePaint = v => typeof v === 'string' && v.startsWith('png:');
export function parsePaint(v) {
  if (!v) return null;
  if (!isTexturePaint(v)) return { colour: v };
  const [name, size, map] = v.slice(4).split('@');
  return { tex: name, size: Math.max(1, Number(size) || 256), map: ['auto', 'road', 'top', 'front', 'side'].includes(map) ? map : 'auto' };
}
export const paintString = p => (p.tex ? `png:${p.tex}@${p.size}@${p.map}` : p.colour);
// the road frame of a section for the 'road' mapping: origin, forward (driving direction, x/z), left, and the distance
// driven up to the section's start on its path (cached on the analysis)
export function roadFrame(an, secId) {
  const s = an.byId.get(secId);
  if (!s) return null;
  an.roadFrames ||= new Map();
  if (!an.roadFrames.has(secId)) {
    const fr = s.path.frames, dist = [0];
    for (let j = 1; j <= fr.length; j++) { const a = fr[j - 1], b = fr[j % fr.length]; dist.push(dist[j - 1] + Math.hypot(b.c[0] - a.c[0], b.c[2] - a.c[2])); }
    for (const t of an.secs || an.byId.values()) if (t.path === s.path) {
      const d = [t.f1.c[0] - t.f0.c[0], t.f1.c[2] - t.f0.c[2]], l = Math.hypot(...d) || 1;
      an.roadFrames.set(t.id, { o: t.f0.c, fwd: [d[0] / l, d[1] / l], left: t.f0.left, d0: dist[t.j] || 0 });
    }
  }
  return an.roadFrames.get(secId) || null;
}
// texel coordinates of a face's corners for a texture paint p; meta = {w, h} of the image, frame = roadFrame(...)
// for base faces (null: 'road' falls back to 'auto')
export function paintUV(points, p, meta, frame = null) {
  const k = (meta.w || 64) / p.size;                         // texels per world unit
  let map = p.map;
  if (map === 'road' && !frame) map = 'auto';
  if (map === 'auto') {
    const [a, b, c] = points, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map(Math.abs);
    map = n[1] >= n[0] && n[1] >= n[2] ? 'top' : n[0] >= n[2] ? 'side' : 'front';
  }
  return points.map(q => {
    if (map === 'road') {
      const d = [q[0] - frame.o[0], q[2] - frame.o[2]];
      const along = frame.d0 + d[0] * frame.fwd[0] + d[1] * frame.fwd[1], lateral = d[0] * frame.left[0] + d[1] * frame.left[1];
      return [(meta.w || 64) / 2 - lateral * k, -along * k];
    }
    if (map === 'top') return [q[0] * k, -q[2] * k];
    if (map === 'side') return [q[2] * k, -q[1] * k];
    return [q[0] * k, -q[1] * k];
  });
}
