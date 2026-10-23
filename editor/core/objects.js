// Placed objects (level.objects, Assets tab) with their transforms: position, rotation (degrees about x, y, z of the
// asset's origin, x applied first, then y, then z: R = Rz * Ry * Rx) and scale per axis. The game only translates
// meshes, every placement is its own mesh, so rotation and scale are baked into the vertices (compile.js) - the
// editor draws the same faces (draw.js).
export const DEG = Math.PI / 180;
const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
export const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
export const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
export const rotationOf = (rot = [0, 0, 0]) => mul(rotZ(rot[2] * DEG), mul(rotY(rot[1] * DEG), rotX(rot[0] * DEG)));
// rotation about a unit axis (game coordinates) by `a` radians, as a matrix
export function axisRotation([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
// Euler angles (degrees, x then y then z) of a rotation matrix R = Rz * Ry * Rx
export function eulerOf(R) {
  const sy = -R[2][0], cy = Math.sqrt(Math.max(0, 1 - sy * sy));
  let rx, ry = Math.asin(Math.max(-1, Math.min(1, sy))), rz;
  if (cy > 1e-6) { rx = Math.atan2(R[2][1], R[2][2]); rz = Math.atan2(R[1][0], R[0][0]); }
  else { rx = Math.atan2(-R[1][2], R[1][1]); rz = 0; }
  return [rx, ry, rz].map(a => a / DEG);
}
export const composeRotation = (A, B) => mul(A, B);

export function objectMatrix(o) {
  const [sx, sy, sz] = o.scale || [1, 1, 1], R = rotationOf(o.rot);
  return { m: R.map(r => [r[0] * sx, r[1] * sy, r[2] * sz]), t: [o.x, o.y, o.z] };
}
export const transformPoint = ({ m, t }, p) => [0, 1, 2].map(i => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + t[i]);
// What the game does to a car that touches a placed object: chosen by the placement type (with flags1 = 1, i.e. the
// combined type + 256 x flags1 is 300-349; those objects hit the car, the reaction depends on the type alone, the
// face codes do not matter). The originals: 44 train / hovercraft / truck, 46 USA lorry (the car blows up), 47
// rolling stones (flattened), 48 Austria snowballs, 45 (like a geyser's throw, no original object). Face codes as the originals write them.
export const HIT = { 44: { code: 300, name: 'rams' }, 45: { code: 301, name: 'throws up' }, 46: { code: 302, name: 'blows up' }, 47: { code: 303, name: 'flattens' }, 48: { code: 90, name: 'knocks' } };
// Collision objects: placements of types 150-199 with flags1 low nibble 0 (the combined type is
// type + 256 x (flags1 & 15)) can be kicked: a car within 50 in height whose outline overlaps a fixed square of +-30
// around the placement point kicks the object away (the mesh flies and turns with it). Only 150, 152, 153 and 154
// work (another type in 150-199 stops the level at load with an error message); they differ in two
// parameters, a factor and the mass: 150 / 154 0.3 / 100 (Austria's and Iceland's cones, the pylons), 153 2 / 1500,
// 152 25 / 8000 (USA). The originals' points lie 4-40 above the ground, their footprints are 18-95 across.
export const KICK = { 150: 'kicked away (light)', 153: 'kicked away (heavy)', 152: 'kicked away (very heavy)' };
// Warning light: type 154 (Canada, Carib, Japan pylons) also flashes a Light.tfx sprite 20 above its placement point in
// a chaser over all such objects in .PLC order (phase offset 4 per object, period 30; only
// type 154 has the light). The light is the sprite's own white-yellow, nothing in the level colours it.
// A type 154 is a collision object too: the car kicks it away like a light cone.
export const LIGHT = { 154: 'warning light' };
// What a placed object does to a car: 'solid' (part of the landscape, o.collide), a HIT type, a KICK type, or 0 (drawn
// only). A placed original of a collision type brings its behaviour along unless set otherwise (o.kick = 0: off);
// collision and the warning light exclude each other.
export function collisionOf(o, asset) {
  if (o.collide) return 'solid';
  if (HIT[o.hit]) return o.hit;
  if (KICK[o.kick]) return o.kick;
  if (o.kick === 0 || lightOf(o, asset)) return 0;
  return KICK[asset?.type] ? asset.type : 0;
}
export function lightOf(o, asset) {
  if (o.collide || HIT[o.hit] || KICK[o.kick] || o.light === 0) return false;
  return !!(LIGHT[o.light] || LIGHT[asset?.type]);
}
// set the collision of an object ('solid', a HIT or KICK type, 0 = off); anything but off switches the light off
export function setCollision(o, v, asset) {
  delete o.collide; delete o.hit; delete o.kick;
  if (v === 'solid') o.collide = true;
  else if (HIT[v]) o.hit = v;
  else if (KICK[v]) o.kick = v;
  else if (KICK[asset?.type]) o.kick = 0;
  if (v) { delete o.light; if (LIGHT[asset?.type]) o.light = 0; }
  return o;
}
// the warning light on / off; on switches the collision off
export function setLight(o, on, asset) {
  delete o.light;
  if (on) { delete o.collide; delete o.hit; delete o.kick; if (KICK[asset?.type]) o.kick = 0; if (!LIGHT[asset?.type]) o.light = 154; }
  else if (LIGHT[asset?.type]) o.light = 0;
  return o;
}
// the placement type the compiler writes (200: a plain object; 'solid' objects become landscape faces anyway)
export const placementType = (o, asset) => { const c = collisionOf(o, asset); return typeof c === 'number' && c ? c : lightOf(o, asset) ? 154 : 200; };
// drop identity transforms and tidy the numbers (the level stays small and readable)
export function tidyObject(o) {
  if (o.rot) { o.rot = o.rot.map(a => { a = Math.round(a * 10) / 10; a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }); if (o.rot.every(a => !a)) delete o.rot; }
  if (o.scale) { o.scale = o.scale.map(s => Math.max(0.01, Math.round(s * 1000) / 1000)); if (o.scale.every(s => s === 1)) delete o.scale; }
  for (const k of ['x', 'y', 'z']) o[k] = Math.round(o[k]);
  if (o.hit !== undefined && !HIT[o.hit]) delete o.hit;
  if (o.kick !== undefined && o.kick !== 0 && !KICK[o.kick]) delete o.kick;
  if (o.light !== undefined && o.light !== 0 && !LIGHT[o.light]) delete o.light;
  return o;
}
// the faces of every placed object in world coordinates: [{o, index, asset, faces: [{p, colour, flags, alpha}]}];
// assetOf(ref) gives the geometry {verts, faces: [[a, b, c, colour, flags, alpha]]} or null
export function placedFaces(level, assetOf) {
  return (level.objects || []).map((o, index) => {
    const A = assetOf(o.asset);
    if (!A) return { o, index, asset: null, faces: [] };
    const M = objectMatrix(o), P = A.verts.map(v => transformPoint(M, v));
    // surf: the surface code a body of an own asset asks for when the object is part of the landscape (collide)
    const faces = A.faces.map(([a, b, c, colour, flags, alpha, tile, uv, body]) => ({ p: [P[a], P[b], P[c]], colour, flags: flags || 0x11, alpha: alpha ?? 1, tile: tile || null, uv: uv || null,
                                                                                      body: body ?? null, surf: A.bodies?.[body]?.surface ?? null }));
    return { o, index, asset: A, faces };
  });
}
