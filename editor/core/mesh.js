// Mesh under construction, in world coordinates (y up), written as the game's
// mesh records (LEVELFORMAT.md, chapters 6 and 18).
import { pyRound } from './util.js';

export class Mesh {
  constructor() {
    this.verts = [];        // [x, y, z] integers, world, y up
    this.index = new Map(); // "x,y,z" -> vertex index
    // {a, b, c, uvs: [[u, v] x 3], tile, surf, fuv: [[fu, fv] x 3], role}
    // tile: [tex, tile] or a reference "Level/tex/tile" / "#role" (tiles.js);
    // fuv: corner position inside the tile (0..1), to recompute uvs for an atlas
    this.faces = [];
    this.anchor = null;     // placement point [x, y, z]; null = centroid of the vertices
  }

  vert(x, y, z) {
    const p = [pyRound(x), pyRound(y), pyRound(z)];
    const key = p.join(',');
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.verts.length;
      this.verts.push(p);
      this.index.set(key, i);
    }
    return i;
  }

  // Add a triangle wound so that its front faces up (up = false: down) or
  // towards the world direction `facing` [x, y, z] (upright walls).
  // Front = clockwise seen from the front in the frame (x, y, -z), as the
  // game's culling expects.
  tri(a, b, c, uvs, tile, surf, up = true, facing = null, fuv = null, role = null) {
    const pa = this.verts[a], pb = this.verts[b], pc = this.verts[c];
    const u = [pb[0] - pa[0], pb[1] - pa[1], -(pb[2] - pa[2])];
    const v = [pc[0] - pa[0], pc[1] - pa[1], -(pc[2] - pa[2])];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const f = facing || [0, up ? 1 : -1, 0];
    if (n[0] * f[0] + n[1] * f[1] - n[2] * f[2] > 0) {   // counter-clockwise from the wanted side
      [b, c] = [c, b];
      uvs = [uvs[0], uvs[2], uvs[1]];
      if (fuv) fuv = [fuv[0], fuv[2], fuv[1]];
    }
    this.faces.push({ a, b, c, uvs, tile, surf, fuv, role });
  }
}

// Tile number inside its texture for a tile given as [tex, tile], "Level/tex/tile" or "#role".
export function tileIndex(tile) {
  if (Array.isArray(tile)) return tile[1];
  if (tile[0] === '#') return 0;
  return Number(tile.split('/')[2]);
}

// Texel coordinates inside a 64x64 tile, fu/fv in 0..1 (inset like the originals).
export function tileUV(tile, fu, fv) {
  const n = tileIndex(tile);
  return [(n % 4) * 64 + 1.9 + fu * 60.1, Math.floor(n / 4) * 64 + 1.9 + fv * 60.1];
}

// Quad p0..p3 (world points) as two triangles showing the whole tile.
export function quad(mesh, q, tile, surf, facing = null, role = null) {
  const idx = q.map(p => mesh.vert(p[0], p[1], p[2]));
  const f = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const uv = f.map(([fu, fv]) => tileUV(tile, fu, fv));
  mesh.tri(idx[0], idx[1], idx[2], [uv[0], uv[1], uv[2]], tile, surf, true, facing, [f[0], f[1], f[2]], role);
  mesh.tri(idx[0], idx[2], idx[3], [uv[0], uv[2], uv[3]], tile, surf, true, facing, [f[0], f[2], f[3]], role);
}
