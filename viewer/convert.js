// Ignition level -> data for the browser viewer (level.json plus texture images).
// A pure function on the level's files as bytes: it runs in Node (the server
// converts the original levels from the game directory and the editor's levels
// straight from memory) and would run in a browser as well.
// File formats: docs/LEVELFORMAT.md.

const TEX_SIZE = 256 * 256;
const EFFECT_TEMPLATE = 250;     // placement type of parked animation tables (flip-books)
const OBJECT_SURFACE = 300;      // face code of moving objects; a minority of them = shadow
const FX_SURFACE = 78;           // animated effect faces (water, clouds, cloud shadows)
const SHADOW_ALPHA = 115;        // opacity of cloud shadows (approximation)
const FOG_FROM = 144, FOG_TO = 153;   // raw fog density 0..9, identical in all levels
const FOG_COLOR = [235, 235, 235];
const FOG_MAX_ALPHA = 170;
const BLEND_ALPHA = 0.5;         // opacity of translucent faces (flag 0x02)
const MIST_EMITTER = 102;        // marker at waterfall feet (Canada, Brazil): rising mist
const LAVA_EMITTERS = [95, 103]; // markers on lava (Iceland, Brazil): rising black smoke
const LIGHTNING_SURFACE = 26;    // face code only on the Canada puddles: lightning strikes there
const WARNING_LIGHT = 154;       // placement type: cone/buoy with a lamp quad (first 4 faces)
const MIN_NMI = 0.45;            // TFX pairing by mutual information

const isFog = c => c >= FOG_FROM && c <= FOG_TO;
const fogAlpha = c => (isFog(c) ? Math.trunc((c - FOG_FROM) / 9 * FOG_MAX_ALPHA) : 0);
const key = (t, n) => t + ',' + n;
const unkey = k => k.split(',').map(Number);

// ---------- readers ----------

export function loadPalette(col) {
  const pal = [];
  for (let i = 0; i < 256; i++) pal.push([col[8 + 3 * i], col[9 + 3 * i], col[10 + 3 * i]]);
  return pal;
}

// 256 x 256 textures (the last one may be shorter, Japan: 15 3/4)
export function loadTextures(tex) {
  const out = [], end = tex.length - (tex.length % 256);
  for (let i = 0; i < end; i += TEX_SIZE) out.push(tex.slice(i, Math.min(i + TEX_SIZE, end)));
  return out;
}

// n-th 64 x 64 tile of a 256 wide texture buffer
export function tile(buf, n) {
  const out = new Uint8Array(4096), by = Math.floor(n / 4) * 64, bx = (n % 4) * 64;
  for (let y = 0; y < 64; y++) out.set(buf.subarray((by + y) * 256 + bx, (by + y) * 256 + bx + 64), y * 64);
  return out;
}
function putTile(buf, n, data) {
  const by = Math.floor(n / 4) * 64, bx = (n % 4) * 64;
  for (let y = 0; y < 64; y++) buf.set(data.subarray(y * 64, y * 64 + 64), (by + y) * 256 + bx);
}
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);

// Map dword offset -> {verts: [[x, y, z]], faces: [{flags, surf, idx, uv, tex}]}
export function loadMeshes(msh) {
  const dv = view(msh), meshes = new Map();
  let off = 0;
  while (off + 8 <= msh.length) {
    const nv = dv.getInt32(off, true), nf = dv.getInt32(off + 4, true);
    const verts = [];
    for (let i = 0; i < nv; i++) {
      const o = off + 8 + i * 12;
      verts.push([dv.getInt32(o, true), dv.getInt32(o + 4, true), dv.getInt32(o + 8, true)]);
    }
    const fo = off + 8 + nv * 12, faces = [];
    for (let k = 0; k < nf; k++) {
      const o = fo + k * 44, uv = [];
      for (let j = 0; j < 3; j++) uv.push([dv.getInt32(o + 16 + j * 8, true) / 256, dv.getInt32(o + 20 + j * 8, true) / 256]);
      faces.push({ flags: dv.getUint16(o, true), surf: dv.getUint16(o + 2, true),
                   idx: [dv.getInt32(o + 4, true), dv.getInt32(o + 8, true), dv.getInt32(o + 12, true)],
                   uv, tex: Math.floor(dv.getInt32(o + 40, true) / TEX_SIZE) });
    }
    meshes.set(off / 4, { verts, faces });
    off = fo + nf * 44;
  }
  return meshes;
}

