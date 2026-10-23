// Own palette and textures of a compiled level (Node). No tiles of the original game: texture 0 is a grid of
// 16 x 16 cells, one plain colour per cell (core/palette.js: the level's palette, painted colours with the baked
// light); a face shows one colour by pointing into its cell. The game needs at least 16 textures (otherwise the car
// tyres turn light grey, LEVELFORMAT.md ch. 4), so textures 1..15 repeat texture 0.
//
// Palette (LEVELFORMAT.md ch. 3, as editor/atlas.js 'own', tested in the game):
// index 0 transparent, 1..3 and 160..255 (cars, effects; the same in all
// levels) kept from the source level, the level's colours from index 4 on.
// The colour tables .SHD/.TAB/.PAN (3dfx version, car shading) are transferred
// to the new palette.
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { PAL_FROM, PAL_TO, CELL } from './core/palette.js';

const OWN_FROM = PAL_FROM, FIXED_FROM = PAL_TO;

async function readSource(dir) {
  const files = await fs.readdir(dir);
  const pick = ext => { const f = files.find(x => extname(x).toLowerCase() === ext); return f ? fs.readFile(join(dir, f)) : null; };
  const col = await pick('.col');
  if (!col) throw new Error(`no .COL in ${dir}`);
  const pal = [];
  for (let i = 0; i < 256; i++) pal.push([col[8 + 3 * i], col[9 + 3 * i], col[10 + 3 * i]]);
  return { pal, shd: await pick('.shd'), tab: await pick('.tab'), pan: await pick('.pan') };
}

// .SHD columns / .TAB and .PAN rows are indexed by colour: a new colour goes to the
// nearest source colour, the source table gives the result, which goes back to the
// nearest new colour (copied from editor/atlas.js remapTables)
function remapTables(srcPal, pal, usable, tables) {
  const fixed = i => i === 0 || i < OWN_FROM || i >= FIXED_FROM;
  const nearestIn = (list, colours) => c => {
    let best = Infinity, at = 0;
    for (const j of list) {
      const p = colours[j], d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < best) { best = d; at = j; }
    }
    return at;
  };
  const toSrc = nearestIn([...Array(255).keys()].map(i => i + 1), srcPal);
  const toOwn = nearestIn(usable, pal);
  const inSrc = new Uint8Array(256), outOwn = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    inSrc[i] = fixed(i) ? i : toSrc(pal[i]);
    outOwn[i] = fixed(i) ? i : toOwn(srcPal[i]);
  }
  const out = {};
  for (const [ext, t, axis] of tables) {
    const n = new Uint8Array(65536);
    for (let r = 0; r < 256; r++)
      for (let c = 0; c < 256; c++)
        n[r * 256 + c] = outOwn[axis === 'col' ? t[r * 256 + inSrc[c]] : t[inSrc[r] * 256 + c]];
    out[ext] = n;
  }
  return out;
}

// srcDir: source level (palette entries for the cars, tables); colours: the level's palette (compileLevel().palette,
// at most 156). Returns {COL, TEX, SHD?, TAB?, PAN?}.
export async function buildTextures(srcDir, colours, atlas = []) {
  const src = await readSource(srcDir);
  const pal = src.pal.map(c => c.slice());
  for (let i = OWN_FROM; i < FIXED_FROM; i++) pal[i] = colours[i - OWN_FROM] ? colours[i - OWN_FROM].slice() : [0, 0, 0];
  const next = OWN_FROM + colours.length;
  const usable = [...Array(255).keys()].map(i => i + 1).filter(i => i < OWN_FROM || i < next || i >= FIXED_FROM);
  const TEX = new Uint8Array(16 * 65536);
  for (let slot = 0; slot < 256; slot++) {
    const c = slot < colours.length ? OWN_FROM + slot : OWN_FROM;
    const cx = (slot % 16) * CELL, cy = Math.floor(slot / 16) * CELL;
    for (let y = 0; y < CELL; y++) TEX.fill(c, (cy + y) * 256 + cx, (cy + y) * 256 + cx + CELL);
  }
  for (let t = 1; t < 16; t++) TEX.copyWithin(t * 65536, 0, 65536);
  // the objects' texture tiles (the compiler's atlas, core/compile.js): 64 x 64 blocks of level palette indices in
  // textures 1..15 (LEVELFORMAT.md ch. 4: 4 x 4 tiles per texture)
  for (const { tex, tile, indices } of atlas) {
    const x0 = (tile % 4) * 64, y0 = Math.floor(tile / 4) * 64;
    for (let y = 0; y < 64; y++) TEX.set(indices.subarray(y * 64, y * 64 + 64), tex * 65536 + (y0 + y) * 256 + x0);
  }
  const COL = new Uint8Array(776);
  const dv = new DataView(COL.buffer);
  dv.setUint32(0, 776, true);
  dv.setUint32(4, 0xB123, true);
  pal.forEach((c, i) => COL.set(c, 8 + 3 * i));
  const tables = remapTables(src.pal, pal, usable,
    [['SHD', src.shd, 'col'], ['TAB', src.tab, 'row'], ['PAN', src.pan, 'row']].filter(t => t[1]));
  return { COL, TEX, ...tables };
}
