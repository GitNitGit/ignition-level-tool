// The user's own textures (data/textures/*.png, served by /api/textures): their list and three.js textures. The
// list is polled every two seconds, so a file saved in a paint program shows in the editor at once.
import * as THREE from './vendor/three.module.js';

const list = new Map();                     // name -> {mtime, w, h, mean: '#rrggbb', texture (three), ready}
const listeners = [];
export const whenTexturesChange = cb => { listeners.push(cb); };
const onChange = () => { for (const cb of listeners) cb(); };
export const textureNames = () => [...list.keys()].sort();
export const textureMeta = name => list.get(name) || null;
// the three.js texture of an image, once it has loaded; null before
export function textureOf(name) { const t = list.get(name); return t && t.ready ? t.texture : null; }
async function poll() {
  let items;
  try { items = await (await fetch('/api/textures')).json(); } catch { return; }
  if (!Array.isArray(items)) return;
  let changed = false;
  const seen = new Set();
  for (const it of items) {
    seen.add(it.name);
    const cur = list.get(it.name);
    if (cur && cur.mtime === it.mtime) continue;
    changed = true;
    const entry = cur || { texture: new THREE.Texture(), ready: false };
    Object.assign(entry, { mtime: it.mtime, w: it.w, h: it.h });
    list.set(it.name, entry);
    const img = new Image();
    img.onload = () => {
      const t = entry.texture;
      t.image = img; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true; entry.ready = true; entry.mean = meanColour(img);
      onChange();
    };
    img.src = `/api/textures/${it.name}.png?t=${it.mtime}`;
  }
  for (const k of [...list.keys()]) if (!seen.has(k)) { list.delete(k); changed = true; }
  if (changed) onChange();
}
// the mean of the opaque texels, as '#rrggbb' (what a textured face shows where its tile did not fit the atlas)
function meanColour(img) {
  try {
    const c = document.createElement('canvas'), n = 16;
    c.width = n; c.height = n;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data, sum = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < n * n; i++) { if (d[i * 4 + 3] < 128) continue; for (let j = 0; j < 3; j++) sum[j] += d[i * 4 + j]; k++; }
    return '#' + sum.map(v => Math.round(k ? v / k : 128).toString(16).padStart(2, '0')).join('');
  } catch { return '#808080'; }
}
export function startTextureWatch() { poll(); setInterval(poll, 2000); }
