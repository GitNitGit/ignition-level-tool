// Objects of the original levels for the Assets tab (Node, LEVELFORMAT.md ch. 3, 4, 6, 7, 15): reads a level's palette,
// textures, meshes and placements, lists its placeable objects (the object placements, types 150-154 and 200, and the
// objects embedded in the section meshes; no markers, no copies of animation tables; every shape once) and gives one
// as geometry in world orientation (y up, relative to its origin) with one colour per face: the mean of the texels inside the face's texture triangle
// (palette index 0 = transparent left out; `alpha` = the opaque share). The level's own palette and texture 0 then
// show that colour (core/palette.js); the original textures are not used.
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';

const OBJECT_TYPES = new Set([150, 152, 153, 154, 200]);
const cache = new Map();                     // dir -> parsed level

export async function listSourceLevels(levelsDir) {
  const out = [];
  for (const d of await fs.readdir(levelsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.endsWith('.org')) continue;
    for (const dir of [join(levelsDir, d.name + '.org'), join(levelsDir, d.name)]) {
      try { if ((await fs.readdir(dir)).some(f => extname(f).toLowerCase() === '.plc')) { out.push(d.name); break; } } catch { /* no such dir */ }
    }
  }
  return out.sort();
}

async function load(dir) {
  if (cache.has(dir)) return cache.get(dir);
  const files = await fs.readdir(dir);
  const pick = async ext => { const f = files.find(x => extname(x).toLowerCase() === ext); return f ? fs.readFile(join(dir, f)) : null; };
  const [msh, plc, col, tex] = await Promise.all(['.msh', '.plc', '.col', '.tex'].map(pick));
  if (!msh || !plc || !col || !tex) throw new Error(`not a level directory: ${dir}`);
  const pal = [];
  for (let i = 0; i < 256; i++) pal.push([col[8 + 3 * i], col[9 + 3 * i], col[10 + 3 * i]]);
  const dv = new DataView(msh.buffer, msh.byteOffset, msh.byteLength);
  const meshes = new Map();                  // dword offset -> {verts, faces}
  for (let off = 0; off + 8 <= msh.length;) {
    const nv = dv.getInt32(off, true), nf = dv.getInt32(off + 4, true);
    if (nv < 0 || nf < 0 || off + 8 + nv * 12 + nf * 44 > msh.length) break;
    const verts = [], faces = [];
    let p = off + 8;
    for (let i = 0; i < nv; i++, p += 12) verts.push([dv.getInt32(p, true), dv.getInt32(p + 4, true), dv.getInt32(p + 8, true)]);
    for (let i = 0; i < nf; i++, p += 44) {
      faces.push({ flags: dv.getUint16(p, true), surf: dv.getUint16(p + 2, true),
        idx: [dv.getInt32(p + 4, true), dv.getInt32(p + 8, true), dv.getInt32(p + 12, true)],
        uv: [[dv.getInt32(p + 16, true), dv.getInt32(p + 20, true)], [dv.getInt32(p + 24, true), dv.getInt32(p + 28, true)], [dv.getInt32(p + 32, true), dv.getInt32(p + 36, true)]],
        tex: dv.getInt32(p + 40, true) / 65536 });
    }
    meshes.set(off / 4, { verts, faces: faces.filter(f => new Set(f.idx).size === 3 && f.idx.every(i => i >= 0 && i < nv)) });
    off = p;
  }
  const pv = new DataView(plc.buffer, plc.byteOffset, plc.byteLength);
  const n = pv.getInt32(0, true), placements = [];
  for (let i = 0; i < n; i++) {
    const o = 4 + 20 * i;
    placements.push({ mesh: pv.getInt32(o, true), type: plc[o + 4], flags1: plc[o + 5], pos: [pv.getInt32(o + 8, true), pv.getInt32(o + 12, true), pv.getInt32(o + 16, true)] });
  }
  const L = { pal, meshes, placements, tex, nTex: Math.floor(tex.length / 65536), tileAvg: new Map() };
  cache.set(dir, L);
  return L;
}

