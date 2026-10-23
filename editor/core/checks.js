// Checks of the track while editing (docs/EDITOR.md, "Track").
// Errors and warnings are strings or {text, at: [x, y, z]} (click moves there).
import { nodeMap, edgeKey } from './model.js';
import { orderedTrack } from './paths.js';

export function structureChecks(track) {
  const errors = [];
  const nodes = nodeMap(track);
  const pos = id => { const n = nodes.get(id); return n ? [n.x, n.y ?? 0, n.z] : undefined; };
  if (track.main.length < 3) errors.push('The main loop needs at least 3 control points');
  for (const id of [...track.main, ...track.branches.flatMap(b => [b.from, b.to, ...b.nodes])]) {
    if (!nodes.has(id)) { errors.push(`Unknown control point ${id}`); return errors; }
  }
  if (!track.main.includes(track.start?.node)) {
    errors.push('The start must be a control point of the main loop');
    return errors;
  }
  const { main } = orderedTrack(track);
  const startNode = main[0];
  const ranges = [];
  for (const b of track.branches) {
    if (!track.main.includes(b.from) || !track.main.includes(b.to)) {
      errors.push({ text: `Branch ${b.id}: both ends must lie on the main loop`, at: pos(b.nodes[0]) });
      continue;
    }
    if (b.from === b.to) errors.push({ text: `Branch ${b.id} starts and ends at the same point`, at: pos(b.from) });
    if (!b.nodes.length) errors.push({ text: `Branch ${b.id} has no control point of its own`, at: pos(b.from) });
    let iF = main.indexOf(b.from), iT = main.indexOf(b.to);
    if (track.start.reverse) [iF, iT] = [main.indexOf(b.to), main.indexOf(b.from)];
    if (b.from === startNode || b.to === startNode) {
      errors.push({ text: `Branch ${b.id} must not start or end at the start point`, at: pos(startNode) });
    } else if (iF > iT) {
      errors.push({ text: `Branch ${b.id} runs across the start/finish line; move the start or the branch`, at: pos(startNode) });
    }
    ranges.push([Math.min(iF, iT), Math.max(iF, iT), b]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < ranges.length; k++) {
    if (ranges[k][0] <= ranges[k - 1][1]) {
      errors.push({ text: `Branches ${ranges[k - 1][2].id} and ${ranges[k][2].id} overlap on the main loop (not supported)`,
                    at: pos(ranges[k][2].from) });
    }
  }
  // jumps: must exist and must not touch the start
  const edges = new Set();
  const addPath = (ids, closed) => ids.forEach((id, i) => {
    if (i + 1 < ids.length || closed) edges.add(edgeKey(id, ids[(i + 1) % ids.length]));
  });
  addPath(track.main, true);
  for (const b of track.branches) addPath([b.from, ...b.nodes, b.to], false);
  for (const j of track.jumps || []) {
    const [a, b] = j.split('|');
    if (!edges.has(j)) errors.push(`Jump ${j}: no such segment`);
    else if (a === startNode || b === startNode) errors.push({ text: 'A jump must not touch the start point', at: pos(startNode) });
  }
  return errors;
}

// Parts of the track that cross: they need a height clearance of at least
// track.clearance (default 250). Jump segments are exempt, so are the parts
// next to a fork or merge (the branch leaves the main loop there).
export function crossingChecks(paths, track) {
  const clearance = track.clearance ?? 250;
  const list = [];
  const junctions = paths.branches.flatMap(b => [b.frames[0].c, b.frames[b.frames.length - 1].c]);
  for (const p of paths.all) {
    const fr = p.frames, n = p.closed ? fr.length : fr.length - 1;
    let arc = 0;
    for (let j = 0; j < n; j++) {
      const a = fr[j], b = fr[(j + 1) % fr.length];
      const len = Math.hypot(b.c[0] - a.c[0], b.c[2] - a.c[2]);
      if (!p.jump[a.seg]) {
        list.push({ path: p.key, closed: p.closed, arc: arc + len / 2,
                    c: [0, 1, 2].map(k => (a.c[k] + b.c[k]) / 2), half: Math.max(a.half, b.half) });
      }
      arc += len;
    }
    for (const s of list) if (s.path === p.key) s.total = arc;
  }
  const near = (c, r) => junctions.some(q => Math.hypot(q[0] - c[0], q[2] - c[2]) < r);
  const errors = [], seen = new Set(), crossings = new Set();
  for (let i = 0; i < list.length; i++) {
    for (let k = i + 1; k < list.length; k++) {
      const a = list[i], b = list[k];
      const reach = a.half + b.half;
      const d = Math.hypot(a.c[0] - b.c[0], a.c[2] - b.c[2]);
      if (d >= reach) continue;
      if (a.path === b.path) {
        let along = Math.abs(a.arc - b.arc);
        if (a.closed) along = Math.min(along, a.total - along);
        if (along < 3 * reach) continue;                   // neighbours along the track
      }
      if (a.path !== b.path && near(a.c, reach + 600) && near(b.c, reach + 600)) continue;
      const dy = Math.abs(a.c[1] - b.c[1]);
      const cell = [a, b].map(s => Math.round(s.c[0] / 1500) + ',' + Math.round(s.c[2] / 1500)).sort().join('/');
      if (dy < clearance) {
        if (seen.has(cell)) continue;
        seen.add(cell);
        errors.push({ text: `Track crosses itself with only ${Math.round(dy)} height clearance (at least ${clearance})`,
                      at: [(a.c[0] + b.c[0]) / 2, Math.max(a.c[1], b.c[1]), (a.c[2] + b.c[2]) / 2] });
      } else {
        crossings.add(cell);
      }
    }
  }
  return { errors, warnings: [], count: crossings.size };
}
