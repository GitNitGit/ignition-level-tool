// Level data model of the editor (docs/EDITOR.md, "Data model"). Plain JSON objects
// so that they can be saved, undone and compiled in browser and Node alike.
//
// level = { format: 3, name, slot, source,
//   track: { section, clearance, nodes: [{id, x, z, y, width, vl, vr}], main, branches, jumps, start,
//            kerb: {lid, foot, height},          kerb profile (all kerbs)
//            kerbs / slippery / order / ramp / noVerge: ranges per segment (sections.js)
//            cuts: {"a|b": k}                    frozen number of sections per segment (set with the terrain) },
//   terrain?: { points, tris }                    stored landscape (terrain.js) }

export const FORMAT = 3;
// road width 300 and a drivable verge of 160 on each side (2026-10-08, user: the old 360 / 320 were unusually wide;
// Brazil's lanes are 300 and the walls of the originals lie mostly within 150-250 of the placement point)
export const DEFAULT_WIDTH = 300;
export const DEFAULT_VERGE = 160;
export const KERB_DEFAULT = { lid: 80, foot: 140, height: 30 };
// spline knots: auto (Catmull-Rom), linked / separated (handles ti = incoming, to = outgoing, offsets in the stored
// loop order), corner (straight in, straight out: a sharp bend)
export const TANGENT_MODES = ['auto', 'linked', 'separated', 'corner'];

// New level: a circle of 8 control points (radius 5000), start at the first,
// driving counter-clockwise seen from above.
export function newLevel(name) {
  const nodes = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    nodes.push({ id: 'n' + i, x: Math.round(5000 * Math.cos(a)), z: Math.round(5000 * Math.sin(a)),
                 y: 0, width: DEFAULT_WIDTH, vl: DEFAULT_VERGE, vr: DEFAULT_VERGE });
  }
  return {
    format: FORMAT, name, slot: 'Canada', source: 'Canada',
    track: {
      section: 250, clearance: 250,
      nodes, main: nodes.map(n => n.id), branches: [], jumps: [],
      start: { node: 'n0', reverse: false },
      kerb: { ...KERB_DEFAULT }, kerbs: {}, slippery: {}, order: {}, ramp: {}, noVerge: {},
    },
  };
}

export const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

export function nodeMap(track) {
  return new Map(track.nodes.map(n => [n.id, n]));
}

// Smallest unused id with the given prefix ('n' nodes, 'b' branches).
export function nextId(list, prefix) {
  const used = new Set(list.map(x => x.id ?? x));
  let k = 0;
  while (used.has(prefix + k)) k++;
  return prefix + k;
}

// Where a node is used: {main: index | -1, branch: branch object | null,
// endpointOf: [branches starting or ending at this node]}
export function nodeRole(track, id) {
  return {
    main: track.main.indexOf(id),
    branch: track.branches.find(b => b.nodes.includes(id)) || null,
    endpointOf: track.branches.filter(b => b.from === id || b.to === id),
  };
}
