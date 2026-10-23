// The editor's texture atlas for the objects' tiles: 64 x 64 PNGs from the server (/api/tiles/<level>/<tex>/<tile>.png,
// palette index 0 transparent) drawn into one 1024 x 1024 canvas (256 tiles) that one three.js texture shows; a face
// maps the texels of its tile into it. Tiles arrive asynchronously: until then a face shows its flat colour, then
// the level is drawn again (whenTilesLoad).
import * as THREE from './vendor/three.module.js';

const SIZE = 1024, TILE = 64, PER_ROW = SIZE / TILE;
const canvas = document.createElement('canvas');
canvas.width = canvas.height = SIZE;
const ctx = canvas.getContext('2d');
export const atlasTexture = new THREE.CanvasTexture(canvas);
atlasTexture.colorSpace = THREE.SRGBColorSpace;
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.LinearFilter;
atlasTexture.generateMipmaps = false;
const slots = new Map(), loading = new Set();      // key -> slot (-1: not available)
const listeners = [];
let timer = null;
export const whenTilesLoad = cb => { listeners.push(cb); };
const onLoaded = () => { for (const cb of listeners) cb(); };
// the atlas slot of a tile, or null while it loads (or when it is not available / the atlas is full)
export function tileSlot(key) {
  if (slots.has(key)) { const s = slots.get(key); return s < 0 ? null : s; }
  if (!loading.has(key) && slots.size + loading.size < PER_ROW * PER_ROW) fetchTile(key);
  return null;
}
function fetchTile(key) {
  loading.add(key);
  const img = new Image();
  img.onload = () => {
    const s = slots.size;
    slots.set(key, s);
    ctx.drawImage(img, (s % PER_ROW) * TILE, Math.floor(s / PER_ROW) * TILE);
    atlasTexture.needsUpdate = true;
    loading.delete(key);
    if (!timer) timer = setTimeout(() => { timer = null; onLoaded(); }, 150);
  };
  img.onerror = () => { loading.delete(key); slots.set(key, -1); if (!timer) timer = setTimeout(() => { timer = null; onLoaded(); }, 150); };
  img.src = `/api/tiles/${key}.png`;
}
// texture coordinates (0..1, v up as three.js reads the canvas) of a texel (u, v) inside the tile at `slot`
export const tileUV = (slot, [u, v]) => [((slot % PER_ROW) * TILE + u) / SIZE, 1 - (Math.floor(slot / PER_ROW) * TILE + v) / SIZE];
export const tilesLoaded = () => slots.size;
