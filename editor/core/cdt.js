// Constrained Delaunay triangulation in 2D (x, z): incremental insertion with
// Lawson flips, constraint edges by flipping (Sloan 1993). Topology-safe: a
// flip only happens on a strictly convex quad (exact for integer input), so
// rounding in the circle test can only cost triangle quality, never validity.
//
// triangulate(points [[x, z]], constraints [[i, j]]) ->
//   { tris: [[a, b, c]] counter-clockwise in (x, z), failed: [[i, j]] }
// Duplicate points are merged (the first one wins: `alias[i]` = index used).

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// > 0: d inside the circumcircle of the counter-clockwise triangle a, b, c
function inCircle(a, b, c, d) {
  const adx = a[0] - d[0], ady = a[1] - d[1], bdx = b[0] - d[0], bdy = b[1] - d[1], cdx = c[0] - d[0], cdy = c[1] - d[1];
  const ad = adx * adx + ady * ady, bd = bdx * bdx + bdy * bdy, cd = cdx * cdx + cdy * cdy;
  const det = adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
  const scale = (Math.abs(adx) + Math.abs(ady) + Math.abs(bdx) + Math.abs(bdy) + Math.abs(cdx) + Math.abs(cdy)) ** 4;
  return det > scale * 1e-12 ? 1 : 0;
}