export function loadPlacements(plc) {
  const dv = view(plc), n = dv.getInt32(0, true), out = [];
  for (let i = 0; i < n; i++) {
    const o = 4 + i * 20;
    out.push({ mesh: dv.getInt32(o, true), flags: [plc[o + 4], plc[o + 5], plc[o + 6], plc[o + 7]],
               pos: [dv.getInt32(o + 8, true), dv.getInt32(o + 12, true), dv.getInt32(o + 16, true)] });
  }
  return out;
}

// .POS: int32 table[count] (-1 = static), then the blocks in table order:
// int32 n, n x (r0, x, y, z, r1, r2), int32 0. Map placement -> frames.
export function loadAnims(pos, count) {
  const anims = new Map();
  if (!pos) return anims;
  const dv = view(pos), v = i => dv.getInt32(i * 4, true), len = Math.floor(pos.length / 4);
  let o = count;
  for (let i = 0; i < count && i < len; i++) {
    if (v(i) === -1) continue;
    if (o >= len) break;
    const n = v(o), frames = [];
    for (let k = 0; k < n; k++) {
      const f = [];
      for (let j = 0; j < 6; j++) f.push(v(o + 1 + k * 6 + j));
      frames.push(f);
    }
    anims.set(i, frames);
    o += 2 + 6 * n;
  }
  return anims;
}

export const tileOf = uv => Math.floor(Math.min(...uv.map(p => p[0])) / 64) + 4 * Math.floor(Math.min(...uv.map(p => p[1])) / 64);

// ---------- effect tiles (.TFX) ----------

// Mutual information of two equally long index sequences, normalized to 0..1.
function nmi(a, b) {
  const n = a.length, ca = new Float64Array(256), cb = new Float64Array(256), cab = new Map();
  for (let i = 0; i < n; i++) {
    ca[a[i]]++; cb[b[i]]++;
    const k = a[i] * 256 + b[i];
    cab.set(k, (cab.get(k) || 0) + 1);
  }
  const H = c => { let h = 0; for (const x of c) if (x) h -= x / n * Math.log(x / n); return h; };
  const ha = H(ca), hb = H(cb);
  if (Math.min(ha, hb) <= 0) return 0;
  let mi = 0;
  for (const [k, c] of cab) mi += c / n * Math.log(c * n / (ca[Math.floor(k / 256)] * cb[k % 256]));
  return mi / Math.min(ha, hb);
}

