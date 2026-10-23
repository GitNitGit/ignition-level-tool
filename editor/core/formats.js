// Writers for the generated level files (LEVELFORMAT.md, chapters 6-10).
import { pyRound, Writer } from './util.js';

export const FACE_FLAGS = 0x11;                      // opaque, one-sided
export const LANDSCAPE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 50]);

// Turn built meshes into placement entries: local vertices (y down) relative
// to the placement point, faces in file layout.
// items: [{mesh, gate: [iA, iB] | null, type}]
export function toEntries(items) {
  return items.map(({ mesh, gate, type, flags1 = 0, flags2 = 0, flags3 = 0, path = null }) => {
    const v = mesh.verts;
    const pos = mesh.anchor ? mesh.anchor.slice() : [0, 1, 2].map(k =>
      pyRound(v.reduce((s, p) => s + p[k], 0) / v.length));
    const [cx, cy, cz] = pos;
    return {
      mesh, gate, type, pos, path,
      local: v.map(([x, y, z]) => [x - cx, cy - y, z - cz]),
      faces: mesh.faces.map(f => ({
        flags: f.flags ?? FACE_FLAGS, surf: f.surf, idx: [f.a, f.b, f.c],
        uv: f.uvs.flat().map(t => pyRound(t * 256)), texOffset: f.tile[0] * 65536,
      })),
      flags: [type, flags1, flags2, flags3],
    };
  });
}

export function writeMSH(entries) {
  const w = new Writer(1 << 16);
  for (const e of entries) {
    e.off = w.pos / 4;
    w.i32(e.local.length);
    w.i32(e.faces.length);
    for (const [x, y, z] of e.local) { w.i32(x); w.i32(y); w.i32(z); }
    for (const f of e.faces) {
      w.u16(f.flags); w.u16(f.surf);
      for (const i of f.idx) w.i32(i);
      for (const t of f.uv) w.i32(t);
      w.i32(f.texOffset);
    }
  }
  return w.result();
}

export function writePLC(entries) {      // after writeMSH (needs e.off)
  const w = new Writer();
  w.i32(entries.length);
  for (const e of entries) {
    w.i32(e.off);
    for (const b of e.flags) w.u8(b);
    for (const c of e.pos) w.i32(c);
  }
  return w.result();
}

// .POS: the table (-1 = not animated; the value of an animated one is not read by the game, 0 is written) and, in
// table order, the frame blocks of the animated placements: n, n frames of [r0, x, y, z, r1, r2], a 0 (ch. 8)
// .POS: int32 table[entries], -1 for a static placement, else the offset in int32 units from the table entry to the
// placement's frame block (the game adds the entry's index to the value; all originals have
// block index - entry index there; a 0 made the game read the table as a block and crash, tested in the game);
// then the blocks in placement order: int32 frames, int32 0 (the frame counter the game keeps there), frames x 6 int32
// (x, y, z, rx, ry, rz as the game reads them; the editor's frame [r0, x, y, z, r1, r2] gives the same byte stream
// with its trailing 0), LEVELFORMAT.md chapter 8.
export function writePOS(entries) {
  const w = new Writer();
  let block = entries.length;
  entries.forEach((e, i) => {
    if (!e.path || !e.path.length) return w.i32(-1);
    w.i32(block - i);
    block += 2 + 6 * e.path.length;
  });
  for (const e of entries) {
    if (!e.path || !e.path.length) continue;
    w.i32(e.path.length);
    for (const f of e.path) for (const v of f) w.i32(v);
    w.i32(0);
  }
  return w.result();
}

// .TRI: one 500-byte record per placement; track sections get byte 0 = surface
// code of face 0 (the road), the two gate points and D0-D5 = pi/2, D6 = gate
// direction, D7 = its opposite (LEVELFORMAT.md, chapter 9). Header = number of the last record with a gate + 1 (the
// number of gates while the track sections come first without gaps; in the originals the header is never below it:
// Brazil, whose track sections end at 230 after a gap, has 231).
export function writeTRI(entries) {
  const w = new Writer();
  w.i32(entries.reduce((n, e, k) => (e.gate ? k + 1 : n), 0));
  for (const e of entries) {
    const rec = new Uint8Array(500);
    if (e.gate) {
      const dv = new DataView(rec.buffer);
      rec[0] = (e.mesh.faces.find(f => f.surf < 30) || e.mesh.faces[0]).surf;   // the roadway's code (kerbs, with the wall code, come first in the mesh)
      const pts = [];
      [[1, e.gate[0]], [23, e.gate[1]]].forEach(([o, vi]) => {
        const [x, y, z] = e.mesh.verts[vi];
        dv.setUint16(o, vi, true);
        dv.setInt32(o + 2, x + 25600, true);
        dv.setInt32(o + 6, -3 * y, true);
        dv.setInt32(o + 10, z + 25600, true);
        pts.push([x, z]);
      });
      const yaw = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]);
      const back = yaw <= 0 ? yaw + Math.PI : yaw - Math.PI;
      const half = Math.PI / 2;
      [half, half, half, half, half, half, yaw, back].forEach((d, k) => dv.setFloat64(45 + 8 * k, d, true));
    }
    w.bytes(rec);
  }
  return w.result();
}