export function triangulate(input, constraints = []) {
  // merge duplicates
  const pts = [], alias = new Array(input.length), seen = new Map();
  input.forEach((p, i) => {
    const key = p[0] + ',' + p[1];
    if (seen.has(key)) { alias[i] = seen.get(key); return; }
    seen.set(key, i); alias[i] = i;
  });
  for (const p of input) pts.push([p[0], p[1]]);
  // super triangle
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
  const cx = Math.round((minX + maxX) / 2), cz = Math.round((minZ + maxZ) / 2);
  const R = Math.max(maxX - minX, maxZ - minZ, 1000) * 20;
  const S = pts.length;
  pts.push([cx - 2 * R, cz - R], [cx + 2 * R, cz - R], [cx, cz + 2 * R]);

  // triangles: V vertices (ccw), N neighbour across edge k (V[k] -> V[k+1]), C constraint flag of edge k
  const V = [], N = [], C = [];
  const vt = new Int32Array(pts.length).fill(-1);       // one triangle per vertex
  const set = (t, a, b, c, na, nb, nc, ca = 0, cb = 0, cc = 0) => {
    V[3 * t] = a; V[3 * t + 1] = b; V[3 * t + 2] = c;
    N[3 * t] = na; N[3 * t + 1] = nb; N[3 * t + 2] = nc;
    C[3 * t] = ca; C[3 * t + 1] = cb; C[3 * t + 2] = cc;
    vt[a] = t; vt[b] = t; vt[c] = t;
  };
  let nt = 0;
  const newTri = () => nt++;
  set(newTri(), S, S + 1, S + 2, -1, -1, -1);
  // in triangle u, replace the neighbour pointer `from` with `to`
  const relink = (u, from, to) => { if (u < 0) return; for (let k = 0; k < 3; k++) if (N[3 * u + k] === from) { N[3 * u + k] = to; return; } };
  const edgeIndex = (t, a, b) => { for (let k = 0; k < 3; k++) if (V[3 * t + k] === a && V[3 * t + (k + 1) % 3] === b) return k; return -1; };

  // flip edge k of t (with its neighbour); returns the two new triangles' ids
  function flip(t, k) {
    const u = N[3 * t + k];
    const a = V[3 * t + k], b = V[3 * t + (k + 1) % 3], c = V[3 * t + (k + 2) % 3];
    const m = edgeIndex(u, b, a);
    const d = V[3 * u + (m + 2) % 3];
    const nBC = N[3 * t + (k + 1) % 3], nCA = N[3 * t + (k + 2) % 3], cBC = C[3 * t + (k + 1) % 3], cCA = C[3 * t + (k + 2) % 3];
    const nAD = N[3 * u + (m + 1) % 3], nDB = N[3 * u + (m + 2) % 3], cAD = C[3 * u + (m + 1) % 3], cDB = C[3 * u + (m + 2) % 3];
    set(t, a, d, c, nAD, u, nCA, cAD, 0, cCA);
    set(u, d, b, c, nDB, nBC, t, cDB, cBC, 0);
    relink(nAD, u, t); relink(nBC, t, u);
    return [t, u];
  }
  const convex = (t, k) => {
    const u = N[3 * t + k];
    if (u < 0) return false;
    const a = V[3 * t + k], b = V[3 * t + (k + 1) % 3], c = V[3 * t + (k + 2) % 3];
    const d = V[3 * u + (edgeIndex(u, b, a) + 2) % 3];
    return orient(pts[a], pts[d], pts[c]) > 0 && orient(pts[d], pts[b], pts[c]) > 0;
  };
  // Lawson: make the edges on the stack locally Delaunay
  function legalize(stack) {
    let guard = 0;
    while (stack.length && guard++ < 1e6) {
      const [t, a, b] = stack.pop();
      const k = edgeIndex(t, a, b);
      if (k < 0 || C[3 * t + k]) continue;
      const u = N[3 * t + k];
      if (u < 0) continue;
      const c = V[3 * t + (k + 2) % 3], m = edgeIndex(u, b, a), d = V[3 * u + (m + 2) % 3];
      if (!inCircle(pts[a], pts[b], pts[c], pts[d]) || !convex(t, k)) continue;
      const [t1, t2] = flip(t, k);        // t1 = (a, d, c), t2 = (d, b, c)
      stack.push([t1, a, d], [t2, d, b]);
    }
  }

  // locate: walk towards p; returns [t, edge k if p lies on it, else -1]
  let last = 0;
  function locate(p) {
    let t = last;
    for (let steps = 0; steps < 4 * nt + 100; steps++) {
      let moved = false, on = -1;
      const off = steps % 3;
      for (let j = 0; j < 3; j++) {
        const k = (j + off) % 3;
        const o = orient(pts[V[3 * t + k]], pts[V[3 * t + (k + 1) % 3]], p);
        if (o < 0) { t = N[3 * t + k]; moved = true; break; }
        if (o === 0) on = k;
      }
      if (!moved) { last = t; return [t, on]; }
      if (t < 0) break;
    }
    for (let t2 = 0; t2 < nt; t2++) {                    // fallback: brute force
      const o = [0, 1, 2].map(k => orient(pts[V[3 * t2 + k]], pts[V[3 * t2 + (k + 1) % 3]], p));
      if (o.every(x => x >= 0)) return [t2, o.indexOf(0)];
    }
    throw new Error('cdt: point not found');
  }

  function insert(i) {
    const p = pts[i];
    const [t, on] = locate(p);
    const stack = [];
    if (on < 0) {                                        // inside: split into 3
      const a = V[3 * t], b = V[3 * t + 1], c = V[3 * t + 2];
      const nA = N[3 * t], nB = N[3 * t + 1], nC = N[3 * t + 2], cA = C[3 * t], cB = C[3 * t + 1], cC = C[3 * t + 2];
      const t1 = newTri(), t2 = newTri();
      set(t, a, b, i, nA, t1, t2, cA, 0, 0);
      set(t1, b, c, i, nB, t2, t, cB, 0, 0);
      set(t2, c, a, i, nC, t, t1, cC, 0, 0);
      relink(nB, t, t1); relink(nC, t, t2);
      stack.push([t, a, b], [t1, b, c], [t2, c, a]);
    } else {                                             // on edge k: split both triangles into 2
      const k = on, u = N[3 * t + k];
      const a = V[3 * t + k], b = V[3 * t + (k + 1) % 3], c = V[3 * t + (k + 2) % 3];
      const cons = C[3 * t + k];
      const nBC = N[3 * t + (k + 1) % 3], nCA = N[3 * t + (k + 2) % 3], cBC = C[3 * t + (k + 1) % 3], cCA = C[3 * t + (k + 2) % 3];
      const t1 = newTri();
      if (u >= 0) {
        const m = edgeIndex(u, b, a), d = V[3 * u + (m + 2) % 3];
        const nAD = N[3 * u + (m + 1) % 3], nDB = N[3 * u + (m + 2) % 3], cAD = C[3 * u + (m + 1) % 3], cDB = C[3 * u + (m + 2) % 3];
        const u1 = newTri();
        set(t, a, i, c, u1, t1, nCA, cons, 0, cCA);      // a-i (shared with u1 = (i, a, d)), i-c, c-a
        set(t1, i, b, c, u, nBC, t, cons, cBC, 0);       // i-b (shared with u = (b, i, d)), b-c, c-i
        set(u, b, i, d, t1, u1, nDB, cons, 0, cDB);
        set(u1, i, a, d, t, nAD, u, cons, cAD, 0);
        relink(nBC, t, t1); relink(nAD, u, u1);
        stack.push([t, c, a], [t1, b, c], [u, d, b], [u1, a, d]);
      } else {
        set(t, a, i, c, -1, t1, nCA, cons, 0, cCA);
        set(t1, i, b, c, -1, nBC, t, cons, cBC, 0);
        relink(nBC, t, t1);
        stack.push([t, c, a], [t1, b, c]);
      }
    }
    legalize(stack);
  }

  // insertion order: along a coarse grid, rows alternating (short walks)
  const order = [...Array(S).keys()].filter(i => alias[i] === i);
  const cell = Math.max(maxX - minX, maxZ - minZ, 1) / 64;
  order.sort((p, q) => {
    const rp = Math.floor((pts[p][1] - minZ) / cell), rq = Math.floor((pts[q][1] - minZ) / cell);
    if (rp !== rq) return rp - rq;
    return (rp % 2 ? -1 : 1) * (pts[p][0] - pts[q][0]);
  });
  for (const i of order) insert(i);

  // ---------------------------------------------------------------- constraints
  // triangle around vertex a whose edge opposite a is crossed by the ray a->b,
  // or 'edge' if a-b already exists, or a vertex lying exactly on the segment
  function around(a, fn) {
    const t0 = vt[a];
    let t = t0, guard = 0;
    do {
      const k = [0, 1, 2].find(j => V[3 * t + j] === a);
      const r = fn(t, k);
      if (r !== undefined) return r;
      t = N[3 * t + (k + 2) % 3];                       // across the edge (prev -> a): next triangle ccw... around a
      if (t < 0 || guard++ > 1000) return undefined;
    } while (t !== t0);
    return undefined;
  }
  const findEdge = (a, b) => around(a, (t, k) => (V[3 * t + (k + 1) % 3] === b ? [t, k] : undefined));
  const cross = (p, q, r, s) => orient(p, q, r) * orient(p, q, s) < 0 && orient(r, s, p) * orient(r, s, q) < 0;

  const failed = [];
  function insertConstraint(a, b, depth = 0) {
    if (a === b || depth > 50) return;
    const e = findEdge(a, b);
    if (e) { mark(e[0], e[1]); return; }
    const pa = pts[a], pb = pts[b];
    // first triangle: around a, the edge opposite a straddles the segment
    const start = around(a, (t, k) => {
      const v1 = V[3 * t + (k + 1) % 3], v2 = V[3 * t + (k + 2) % 3];
      const o1 = orient(pa, pb, pts[v1]), o2 = orient(pa, pb, pts[v2]);
      const ahead1 = (pts[v1][0] - pa[0]) * (pb[0] - pa[0]) + (pts[v1][1] - pa[1]) * (pb[1] - pa[1]) > 0;
      const ahead2 = (pts[v2][0] - pa[0]) * (pb[0] - pa[0]) + (pts[v2][1] - pa[1]) * (pb[1] - pa[1]) > 0;
      if (o1 === 0 && ahead1) return { via: v1 };
      if (o2 === 0 && ahead2) return { via: v2 };
      if (o1 < 0 && o2 > 0) return { t, k };
      return undefined;
    });
    if (!start) { failed.push([a, b]); return; }
    if (start.via !== undefined) { insertConstraint(a, start.via, depth + 1); insertConstraint(start.via, b, depth + 1); return; }
    // walk along the segment, collecting crossed edges [u, w]
    const crossed = [];
    let t = start.t, u = V[3 * t + (start.k + 1) % 3], w = V[3 * t + (start.k + 2) % 3];
    for (let guard = 0; guard < 100000; guard++) {
      const k = edgeIndex(t, u, w);
      if (C[3 * t + k]) { failed.push([a, b]); return; }  // would cross another constraint
      crossed.push([u, w]);
      const n = N[3 * t + k];
      const m = edgeIndex(n, w, u), d = V[3 * n + (m + 2) % 3];
      if (d === b) break;
      const o = orient(pa, pb, pts[d]);
      if (o === 0) {                                     // vertex on the segment: split there
        resolve(crossed, a, d);
        insertConstraint(d, b, depth + 1);
        return;
      }
      t = n;                                             // next crossed edge (u right, w left of a->b)
      if (o < 0) u = d; else w = d;
    }
    resolve(crossed, a, b);
  }
  // flip the crossed edges away until a-b exists (Sloan), then restore Delaunay
  function resolve(crossed, a, b) {
    const pa = pts[a], pb = pts[b];
    const queue = crossed.slice(), fresh = [];
    let guard = 0;
    while (queue.length && guard++ < 100000) {
      const [u, w] = queue.shift();
      const e = findEdge(u, w) || findEdge(w, u);
      if (!e) continue;
      const [t, k] = e;
      if (!convex(t, k)) { queue.push([u, w]); continue; }
      const x = V[3 * t + (k + 2) % 3];
      const [t1] = flip(t, k);
      const d = V[3 * t1 + 1];                             // new edge x-d ... (t1 = a', d, c')
      const p = x, q = d;
      if ((p === a && q === b) || (p === b && q === a)) continue;
      if (cross(pa, pb, pts[p], pts[q])) queue.push([p, q]);
      else fresh.push([p, q]);
    }
    const e = findEdge(a, b);
    if (!e) { failed.push([a, b]); return; }
    mark(e[0], e[1]);
    legalize(fresh.flatMap(([p, q]) => { const f = findEdge(p, q); return f ? [[f[0], p, q]] : []; }));
  }
  function mark(t, k) {
    C[3 * t + k] = 1;
    const u = N[3 * t + k];
    if (u >= 0) C[3 * u + edgeIndex(u, V[3 * t + (k + 1) % 3], V[3 * t + k])] = 1;
  }
  for (const [i, j] of constraints) insertConstraint(alias[i], alias[j]);

  const tris = [];
  for (let t = 0; t < nt; t++) {
    const a = V[3 * t], b = V[3 * t + 1], c = V[3 * t + 2];
    if (a >= S || b >= S || c >= S) continue;
    tris.push([a, b, c]);
  }
  return { tris, failed, alias };
}
