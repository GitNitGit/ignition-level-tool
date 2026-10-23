// Warning signs (placement flags3: the sign the game shows while a car is on the section), set automatically from
// the track. Measured in the seven original levels (runs of the same flags3 and the bend after them):
//   odd values bend to the left of the driving direction (positive turn in x/z), even ones to the right
//   1/2 slight (total turn of the bend about 50-60 deg), 3/4 bend (about 125), 5/6 sharp (140-190),
//   7/8 U-turn, 9 jump, 10 fork, 13 warning, 15 drop (sign sheet H_signs.pic; 15 not seen in the originals)
//   a sign stands on about 5-6 sections before the bend.
// Signs set by hand (track.signs) win; forks get 10 in compile.js.
const SIGN_SECTIONS = 6;          // sections carrying the sign before the danger
const BEND_STEP = 0.035;          // a section turning more than this (rad) belongs to a bend (radius below ~5700 at 200)
const ang = (a, b) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);

// Map section id -> sign number
export function autoSigns(paths, an, track, inRange) {
  const out = new Map(), strength = new Map();
  const put = (id, v, prio) => { if ((strength.get(id) ?? -1) < prio) { out.set(id, v); strength.set(id, prio); } };
  for (const p of paths.all) {
    const n = p.closed ? p.frames.length : p.frames.length - 1;
    const secs = [...Array(n).keys()].map(j => an.byId.get(`${p.key}:${j}`));
    const dir = secs.map(s => [s.f1.c[0] - s.f0.c[0], s.f1.c[2] - s.f0.c[2]]);
    const len = dir.map(d => Math.hypot(...d));
    const turn = secs.map((s, j) => (j === 0 && !p.closed ? 0 : ang(dir[(j - 1 + n) % n], dir[j])));
    const idx = j => (p.closed ? ((j % n) + n) % n : j);
    const before = (start, v, prio) => {
      for (let k = 1; k <= SIGN_SECTIONS; k++) {
        const j = idx(start - k);
        if (j < 0 || j >= n || secs[j].jump) break;
        put(secs[j].id, v, prio);
      }
    };
    // bends: runs of sections turning the same way (gaps of one straight section close the run)
    const seen = new Set();
    for (let j0 = 0; j0 < n; j0++) {
      if (seen.has(j0) || Math.abs(turn[j0]) < BEND_STEP || secs[j0].jump) continue;
      const sgn = Math.sign(turn[j0]);
      if (p.closed && Math.sign(turn[idx(j0 - 1)]) === sgn && Math.abs(turn[idx(j0 - 1)]) >= BEND_STEP && j0 > 0) continue;   // not the start
      let total = 0, length = 0, j = j0, gap = 0;
      for (let q = 0; q < n; q++) {
        const jj = idx(j0 + q);
        if (jj < 0 || jj >= n || secs[jj].jump) break;
        if (Math.sign(turn[jj]) === sgn && Math.abs(turn[jj]) >= BEND_STEP) { gap = 0; j = jj; }
        else if (++gap > 1) break;
        seen.add(jj); total += turn[jj]; length += len[jj];
      }
      const deg = Math.abs(total) * 180 / Math.PI;
      if (deg < 35) continue;
      const level = deg < 80 ? 0 : deg < 135 ? 1 : deg >= 160 && length < 1800 ? 3 : 2;     // slight, bend, sharp, U-turn
      before(j0, 1 + 2 * level + (total > 0 ? 0 : 1), 10 + level);
    }
    // jumps: before the take-off
    for (let j = 0; j < n; j++) if (secs[j].jump && !secs[idx(j - 1)]?.jump) before(j, 9, 30);
    // drops: road sections marked as ramp outside jumps (a cliff), sign before the run
    for (let j = 0; j < n; j++) {
      const s = secs[j], prev = secs[idx(j - 1)];
      if (!s.jump && inRange(track.ramp, s) && !(prev && inRange(track.ramp, prev))) before(j, 15, 20);
    }
  }
  return out;
}