// Replace animated tiles by their .TFX counterparts (LEVELFORMAT.md ch. 5):
// structural match first (a consistent per-pixel index mapping), the leftovers
// by mutual information, then a level-wide remap of the remaining effect tiles;
// colours that see-through tiles lose in their TFX version are punched out of
// the other see-through tiles of the same meshes. fxTiles: Set of "t,n";
// seethrough: Map "t,n" -> Set of mesh offsets.
function applyFx(texs, tfx, fxTiles, seethrough, minConsistency = 0.95) {
  const cache = new Map();
  for (let t = 0; t < texs.length; t++) for (let n = 0; n < Math.floor(texs[t].length / 4096); n++) cache.set(key(t, n), tile(texs[t], n));
  const votes = new Map(), holes = new Map(), done = new Set(), used = new Set();
  const nt = Math.floor(tfx.length / 4096);
  const put = (k, data) => { const [t, n] = unkey(k); putTile(texs[t], n, data); };
  for (let j = 0; j < nt; j++) {
    const f = tile(tfx, j);
    let best = [0, null, null];
    for (const [k, t] of cache) {
      const m = new Map();
      let ok = 0;
      for (let i = 0; i < 4096; i++) {
        if (!m.has(t[i])) m.set(t[i], f[i]);
        if (m.get(t[i]) === f[i]) ok++;
      }
      if (ok > best[0]) best = [ok, k, m];
    }
    const [ok, k, m] = best;
    if (!k || ok / 4096 < minConsistency || sameBytes(cache.get(k), f)) continue;
    // a real counterpart recolours roughly one-to-one; an empty or mask tile
    // maps many indices onto one and would "match" anything
    if (new Set(m.values()).size < 0.5 * m.size) continue;
    put(k, f);
    done.add(k); used.add(j);
    const src = cache.get(k);
    if (seethrough.has(k)) {
      for (let i = 0; i < 4096; i++) {
        const h = holes.get(src[i]) || [0, 0];
        h[0] += src[i] !== 0 && f[i] === 0 ? 1 : 0; h[1]++;
        holes.set(src[i], h);
      }
    }
    const moved = [...m.keys()].filter(a => a !== m.get(a));
    if (moved.length && new Set(moved.map(a => m.get(a))).size >= 0.6 * moved.length) {
      for (let i = 0; i < 4096; i++) {
        if (!votes.has(src[i])) votes.set(src[i], new Map());
        const v = votes.get(src[i]);
        v.set(f[i], (v.get(f[i]) || 0) + 1);
      }
    }
  }
  // TFX tiles the game redraws differently (the Japan fence: an orange gradient
  // in TEX, a wire mesh in TFX) share no clean colour mapping: pair the
  // leftovers with effect / see-through tiles by mutual information, best first
  const cand = [...new Set([...fxTiles, ...seethrough.keys()])].filter(k => cache.has(k) && !done.has(k));
  const pairs = [];
  for (let j = 0; j < nt; j++) {
    if (used.has(j)) continue;
    const f = tile(tfx, j);
    if (new Set(f).size < 3) continue;
    for (const k of cand) pairs.push([nmi(cache.get(k), f), j, k]);
  }
  const cmpKey = (a, b) => { const [ta, na] = unkey(a), [tb, nb] = unkey(b); return tb - ta || nb - na; };
  pairs.sort((a, b) => b[0] - a[0] || b[1] - a[1] || cmpKey(a[2], b[2]));
  for (const [score, j, k] of pairs) {
    if (score < MIN_NMI) break;
    if (used.has(j) || done.has(k)) continue;
    put(k, tile(tfx, j));
    done.add(k); used.add(j);
  }
  const remap = new Uint8Array(256);
  for (let a = 0; a < 256; a++) {
    remap[a] = a;
    const v = votes.get(a);
    if (v) { let best = -1; for (const [b, c] of v) if (c > best) { best = c; remap[a] = b; } }
  }
  let remapped = 0;
  for (const k of fxTiles) {
    if (done.has(k) || !cache.has(k)) continue;
    put(k, cache.get(k).map(c => remap[c]));
    remapped++;
  }
  const punch = new Uint8Array(256);
  for (let a = 0; a < 256; a++) { const h = holes.get(a); punch[a] = h && h[0] > h[1] / 2 ? 0 : a; }
  const matched = new Set();
  for (const k of done) for (const o of seethrough.get(k) || []) matched.add(o);
  for (const [k, owners] of seethrough) {
    if (done.has(k) || !cache.has(k) || ![...owners].some(o => matched.has(o))) continue;
    const data = cache.get(k).map(c => punch[c]);
    if (!sameBytes(data, cache.get(k))) { put(k, data); remapped++; }
  }
  return { replaced: done.size, remapped };
}

// ---------- gates (.TRI) and floor (.SRF) ----------

