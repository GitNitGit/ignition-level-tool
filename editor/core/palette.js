// The level palette: all face colours (painted colour x light) reduced to the free palette entries.
export const PAL_FROM = 4, PAL_TO = 160;            // own colours 4..159 (0..3 and 160..255 stay: transparent, cars, effects)
export const PAL_SIZE = PAL_TO - PAL_FROM;            // 156

// Median cut: at most k colours for the weighted colour list [[r, g, b, weight]] (from editor/atlas.js)
export function medianCut(colors, k) {
  const boxes = [colors];
  const range = box => [0, 1, 2].map(c => {
    let lo = 255, hi = 0;
    for (const p of box) { lo = Math.min(lo, p[c]); hi = Math.max(hi, p[c]); }
    return hi - lo;
  });
  while (boxes.length < k) {
    let best = -1, score = -1;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const s = Math.max(...range(b)) * Math.sqrt(b.reduce((a, p) => a + p[3], 0));
      if (s > score) { score = s; best = i; }
    });
    if (best < 0) break;
    const box = boxes[best], r = range(box), ch = r.indexOf(Math.max(...r));
    box.sort((a, b) => a[ch] - b[ch]);
    const total = box.reduce((a, p) => a + p[3], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i][3]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map(b => {
    const w = b.reduce((a, p) => a + p[3], 0);
    return [0, 1, 2].map(c => Math.round(b.reduce((a, p) => a + p[c] * p[3], 0) / w));
  });
}

// colours: [[r, g, b]] with weights -> {palette: [[r, g, b]], index(colour) -> palette slot}
export function buildPalette(colours, weights) {
  const uniq = new Map();
  colours.forEach((c, i) => { const k = c.join(','); uniq.set(k, (uniq.get(k) || 0) + (weights ? weights[i] : 1)); });
  const list = [...uniq].map(([k, w]) => [...k.split(',').map(Number), w]);
  const palette = list.length <= PAL_SIZE ? list.map(c => c.slice(0, 3)) : medianCut(list, PAL_SIZE);
  const cache = new Map();
  const index = c => {
    const k = c.join(',');
    if (!cache.has(k)) {
      let best = 0, bd = Infinity;
      palette.forEach((p, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
      cache.set(k, best);
    }
    return cache.get(k);
  };
  return { palette, index };
}

// Texture 0 is a grid of 16 x 16 cells of 16 x 16 texels, one cell per palette slot; a face shows one colour by
// pointing all three corners into its cell (texel coordinates, inset from the cell border).
export const CELL = 16;
export const cellUV = slot => {
  const cx = (slot % 16) * CELL, cy = Math.floor(slot / 16) * CELL;
  return [[cx + 4, cy + 4], [cx + 12, cy + 4], [cx + 8, cy + 12]];
};

export const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
