// Materials: the function of a face (surface code, LEVELFORMAT.md ch. 17) and its colour when it is not painted
// (mode 3, paint.js). The colours of all faces, with the baked light (lighting.js), go into the level's own palette
// (palette.js); no tiles of the original game are used.
//   road  grey asphalt                       drive  brown: drivable ground beside the road (gravel)
//   land  green: not drivable, acts as wall  dead   red: deadly, always (explosion)
//   roadSlip / roadOrder: road flagged "slippery" (behaviour 1) / "deadly outside the gate order" (behaviour 4)
//   line  road markings (asphalt)            kerb*: dark blue small walls (wall code)   deck: the thickness of a bridge
//   edge  ochre: drivable ground with ramp behaviour (code 11). The edge between drivable and not drivable ground
//         acts as a wall in the game, unless the drivable side has the ramp behaviour (jump take-off, game test)
export const MATERIALS = {
  road:      { code: 0,   color: [108, 108, 112] },
  ramp:      { code: 10,  color: [150, 132, 70] },     // asphalt, ramp (before and after jumps, sections marked "ramp")
  drive:     { code: 1,   color: [140, 98, 58] },
  land:      { code: 80,  color: [72, 142, 60] },
  dead:      { code: 110, color: [196, 40, 32] },
  roadSlip:  { code: 5,   color: [150, 162, 184] },
  roadOrder: { code: 20,  color: [128, 80, 84] },
  driveOrder: { code: 21, color: [150, 84, 68] },     // the verge of a section flagged "deadly if wrong order" (gravel, behaviour 4)
  line:      { code: 0,   color: [228, 228, 222] },
  kerbIn:    { code: 80,  color: [44, 72, 160] },
  kerbTop:   { code: 80,  color: [120, 150, 220] },
  kerbOut:   { code: 80,  color: [20, 34, 90] },
  deck:      { code: 80,  color: [78, 78, 88] },
  edge:      { code: 11,  color: [196, 152, 60] },
  kerbGround: { code: 1,  color: [120, 150, 220] },    // the ground under a kerb built as an object (compile option)
};
// road-like materials: their surface code follows the flags of the section (slippery, wrong order, ramp)
export const ROADLIKE = new Set(['road', 'ramp', 'roadSlip', 'roadOrder', 'line']);

// Order inside a mesh. The game sorts triangles into depth buckets and puts each new one at the head of its bucket's
// list; a bucket is drawn from the head, so of two triangles with the same bucket the one inserted LATER is drawn FIRST
// (LEVELFORMAT.md ch. 18). Faces that must stay on top on a tie therefore come first: raised parts
// (kerbs), then the road, then the ground.
export const DRAW_ORDER = ['kerbIn', 'kerbTop', 'kerbOut', 'road', 'line', 'roadSlip', 'roadOrder', 'ramp', 'deck', 'edge', 'kerbGround', 'drive', 'driveOrder', 'land', 'dead'];

// a face steeper than 60 degrees (game coordinates): seen at grazing angles, it needs both sides
export function steep(p) {
  const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...n);
  return len > 0 && Math.abs(n[1]) / len < 0.5;
}