// Gates of the landscape placements (types 0..8 and 50) from the current mesh
// vertices; records of other placements and leftover memory are skipped
// (LEVELFORMAT.md ch. 9).
function loadGates(tri, places, meshes) {
  const out = [];
  if (!tri) return out;
  const dv = view(tri), n = Math.floor((tri.length - 4) / 500);
  for (let k = 0; k < n && k < places.length; k++) {
    const type = places[k].flags[0];
    if (!(type <= 8 || type === 50)) continue;
    const o = 4 + k * 500;
    const r = tri.subarray(o, o + 500);
    if (r.subarray(1, 45).every(c => c === 0) || r.subarray(15, 23).some(c => c) || r.subarray(37, 45).some(c => c)) continue;
    const { verts } = meshes.get(places[k].mesh);
    const [px, py, pz] = places[k].pos, pts = [];
    for (const p of [1, 23]) {
      const vi = dv.getUint16(o + p, true);
      if (vi < verts.length) { const [x, y, z] = verts[vi]; pts.push([x + px, py - y, z + pz]); }
    }
    if (pts.length < 2 || pts[0].every((c, i) => c === pts[1][i])) continue;
    out.push({ rec: k, kind: r[0], a: pts[0], b: pts[1], type });
  }
  return out;
}

// Faces listed in the .SRF (floor and walls of the landscape) as Set "placement,face".
// Stale records (older than the meshes, Austria) are matched by geometry.
function loadSrf(srf, places, meshes) {
  const floor = new Set();
  if (!srf) return floor;
  const dv = view(srf), gw = dv.getInt32(16, true), gh = dv.getInt32(20, true), n = dv.getInt32(24, true);
  const base = 36 + gw * gh * 12;
  const corners = new Map(), byAnchor = new Map();
  places.forEach((p, pl) => {
    const { verts, faces } = meshes.get(p.mesh);
    faces.forEach((f, fi) => {
      const c = new Set(f.idx.map(i => (verts[i][0] + p.pos[0]) + ',' + (verts[i][2] + p.pos[2])));
      corners.set(pl + ',' + fi, c);
      for (const xz of c) { if (!byAnchor.has(xz)) byAnchor.set(xz, []); byAnchor.get(xz).push(pl + ',' + fi); }
    });
  });
  for (let k = 0; k < n; k++) {
    const o = base + k * 24;
    if (o + 24 > srf.length) break;
    const x = dv.getInt32(o, true) - 25600, z = dv.getInt32(o + 4, true) - 25600;
    const s1 = dv.getInt32(o + 8, true), s2 = dv.getInt32(o + 12, true), h = dv.getInt16(o + 16, true);
    const u = dv.getUint16(o + 18, true), pl42 = dv.getInt32(o + 20, true);
    const anchor = x + ',' + z, pl = Math.floor(pl42 / 42);
    if (pl42 % 42 === 0 && pl >= 0 && pl < places.length) {
      const nv = meshes.get(places[pl].mesh).verts.length;
      const d = u - 2 - 3 * nv, fi = Math.floor(d / 11);
      if (d % 11 === 0 && corners.get(pl + ',' + fi)?.has(anchor)) { floor.add(pl + ',' + fi); continue; }
    }
    // stale index: find the face by geometry (anchor + an edge end at z +- h)
    const ends = [];
    for (const sl of [s1, s2]) for (const dz of [h, -h]) ends.push([x + sl / 65536 * dz, z + dz]);
    for (const fk of byAnchor.get(anchor) || []) {
      for (const c of corners.get(fk)) {
        if (c === anchor) continue;
        const [cx, cz] = c.split(',').map(Number);
        if (ends.some(([ex, ez]) => Math.abs(cx - ex) <= 3 && Math.abs(cz - ez) <= 3)) { floor.add(fk); break; }
      }
    }
  }
  return floor;
}

// ---------- images ----------

// palette indices -> RGBA. mode '': opaque; 'ck', 'blend': index 0 transparent;
// 'shadow': translucent black wherever index != 0; 'fog': light grey with the
// raw fog density as alpha
function toRGBA(idx, pal, mode = '') {
  const out = new Uint8Array(idx.length * 4);
  for (let i = 0; i < idx.length; i++) {
    const c = idx[i], o = i * 4;
    if (mode === 'shadow') { out[o + 3] = c === 0 ? 0 : SHADOW_ALPHA; continue; }
    if (mode === 'fog') { out.set(FOG_COLOR, o); out[o + 3] = fogAlpha(c); continue; }
    out.set(pal[c], o);
    out[o + 3] = (mode === 'ck' || mode === 'blend') && c === 0 ? 0 : 255;
  }
  return out;
}