// .SRF: collision index of the landscape placements (LEVELFORMAT.md, chapter 10).
export function writeSRF(entries) {
  const recs = new Writer(1 << 16);
  let nrec = 0;
  const cellsA = new Map(), cellsB = new Map();
  entries.forEach((e, pl) => {
    if (!LANDSCAPE.has(e.type)) return;
    const nv = e.local.length;
    const [px, , pz] = e.pos;
    e.faces.forEach((f, fi) => {
      const P = f.idx.map(i => [e.local[i][0] + px, e.local[i][2] + pz]);
      const [lo, mid, hi] = P.slice().sort((a, b) => a[1] - b[1]);   // stable, like Python's sorted
      if (lo[1] === hi[1]) return;                                     // no extent in z
      const faceDw = 2 + 3 * nv + 11 * fi;
      for (const [cells, anchor, other] of [[cellsB, lo, hi], [cellsA, hi, lo]]) {
        const h = mid[1] - anchor[1];
        if (h === 0) continue;                                         // the other half covers it
        const sMid = (mid[0] - anchor[0]) / h;
        const sFar = (other[0] - anchor[0]) / (other[1] - anchor[1]);
        const [sLo, sHi] = sMid <= sFar ? [sMid, sFar] : [sFar, sMid];
        const [s1, s2] = h > 0 ? [sLo, sHi] : [sHi, sLo];
        recs.i32(anchor[0] + 25600); recs.i32(anchor[1] + 25600);
        recs.i32(Math.trunc(s1 * 65536)); recs.i32(Math.trunc(s2 * 65536));
        recs.i16(h); recs.u16(faceDw); recs.i32(pl * 42);
        const k = nrec++;
        const z0 = Math.min(anchor[1], anchor[1] + h), z1 = Math.max(anchor[1], anchor[1] + h);
        const xs = [anchor[0], anchor[0] + s1 * h, anchor[0] + s2 * h];
        const c0 = Math.floor(Math.trunc(Math.min(...xs) + 25600) / 512);
        const c1 = Math.floor(Math.trunc(Math.max(...xs) + 25600) / 512);
        for (let row = Math.floor((z0 + 25600) / 512); row <= Math.floor((z1 + 25600) / 512); row++) {
          for (let col = c0; col <= c1; col++) {
            const key = col + ',' + row;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(k * 24);
          }
        }
      }
    });
  });
  const gw = 101, gh = 101;
  const grid = new Writer(gw * gh * 12);
  const listA = [], listB = [];
  const empty = [0xd4, 0xff, 0xbc, 0xfe, 0xa0, 0x60, 0xfe, 0xfd, 0, 0, 0, 0];   // as in the originals
  for (let row = 0; row < gh; row++) {
    for (let col = 0; col < gw; col++) {
      const la = cellsA.get(col + ',' + row) || [], lb = cellsB.get(col + ',' + row) || [];
      if (la.length || lb.length) {
        grid.u32(listB.length * 4); grid.u32(listA.length * 4); grid.u16(la.length); grid.u16(lb.length);
      } else {
        grid.bytes(empty);
      }
      listA.push(...la);
      listB.push(...lb);
    }
  }
  const w = new Writer(36 + grid.pos + recs.pos + 4 * (listA.length + listB.length));
  for (const v of [200, 200, 512, 512, gw, gh, nrec, listA.length, listB.length]) w.i32(v);
  w.bytes(grid.result());
  w.bytes(recs.result());
  for (const v of listA) w.u32(v);
  for (const v of listB) w.u32(v);
  return { bytes: w.result(), records: nrec };
}
