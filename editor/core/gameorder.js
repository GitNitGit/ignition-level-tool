// The game builds its own track order when a level loads: it does not use
// the placement numbers but walks the placements geometrically. This is the same walk, run on the compiled entries, so
// that the compiler can tell where the game would leave the intended order (then the AI, "Wrong way" and the lap
// counting go astray, and the AI crashes at the first fork).
//
// The walk (LEVELFORMAT.md ch. 15):
//   - the point of every landscape placement is moved to the mean of the corners of its drivable faces (surface code
//     below 40, not 5/6/7 modulo 10; all faces when it has none);
//   - entry 0 is the type 0 placement; from the type 1 placement the chain continues to the nearest not yet visited
//     placement of type 2, 3, 7 or 9 - distance sqrt(dx^2 + (2 dy)^2 + dz^2);
//   - a type 3 (fork) is followed by the chain of nearest type 4 placements until a type 6 is nearest, then from the
//     fork again by the chain of nearest type 5 placements until a type 6; the main chain goes on from that type 6;
//   - a type 7 is followed by the nearest unvisited type 7;
//   - as many steps as there are track placements (types 0-7, not 8, not 50) minus 3.
export function gamePoint(e) {
  const V = e.mesh.verts, pick = e.faces.filter(f => f.surf < 40 && ![5, 6, 7].includes(f.surf % 10));
  const list = pick.length ? pick : e.faces;
  const sum = [0, 0, 0]; let n = 0;
  for (const f of list) for (const i of f.idx) { const p = V[i]; sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++; }
  return n ? sum.map(v => v / n) : e.pos.slice();
}

const dist = (a, b) => Math.hypot(a[0] - b[0], 2 * (a[1] - b[1]), a[2] - b[2]);

// entries: the compiled placements (type, pos, mesh, faces). Returns {order: [placement indices as the game chains
// them], trouble: [{at, from, to, expected}] where the walk leaves the file order}.
export function gameTrackOrder(entries) {
  const land = entries.map((e, k) => ({ k, type: e.type, p: gamePoint(e) })).filter(x => x.type <= 7);
  const byType = t => land.filter(x => x.type === t);
  const start0 = byType(0)[0], start1 = byType(1)[0];
  if (!start0 || !start1) return { order: [], trouble: [{ text: 'no type 0 / type 1 placement' }] };
  const visited = new Set([start0.k]);
  const order = [start0.k];
  const nearest = (from, types) => {
    let best = null, bd = Infinity;
    for (const x of land) {
      if (x.k === from.k || visited.has(x.k) || !types.includes(x.type)) continue;
      const d = dist(from.p, x.p);
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  };
  const visit = x => { visited.add(x.k); order.push(x.k); };
  let cur = start1;
  visit(cur);
  for (;;) {
    const next = nearest(cur, [2, 3, 7, 9]);
    if (!next) break;
    visit(next);
    if (next.type === 3) {
      for (const types of [[4, 6], [5, 6]]) {
        let p = next;
        for (;;) {
          const q = nearest(p, types);
          if (!q || q.type === 6) { if (q && types[0] === 5) { visit(q); cur = q; } break; }
          visit(q); p = q;
        }
      }
      if (cur.type !== 6) cur = next;
      continue;
    }
    if (next.type === 7) { const q = nearest(next, [7]); if (q) visit(q); cur = q || next; continue; }
    cur = next;
  }
  // the order the compiler intended, as the game walks it: the type 0 placement first, then type 1 onwards in file
  // order; in a fork/merge block the type 4 placements come before the type 5 placements whatever their numbers
  const file = entries.map((e, k) => (e.type <= 7 ? k : -1)).filter(k => k >= 0);
  const expected = [file[file.length - 1]];
  for (let i = 0; i < file.length - 1; i++) {
    const k = file[i];
    expected.push(k);
    if (entries[k].type !== 3) continue;
    const four = [], five = [];
    for (i++; i < file.length - 1 && entries[file[i]].type !== 6; i++) (entries[file[i]].type === 4 ? four : five).push(file[i]);
    expected.push(...four, ...five);
    if (i < file.length - 1) expected.push(file[i]);
  }
  const trouble = [];
  for (let i = 1; i < Math.min(order.length, expected.length); i++) {
    if (order[i] !== expected[i]) { trouble.push({ at: i, from: order[i - 1], to: order[i], expected: expected[i] }); break; }
  }
  if (order.length < expected.length && !trouble.length) trouble.push({ at: order.length, from: order[order.length - 1], to: null, expected: expected[order.length] });
  const unvisited = land.filter(x => !visited.has(x.k)).map(x => x.k);
  return { order, trouble, unvisited };
}