// frames of a GENERAL .tfx (64 x 64 each, four per row) side by side, in the system palette
function spriteStrip(tfx, syspal, frames) {
  const w = 64 * frames, idx = new Uint8Array(w * 64);
  for (let y = 0; y < 64; y++) for (let i = 0; i < frames; i++) {
    const o = Math.floor(i / 4) * 64 * 256 + y * 256 + (i % 4) * 64;
    idx.set(tfx.subarray(o, o + 64), y * w + i * 64);
  }
  return { w, h: 64, rgba: toRGBA(idx, syspal, 'ck') };
}

// ---------- the conversion ----------

// files: {COL, TEX, MSH, PLC, TRI?, SRF?, POS?, TFX?} as Uint8Array; sounds:
// names of the level's sound files ("Sound/03_TRAIN.WAV"); general: {syscol,
// smoke, darksmok, light} from the game directory (optional: without them the
// viewer leaves the sprites out). Returns {level, images: Map name -> {w, h, rgba},
// tris: the world's triangles (for exportObj), ntex: the number of textures}.
export function convertLevel(name, files, { sounds = [], general = {} } = {}) {
  const pal = loadPalette(files.COL);
  const texs = loadTextures(files.TEX);
  const meshes = loadMeshes(files.MSH);
  const places = loadPlacements(files.PLC);
  const frameMap = loadAnims(files.POS, places.length);
  const lastTex = t => Math.min(t, texs.length - 1);

  // animated placements: pivot path + offset of the object to the first pivot
  const anims = new Map();
  for (const [i, f] of frameMap) {
    if (!f.length) continue;
    anims.set(i, { offset: places[i].pos.map((p, k) => p - f[0][1 + k]), frames: f, pos: places[i].pos });
  }
  // the world: triangles and markers
  const tris = [], markers = [];
  const templates = places.filter(p => p.flags[0] === EFFECT_TEMPLATE).map(p => meshes.get(p.mesh).verts);
  const isTemplate = verts => templates.some(t => t.length === verts.length &&
    verts.every(u => t.some(v => Math.max(...u.map((a, k) => Math.abs(a - v[k]))) <= 4)));
  places.forEach((p, pl) => {
    const mesh = meshes.get(p.mesh);
    if (!mesh) return;
    const { verts, faces } = mesh;
    const [px, py, pz] = p.pos;
    if (p.flags[1] === 1 && faces.length === 1) {
      // invisible single-triangle marker; id 144 + n = ambient sound n
      const m = { type: 'marker', id: p.flags[0], pos: p.pos, pl };
      if (anims.has(pl)) m.anim = anims.get(pl);
      markers.push(m);
      return;
    }
    if (p.flags[1] === 1 && new Set(verts.map(v => v[1])).size === 1) {
      // flat object: particle emitter (Iceland geysers), not drawn in the game
      markers.push({ type: 'emitter', id: p.flags[0], pos: p.pos, pl, surface: faces[0]?.surf });
      return;
    }
    if (p.flags[0] === EFFECT_TEMPLATE || isTemplate(verts)) {
      // parked animation table: tiles in face order, the first is the tile the world shows
      const m = { type: 'effect_template', mesh: p.mesh, pos: p.pos, faces: faces.length };
      if (p.flags[0] === EFFECT_TEMPLATE) m.seq = faces.map(f => [f.tex, tileOf(f.uv)]);
      markers.push(m);
      return;
    }
    const wv = verts.map(([x, y, z]) => [x + px, py - y, z + pz]);    // local y points down
    if (p.flags[0] === WARNING_LIGHT && p.flags[1] === 0) {
      const lamp = [...new Set(faces.slice(0, 4).flatMap(f => f.idx))];
      const ys = lamp.map(i => wv[i][1]);
      markers.push({ type: 'blinker', pl, pos: [0, 1, 2].map(k => Math.round(lamp.reduce((s, i) => s + wv[i][k], 0) / lamp.length * 10) / 10),
                     size: Math.max(...ys) - Math.min(...ys) });
    }
    // a few object-type faces (300) in an otherwise normal mesh: flat silhouette
    // under the object, i.e. its shadow (Japan plane)
    const n300 = faces.filter(f => f.surf === OBJECT_SURFACE).length;
    faces.forEach((f, fi) => {
      const mode = f.surf === OBJECT_SURFACE && n300 < faces.length / 2 ? 'shadow'
        // the game draws object-type faces (hovercrafts) opaque despite 0x02
        : (f.flags & 3) === 3 && f.surf !== OBJECT_SURFACE ? 'blend' : 'ck';
      tris.push({ v: f.idx.map(i => wv[i]), uv: f.uv, tex: f.tex, mode, surf: f.surf, pl, flags: f.flags, fi });
    });
  });

  // effect tiles: mostly used by effect faces (a stray effect face on a rock tile
  // must not turn the rock into an effect)
  const uses = new Map();
  for (const t of tris) {
    const k = key(t.tex, tileOf(t.uv)), c = uses.get(k) || [0, 0];
    c[t.surf === FX_SURFACE ? 1 : 0]++;
    uses.set(k, c);
  }
  const fxTiles = new Set([...uses].filter(([, [other, fx]]) => fx >= other).map(([k]) => k));
  for (const m of markers) if (m.seq && fxTiles.has(key(...m.seq[0]))) for (const s of m.seq) fxTiles.add(key(...s));
  // fog tiles keep their raw density values (TFX would recolour them opaque)
  const fogTiles = new Map();
  for (const k of fxTiles) {
    const [t, n] = unkey(k), data = tile(texs[lastTex(t)], n);
    if (data.every(c => c === 0 || isFog(c))) fogTiles.set(k, data);
  }
  if (files.TFX) {
    const seethrough = new Map();
    for (const [off, { faces }] of meshes) {
      for (const f of faces) {
        if (!(f.flags & 2) || f.surf === FX_SURFACE) continue;
        const k = key(f.tex, tileOf(f.uv));
        if (!seethrough.has(k)) seethrough.set(k, new Set());
        seethrough.get(k).add(off);
      }
    }
    applyFx(texs, files.TFX, new Set([...fxTiles].filter(k => !fogTiles.has(k))), seethrough);
  }
  for (const [k, data] of fogTiles) { const [t, n] = unkey(k); putTile(texs[lastTex(t)], n, data); }
  // effect tiles that end up very dark and lie flat are cloud shadows
  // (dark upright parts like the Japan X braces are not)
  const flat = new Map();
  for (const t of tris) {
    const [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]] = t.v;
    const nx = (y2 - y1) * (z3 - z1) - (z2 - z1) * (y3 - y1);
    const ny = (z2 - z1) * (x3 - x1) - (x2 - x1) * (z3 - z1);
    const nz = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
    const k = key(t.tex, tileOf(t.uv)), c = flat.get(k) || [0, 0];
    c[Math.abs(ny) > 0.8 * Math.sqrt(nx * nx + ny * ny + nz * nz) ? 1 : 0]++;
    flat.set(k, c);
  }
  const shadowTiles = new Set();
  for (const k of fxTiles) {
    if (fogTiles.has(k)) continue;
    const [t, n] = unkey(k), px = [...tile(texs[lastTex(t)], n)].filter(c => c);
    const [upright, lying] = flat.get(k) || [1, 0];
    if (px.length && px.reduce((s, c) => s + pal[c][0] + pal[c][1] + pal[c][2], 0) / (3 * px.length) < 40 && lying > upright) shadowTiles.add(k);
  }
  for (const t of tris) {
    const k = key(t.tex, tileOf(t.uv));
    if (fogTiles.has(k)) t.mode = 'fog'; else if (shadowTiles.has(k)) t.mode = 'shadow';
  }
  // sound files of the markers (Sound/NN_name.*, NN = id - 144)
  const soundBySlot = new Map();
  for (const s of sounds) {
    const base = s.split('/').pop(), m = /^(\d\d)/.exec(base);
    if (m && /\.(wav|pat|xi)$/i.test(base)) soundBySlot.set(Number(m[1]), s);
  }
  for (const m of markers) if (m.type === 'marker') m.sound = soundBySlot.get(m.id - 144) ?? null;

  // ---- viewer data ----
  const images = new Map();
  const groups = new Map(), objects = new Map();
  for (const t of tris) {
    const tex = lastTex(t.tex), double = !!(t.flags & 4);
    let base = [0, 0, 0], target = groups;
    if (anims.has(t.pl)) {
      const a = anims.get(t.pl);
      base = a.pos;
      if (!objects.has(t.pl)) objects.set(t.pl, { pl: t.pl, offset: a.offset, frames: a.frames.flat(), groups: new Map() });
      target = objects.get(t.pl).groups;
    }
    const gk = `${tex}|${t.mode}|${double}`;
    if (!target.has(gk)) target.set(gk, { tex, mode: t.mode, double, pos: [], uv: [] });
    const g = target.get(gk);
    t.v.forEach(([x, y, z], i) => {
      g.pos.push(x - base[0], y - base[1], z - base[2]);
      g.uv.push(Math.round(t.uv[i][0] * 100) / 100, Math.round(t.uv[i][1] * 100) / 100);
    });
  }
  const used = new Map();                  // "tex|mode" -> [tex, mode]
  for (const g of groups.values()) used.set(g.tex + '|' + g.mode, [g.tex, g.mode]);
  for (const o of objects.values()) for (const g of o.groups.values()) used.set(g.tex + '|' + g.mode, [g.tex, g.mode]);
  const texName = (tex, mode) => `tex${String(tex).padStart(2, '0')}${mode ? '_' + mode : ''}.png`;
  const textures = {};
  for (const [tex, mode] of used.values()) {
    const fn = texName(tex, mode), h = Math.floor(texs[tex].length / 256);
    images.set(fn, { w: 256, h, rgba: toRGBA(texs[tex], pal, mode) });
    textures[fn] = h;
  }
  // flip-books: for every texture file showing an animated tile a strip of all frames
  const flipbooks = [];
  markers.filter(m => m.seq).forEach((m, k) => {
    const [kt, kn] = m.seq[0], frames = m.seq, files2 = {};
    for (const [tex, mode] of used.values()) {
      if (tex !== lastTex(kt)) continue;
      const fn = `anim${String(k).padStart(2, '0')}${mode ? '_' + mode : ''}.png`;
      if (Object.values(files2).includes(fn)) continue;
      const w = 64 * frames.length, strip = new Uint8Array(w * 64);
      frames.forEach(([t, n], i) => {
        const data = tile(texs[lastTex(t)], n);
        for (let y = 0; y < 64; y++) strip.set(data.subarray(y * 64, y * 64 + 64), y * w + i * 64);
      });
      images.set(fn, { w, h: 64, rgba: toRGBA(strip, pal, mode) });
      files2[texName(tex, mode)] = fn;
    }
    if (Object.keys(files2).length) flipbooks.push({ tile: [(kn % 4) * 64, Math.floor(kn / 4) * 64], frames: frames.length, files: files2 });
  });
  // lightning targets: centres of the faces with surface code 26 (per placement)
  const hits = new Map();
  for (const t of tris) if (t.surf === LIGHTNING_SURFACE) { if (!hits.has(t.pl)) hits.set(t.pl, []); hits.get(t.pl).push(...t.v); }
  const lightning = [...hits.values()].map(vs => [0, 1, 2].map(k => Math.round(vs.reduce((s, v) => s + v[k], 0) / vs.length * 10) / 10));
  // sprites from GENERAL (system palette): dark smoke, warning lights, mist puffs
  const syspal = general.syscol ? loadPalette(general.syscol) : null;
  let darksmoke = null, light = null, smoke = null;
  if (syspal && general.darksmok && (lightning.length || markers.some(m => m.type === 'marker' && LAVA_EMITTERS.includes(m.id)))) {
    images.set('darksmoke.png', spriteStrip(general.darksmok, syspal, 8)); darksmoke = 'darksmoke.png';
  }
  if (syspal && general.light && markers.some(m => m.type === 'blinker')) {
    images.set('light.png', spriteStrip(general.light, syspal, 5)); light = 'light.png';
  }
  if (syspal && general.smoke && markers.some(m => m.id === MIST_EMITTER || m.type === 'emitter')) {
    images.set('smoke.png', spriteStrip(general.smoke, syspal, 8)); smoke = 'smoke.png';
  }
  // collision (.SRF floor vs. the rest, surface codes, face flag 0x04) and placements
  const floor = loadSrf(files.SRF, places, meshes);
  const collision = { floor: [], other: [], surf: {}, flag4: [] };
  const plc = new Map();
  for (const t of tris) {
    if (anims.has(t.pl)) continue;
    const flatV = t.v.flat();
    if (t.flags & 4) collision.flag4.push(...flatV);
    (floor.has(t.pl + ',' + t.fi) ? collision.floor : collision.other).push(...flatV);
    (collision.surf[t.surf] ||= []).push(...flatV);
    const p = places[t.pl];
    if (!plc.has(t.pl)) plc.set(t.pl, { pl: t.pl, type: p.flags[0], flags: p.flags.slice(1), pos: p.pos, radius: 0, faces: 0, xyz: [] });
    const e = plc.get(t.pl);
    e.xyz.push(...flatV);
    for (const [x, , z] of t.v) e.radius = Math.max(e.radius, Math.round(Math.hypot(x - p.pos[0], z - p.pos[2])));
    e.faces++;
  }
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t.v) for (let k = 0; k < 3; k++) {
    bounds[k] = Math.min(bounds[k], v[k]); bounds[k + 3] = Math.max(bounds[k + 3], v[k]);
  }
  if (!tris.length) bounds.fill(0);
  const level = {
    name, triangles: tris.length, textures, bounds,
    groups: [...groups.values()],
    objects: [...objects.values()].map(o => ({ ...o, groups: [...o.groups.values()] })),
    flipbooks, smoke, light, lightning, darksmoke,
    gates: loadGates(files.TRI, places, meshes),
    collision,
    placements: [...plc.values()],
    markers: markers.map(m => (m.anim ? { ...m, anim: { offset: m.anim.offset, frames: m.anim.frames.flat() } } : m)),
  };
  return { level, images, tris, ntex: texs.length };
}