const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const meshKey = m => m.verts.map(v => v.join(',')).sort().join(';');
function bbox(verts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

// mean colour of the texels of a 64 x 64 tile (index 0 left out)
function tileAverage(L, tex, tile) {
  const key = tex * 16 + tile;
  if (L.tileAvg.has(key)) return L.tileAvg.get(key);
  const x0 = (tile % 4) * 64, y0 = Math.floor(tile / 4) * 64, sum = [0, 0, 0];
  let n = 0, zero = 0;
  for (let y = y0; y < y0 + 64; y++) for (let x = x0; x < x0 + 64; x++) {
    const i = L.tex[tex * 65536 + y * 256 + x];
    if (!i) { zero++; continue; }
    n++; for (let k = 0; k < 3; k++) sum[k] += L.pal[i][k];
  }
  const r = { colour: n ? sum.map(v => v / n) : [128, 128, 128], alpha: n / (n + zero || 1) };
  L.tileAvg.set(key, r);
  return r;
}
// mean colour of the texels inside a face's texture triangle; a face whose triangle covers hardly any texel (flat
// colour, degenerate uvs) takes the texel at its centre, else its tile's mean
function faceColour(L, f) {
  const t = f.tex;
  if (!(t >= 0 && t < L.nTex)) return { colour: [128, 128, 128], alpha: 1 };
  const uv = f.uv.map(([u, v]) => [u / 256, v / 256]);
  const base = t * 65536, sum = [0, 0, 0];
  let n = 0, zero = 0;
  const xs = uv.map(q => q[0]), ys = uv.map(q => q[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(255, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(255, Math.ceil(Math.max(...ys)));
  const edge = (a, b, px, py) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const A = edge(uv[0], uv[1], uv[2][0], uv[2][1]);
  if (Math.abs(A) > 0.5) {
    const sA = Math.sign(A), tol = -0.75 * Math.sqrt(Math.abs(A));   // a little beyond the edges, so thin triangles get texels
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      if (edge(uv[0], uv[1], px, py) * sA < tol || edge(uv[1], uv[2], px, py) * sA < tol || edge(uv[2], uv[0], px, py) * sA < tol) continue;
      const i = L.tex[base + y * 256 + x];
      if (!i) { zero++; continue; }
      n++; for (let k = 0; k < 3; k++) sum[k] += L.pal[i][k];
    }
  }
  if (n + zero >= 4) return { colour: n ? sum.map(v => v / n) : [128, 128, 128], alpha: n / (n + zero) };
  const cx = Math.max(0, Math.min(255, Math.round((xs[0] + xs[1] + xs[2]) / 3))), cy = Math.max(0, Math.min(255, Math.round((ys[0] + ys[1] + ys[2]) / 3)));
  const i = L.tex[base + cy * 256 + cx];
  if (i) return { colour: L.pal[i], alpha: 1 };
  return tileAverage(L, t, Math.floor(Math.min(...xs) / 64) % 4 + 4 * (Math.floor(Math.min(...ys) / 64) % 4));
}

// ---------------------------------------------------------------- the placeable objects of a level
// Two sources: the object placements (types 150-154 and 200) and the objects embedded in the section meshes (types
// 0-8 and 50): most trees, bushes, huts and rocks of the originals are not placements of their own but groups of
// faces inside the landscape mesh that share no vertex with the ground (Brazil: 8 placements, about 300 such parts).
// Every distinct shape is listed once with the number of its occurrences (the originals do not instance: a tree
// planted 23 times is 23 meshes). Refs: "<index>" = a placement, "<index>.<k>" = loose part k of section mesh <index>.
const MIN_PART_FACES = 2, MIN_PART_HEIGHT = 30;
// groups of faces connected through shared vertex positions, as lists of face indices, the biggest (the ground) first
function faceGroups(m) {
  const key = v => v.join(','), id = new Map(), parent = [];
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const vid = v => { const k = key(v); if (!id.has(k)) { id.set(k, parent.length); parent.push(parent.length); } return id.get(k); };
  for (const f of m.faces) { const ids = f.idx.map(i => vid(m.verts[i])); for (let j = 1; j < 3; j++) parent[find(ids[j])] = find(ids[0]); }
  const by = new Map();
  m.faces.forEach((f, i) => { const g = find(vid(m.verts[f.idx[0]])); if (!by.has(g)) by.set(g, []); by.get(g).push(i); });
  return [...by.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
}
// the loose parts of a section mesh (face index lists), in a fixed order; a part needs some faces and some height
// (flat patches are ground)
function looseParts(L, index) {
  L.parts ||= new Map();
  if (L.parts.has(index)) return L.parts.get(index);
  const p = L.placements[index], m = p && L.meshes.get(p.mesh), out = [];
  if (m && (p.type <= 8 || p.type === 50)) {
    for (const g of faceGroups(m).slice(1)) {
      if (g.length < MIN_PART_FACES) continue;
      const ys = [...new Set(g.flatMap(i => m.faces[i].idx))].map(i => -m.verts[i][1]);
      if (Math.max(...ys) - Math.min(...ys) < MIN_PART_HEIGHT) continue;
      out.push(g);
    }
  }
  L.parts.set(index, out);
  return out;
}
// the mesh of an object in world orientation: verts y up relative to its origin (the placement point; a part's
// bottom centre), its faces
function objectMesh(L, index, part) {
  const p = L.placements[index], m = p && L.meshes.get(p.mesh);
  if (!m) return null;
  let faces = m.faces, verts = m.verts.map(([x, y, z]) => [x, -y, z]);
  if (part !== undefined) {
    const g = looseParts(L, index)[part];
    if (!g) return null;
    // only the part's vertices, re-indexed, relative to the part's bottom centre
    const old = [...new Set(g.flatMap(i => m.faces[i].idx))], map = new Map(old.map((i, k) => [i, k]));
    const used = old.map(i => verts[i]);
    const xs = used.map(v => v[0]), ys = used.map(v => v[1]), zs = used.map(v => v[2]);
    const o = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys), (Math.min(...zs) + Math.max(...zs)) / 2].map(Math.round);
    verts = used.map(v => [v[0] - o[0], v[1] - o[1], v[2] - o[2]]);
    faces = g.map(i => ({ ...m.faces[i], idx: m.faces[i].idx.map(j => map.get(j)) }));
  }
  return { p, verts, faces };
}
// what makes two objects the same: the same number of faces and vertices with the same tiles and texel corners
// (rounded to 16). Not the geometry: the originals scale and turn every copy of a tree a little and round the pylons'
// vertices differently, so copies never match exactly; two billboard trees showing the same image are one tree
const shapeKey = (verts, faces) => faces.length + ':' + verts.length + ':' + faces.map(f => f.tex + '#' + f.uv.map(q => Math.round(q[0] / 4096) + ',' + Math.round(q[1] / 4096)).join('/')).sort().join(';');
const usedVerts = (verts, faces) => [...new Set(faces.flatMap(f => f.idx))].map(i => verts[i]);

// the placeable objects of a level, each distinct shape once: [{index (the ref), type, part, faces, size: [w, h, d], count}]
export async function listObjects(dir) {
  const L = await load(dir);
  if (L.list) return L.list;
  const tables = new Set(L.placements.filter(p => p.type === 250).map(p => L.meshes.get(p.mesh)).filter(Boolean).map(meshKey));
  const seen = new Map(), out = [];
  const consider = (index, part, type, om) => {
    const k = shapeKey(om.verts, om.faces);
    if (seen.has(k)) { seen.get(k).count++; return; }
    const o = { index: part === undefined ? String(index) : `${index}.${part}`, type, part: part !== undefined, faces: om.faces.length, size: bbox(usedVerts(om.verts, om.faces)), count: 1 };
    seen.set(k, o); out.push(o);
  };
  L.placements.forEach((p, index) => {
    const m = L.meshes.get(p.mesh);
    if (!m) return;
    if (OBJECT_TYPES.has(p.type) && !(p.flags1 & 1)) {
      if (m.faces.length < 2) return;
      if (p.type === 200 && tables.has(meshKey(m))) return;            // a copy of an animation table's geometry (Canada)
      consider(index, undefined, p.type, objectMesh(L, index));
    } else if (p.type <= 8 || p.type === 50) {
      looseParts(L, index).forEach((g, k) => consider(index, k, p.type, objectMesh(L, index, k)));
    }
  });
  // order: the placed objects first, then the parts of the landscape, the pylons with warning lights last; bigger first
  const rank = o => (o.type === 154 ? 2 : o.part ? 1 : 0);
  out.sort((a, b) => rank(a) - rank(b) || b.faces - a.faces || a.index.localeCompare(b.index, undefined, { numeric: true }));
  L.list = out;
  return out;
}

// every listed object with its geometry, by ref (the library's previews), with its count
export async function getAllObjects(dir, levelName) {
  const out = {};
  for (const o of await listObjects(dir)) out[o.index] = { ...await getObject(dir, levelName, o.index), count: o.count, part: o.part };
  return out;
}
// one object: {name, type, verts: [[x, y, z]] (y up, relative to the origin),
// faces: [[a, b, c, "#rrggbb", flags, alpha, tile, uv]]} - tile = "<level>/<tex>/<n>" of the 64 x 64 tile the face shows
// (LEVELFORMAT.md ch. 4), uv = its corners in texels inside that tile (0..64)
export async function getObject(dir, levelName, ref) {
  const L = await load(dir);
  const [index, part] = String(ref).split('.').map(Number);
  const om = objectMesh(L, index, Number.isInteger(part) ? part : undefined);
  if (!om) throw new Error(`no object ${ref}`);
  const { p, verts } = om;
  const faces = om.faces.map(f => {
    const c = faceColour(L, f);
    let tile = null, tuv = null;
    if (f.tex >= 0 && f.tex < L.nTex) {
      const uv = f.uv.map(([u, v]) => [u / 256, v / 256]);
      const n = Math.floor(Math.min(...uv.map(q => q[0])) / 64) % 4 + 4 * (Math.floor(Math.min(...uv.map(q => q[1])) / 64) % 4);
      const u0 = (n % 4) * 64, v0 = Math.floor(n / 4) * 64;
      tile = `${levelName}/${f.tex}/${n}`;
      tuv = uv.map(([u, v]) => [Math.max(0, Math.min(64, u - u0)), Math.max(0, Math.min(64, v - v0))].map(x => Math.round(x * 100) / 100));
    }
    return [f.idx[0], f.idx[1], f.idx[2], hex(c.colour), f.flags, Math.round(c.alpha * 100) / 100, tile, tuv];
  });
  return { name: `${levelName} #${ref}`, type: p.type, verts, faces };
}
// a 64 x 64 tile of a level's texture as RGBA (palette index 0 = transparent)
export async function tilePixels(dir, tex, tile) {
  const L = await load(dir);
  if (!(tex >= 0 && tex < L.nTex && tile >= 0 && tile < 16)) throw new Error(`no tile ${tex}/${tile}`);
  const rgba = new Uint8Array(64 * 64 * 4), x0 = (tile % 4) * 64, y0 = Math.floor(tile / 4) * 64;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = L.tex[tex * 65536 + (y0 + y) * 256 + x0 + x], o = (y * 64 + x) * 4;
    if (!i) continue;
    rgba[o] = L.pal[i][0]; rgba[o + 1] = L.pal[i][1]; rgba[o + 2] = L.pal[i][2]; rgba[o + 3] = 255;
  }
  return rgba;
}
