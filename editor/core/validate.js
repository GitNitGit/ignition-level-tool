// Checks of a compiled level against the building rules (LEVELFORMAT.md,
// chapter 20). Returns {errors, warnings, stats}.
import { LANDSCAPE } from './formats.js';

const DRIVABLE = s => s < 30;
const WALL = s => s >= 78 && s < 300 && s !== 110 && s !== 131;
// limits seen in the originals
const LIMITS = { placements: 500, srfRecords: 15126, wallDistance: 890, faceEdge: 700, sceneryEdge: 3200,
                 textures: 17 };

function inTriangle(p, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (!d) return false;
  const l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
  const l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
  return l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0;
}

export function validate(entries, { srfRecords = 0, textures = 0 } = {}) {
  const errors = [], warnings = [];
  const types = entries.map(e => e.type);
  const count = t => types.filter(x => x === t).length;
  if (count(0) !== 1) errors.push(`Exactly one start/finish placement (type 0) needed, found: ${count(0)}`);
  if (count(1) !== 1) errors.push(`Exactly one placement of type 1 (first section) needed, found: ${count(1)}`);
  let triangles = 0, maxWall = 0, maxEdge = 0, maxSceneryEdge = 0;
  const longEdges = [];            // sections with an edge longer than in the originals
  entries.forEach((e, k) => {
    const v = e.mesh.verts;
    triangles += e.faces.length;
    const section = e.type <= 8;
    if (section && !e.gate) errors.push(`Placement ${k} (type ${e.type}) without gate`);
    if (e.gate) {
      const [a, b] = e.gate.map(i => v[i]);
      if (!a || !b) errors.push(`Placement ${k}: gate vertex missing`);
      else if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 50) warnings.push(`Placement ${k}: gate shorter than 50`);
    }
    for (const p of v) {
      if (Math.abs(p[0]) > 25000 || Math.abs(p[2]) > 25000) {
        errors.push(`Placement ${k}: vertex outside ±25000 (${p})`);
        break;
      }
    }
    const faceDw = 2 + 3 * v.length + 11 * e.faces.length;
    if (faceDw > 65535) errors.push(`Placement ${k}: mesh too large for .SRF (face address ${faceDw})`);
    const xz = e.pos;
    if (section) {
      const over = e.mesh.faces.some(f => DRIVABLE(f.surf) &&
        inTriangle([xz[0], xz[2]], ...[f.a, f.b, f.c].map(i => [v[i][0], v[i][2]])));
      if (!over) warnings.push(`Placement ${k}: placement point is not above its own road (walls may not work then)`);
    }
    // edges between drivable and wall faces: distance from the placement point
    const edges = new Map();
    for (const f of e.mesh.faces) {
      const ix = [f.a, f.b, f.c];
      for (let j = 0; j < 3; j++) {
        const p = ix[j], q = ix[(j + 1) % 3];
        const key = p < q ? p + ',' + q : q + ',' + p;
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key).push(f.surf);
        const len = Math.hypot(v[p][0] - v[q][0], v[p][1] - v[q][1], v[p][2] - v[q][2]);
        if (section && DRIVABLE(f.surf)) {             // drivable faces: originals at most about 600
          maxEdge = Math.max(maxEdge, len);
          if (len > LIMITS.faceEdge && longEdges[longEdges.length - 1] !== k) longEdges.push(k);
        }
        else maxSceneryEdge = Math.max(maxSceneryEdge, len);
      }
    }
    for (const [key, s] of edges) {
      if (s.some(DRIVABLE) && s.some(WALL)) {
        for (const i of key.split(',').map(Number)) {
          maxWall = Math.max(maxWall, Math.hypot(v[i][0] - xz[0], v[i][2] - xz[2]));
        }
      }
    }
    if (!LANDSCAPE.has(e.type) && e.faces.some(f => DRIVABLE(f.surf)))
      warnings.push(`Placement ${k} (type ${e.type}): drivable faces outside the track sections`);
  });
  if (entries.length > LIMITS.placements) errors.push(`${entries.length} placements: the game's object pool of 1500 leaves room for about ${LIMITS.placements} (a level with 497 ran, 582 stopped with "Maximum of objects reached!"); fewer sections (longer section length) or less scenery`);
  if (srfRecords > LIMITS.srfRecords) warnings.push(`${srfRecords} .SRF records (originals at most ${LIMITS.srfRecords})`);
  if (maxWall > LIMITS.wallDistance) warnings.push(`Wall edge ${Math.round(maxWall)} away from the placement point (originals at most ${LIMITS.wallDistance})`);
  if (maxEdge > LIMITS.faceEdge) warnings.push({ text: `Edges too long in ${longEdges.length} track section(s), longest ${Math.round(maxEdge)} (originals at most about ${LIMITS.faceEdge})`, at: longEdges[0] });
  if (maxSceneryEdge > LIMITS.sceneryEdge) warnings.push(`Longest terrain edge ${Math.round(maxSceneryEdge)} (originals at most 3134; long faces may be drawn wrongly)`);
  if (textures > LIMITS.textures) warnings.push(`${textures} textures (originals at most ${LIMITS.textures})`);
  return {
    errors, warnings, marks: { longEdges },
    stats: { placements: entries.length, sections: entries.filter(e => e.type <= 8).length,
             triangles, srfRecords, maxWallDistance: Math.round(maxWall), maxEdge: Math.round(maxEdge),
             maxSceneryEdge: Math.round(maxSceneryEdge) },
  };
}