// The level as Wavefront OBJ + MTL (one object per texture and mode, metres: game units / 100,
// z mirrored to a right-handed system). The MTL names the texture images of convertLevel
// (tex<NN>_<mode>.png). Returns {obj, mtl, images: [png names]}.
export function exportObj(tris, name, ntex, scale = 0.01) {
  const byMat = new Map();
  for (const t of tris) {
    const k = t.tex + '|' + t.mode;
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k).push(t);
  }
  const mats = [...byMat.keys()].map(k => k.split('|')).map(([t, m]) => [Number(t), m])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const nn = n => String(n).padStart(2, '0');
  const obj = [`mtllib ${name}.mtl`], mtl = [], images = new Set();
  let vi = 1;
  for (const [tex, mode] of mats) {
    const mat = `tex${nn(tex)}${mode ? '_' + mode : ''}`;
    obj.push(`o ${name}_${mat}`, `usemtl ${mat}`);
    for (const { v, uv } of byMat.get(tex + '|' + mode)) {
      for (const [x, y, z] of v) obj.push(`v ${(x * scale).toFixed(4)} ${(y * scale).toFixed(4)} ${(-z * scale).toFixed(4)}`);
      for (const [u, w] of uv) obj.push(`vt ${(u / 256).toFixed(5)} ${(1 - w / 256).toFixed(5)}`);
      obj.push(`f ${vi}/${vi} ${vi + 1}/${vi + 1} ${vi + 2}/${vi + 2}`);
      vi += 3;
    }
    const png = `tex${nn(Math.min(tex, ntex - 1))}${mode ? '_' + mode : ''}.png`;
    images.add(png);
    mtl.push(`newmtl ${mat}`, 'Kd 1 1 1', ...(mode === 'blend' ? [`d ${BLEND_ALPHA.toFixed(2)}`] : []), `map_Kd ${png}`,
             ...(mode ? [`map_d -imfchan m ${png}`] : []), '');
  }
  return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n'), images: [...images] };
}
