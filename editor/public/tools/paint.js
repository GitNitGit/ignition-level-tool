// Paint (mode 3, the Paint tab): one paint per triangle for road, kerbs, verge and landscape (core/paint.js): a
// colour, or one of the user's textures (data/textures/*.png) laid over the triangles by its size and mapping,
// with the texel coordinates computed from the position (nothing per corner). Tools: click, brush (one undo step
// per stroke), fill (connected faces painted the same), pick (takes a face's paint into the panel).
import { parsePaint, paintString } from '/core/paint.js';
import { $, S, status, snapshot, colourOf, paintFace } from '../state.js';
import { visibleFaces, faceAt } from '../pick.js';
import { draw } from '../draw.js';
import { change } from '../edit.js';
import { textureNames, textureMeta, whenTexturesChange } from '../textures.js';

const TOOLS = ['Click', 'Brush', 'Fill', 'Pick'];
export const tool = () => TOOLS.find(t => $('tool' + t).checked).toLowerCase();
let recent = [];
try { recent = JSON.parse(localStorage.getItem('e2recent') || '[]'); } catch { recent = []; }
function showRecent() {
  $('recent').innerHTML = recent.map(c => `<i style="background:${c}" data-c="${c}" title="${c}"></i>`).join('');
  $('recent').querySelectorAll('i').forEach(el => { el.onclick = () => { $('paintColour').value = el.dataset.c; $('paintErase').checked = false; }; });
}
export function useColour(c) {
  $('paintColour').value = c;
  recent = [c, ...recent.filter(x => x !== c)].slice(0, 16);
  try { localStorage.setItem('e2recent', JSON.stringify(recent)); } catch { /* no storage: fine */ }
  showRecent();
}
showRecent();
// the Pick tool (I, or the radio) hands back to the tool used before it once it has taken a paint (2026-10-11, user)
let lastTool = 'Click';
for (const t of TOOLS) $('tool' + t).addEventListener('change', () => { $('brush').hidden = true; if (t !== 'Pick') lastTool = t; });
export function choosePick() { $('toolPick').checked = true; $('brush').hidden = true; }
// Colour or Texture: the panel shows the fields of the one chosen
export const withTexture = () => $('pwTexture').checked;
function showWith() { $('pColour').hidden = withTexture(); $('pTexture').hidden = !withTexture(); }
$('pwColour').onchange = $('pwTexture').onchange = showWith;
// the texture fields: the images in data/textures (kept up to date), the size of one repeat, the mapping
let sizes = {};                                   // name -> size last used, so switching images keeps their sizes
try { sizes = JSON.parse(localStorage.getItem('e2texsize') || '{}'); } catch { sizes = {}; }
function fillImages() {
  const sel = $('ptexName'), cur = sel.value, names = textureNames();
  sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
  if (names.includes(cur)) sel.value = cur;
  $('ptexInfo').textContent = names.length ? '' : 'No PNG files in data/textures yet. Save one there: it shows here within two seconds.';
  showTexture();
}
function showTexture() {
  const name = $('ptexName').value, meta = name ? textureMeta(name) : null;
  $('ptexPreview').style.backgroundImage = meta ? `url(/api/textures/${name}.png?t=${meta.mtime})` : 'none';
  if (meta) $('ptexInfo').textContent = `${meta.w} × ${meta.h} texels, ${Math.ceil(meta.w / 64)} × ${Math.ceil(meta.h / 64)} tiles of 64`;
}
$('ptexName').onchange = () => { const n = $('ptexName').value; if (sizes[n]) $('ptexSize').value = sizes[n]; showTexture(); };
$('ptexSize').onchange = () => {
  const n = $('ptexName').value, v = Math.max(1, Number($('ptexSize').value) || 256);
  $('ptexSize').value = v;
  if (n) { sizes[n] = v; try { localStorage.setItem('e2texsize', JSON.stringify(sizes)); } catch { /* fine */ } }
};
whenTexturesChange(fillImages, 'paint');
fillImages();
// what a click paints: null = erase, a colour, or the texture string
export function paintValue() {
  if ($('paintErase').checked) return null;
  if (!withTexture()) return $('paintColour').value;
  const name = $('ptexName').value;
  if (!name) return undefined;
  return paintString({ tex: name, size: Math.max(1, Number($('ptexSize').value) || 256), map: $('ptexMap').value });
}
// the panel takes over a face's paint (the Pick tool)
export function takePaint(v) {
  const p = parsePaint(v);
  $('paintErase').checked = false;
  if (!p || p.colour) { $('pwColour').checked = true; showWith(); useColour(p ? p.colour : v); return status('colour taken: ' + (p ? p.colour : v), 'ok'); }
  $('pwTexture').checked = true; showWith();
  if (textureNames().includes(p.tex)) $('ptexName').value = p.tex;
  $('ptexSize').value = p.size; $('ptexMap').value = p.map; showTexture();
  return status(`texture taken: ${p.tex}, size ${p.size}, ${p.map}`, 'ok');
}
// connected faces painted the same (sharing an edge), from f0
function floodFrom(f0) {
  const faceList = S.faceList;
  const key = p => Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]);
  const ek = (f, j) => { const a2 = key(f.p[j]), b2 = key(f.p[(j + 1) % 3]); return a2 < b2 ? a2 + ' ' + b2 : b2 + ' ' + a2; };
  const edges = new Map();
  faceList.forEach((f, i) => { for (let j = 0; j < 3; j++) { const k = ek(f, j); if (!edges.has(k)) edges.set(k, []); edges.get(k).push(i); } });
  const target = colourOf(f0), start = faceList.indexOf(f0), seen = new Set([start]), stack = [start];
  while (stack.length) {
    const f = faceList[stack.pop()];
    for (let j = 0; j < 3; j++) for (const o of edges.get(ek(f, j))) if (!seen.has(o) && colourOf(faceList[o]) === target) { seen.add(o); stack.push(o); }
  }
  return [...seen].map(i => faceList[i]);
}
export function brushAt(v, px, py) {
  const r = Number($('brushSize').value) / 2, colour = paintValue();
  if (colour === undefined) return;
  for (const i of visibleFaces(v, px - r, py - r, px + r, py + r, true)) paintFace(S.faceList[i], colour);
  if (performance.now() - (S.drag.lastDraw || 0) > 40) { draw(); S.drag.lastDraw = performance.now(); }  // the whole compile once at the end
}
export function paintDown(v, px, py, e) {
  const t = e.altKey ? 'pick' : tool();
  const colour = t === 'pick' ? null : paintValue();
  if (colour === undefined) { S.drag = { kind: 'none' }; return status('Choose an image first (a PNG in data/textures).', 'warn'); }
  if (t === 'brush') { S.history.push(snapshot()); S.future = []; S.drag = { kind: 'brush', view: v }; brushAt(v, px, py); return; }
  S.drag = { kind: 'none' };
  const f = faceAt(v, px, py);
  if (!f) return status('Nothing to paint there.');
  if (t === 'pick') { if (!e.altKey) $('tool' + lastTool).checked = true; return takePaint(colourOf(f)); }
  change(() => { for (const g of t === 'fill' ? floodFrom(f) : [f]) paintFace(g, colour); });
  if (colour && !withTexture()) useColour(colour);
}
export function syncPaintPanel() {
  const n = S.compiled.palette ? S.compiled.palette.length : 0;
  showWith();
  const tex = new Set();
  for (const list of Object.values(S.level.paint?.base || {})) for (const [, , c] of list) { const p = parsePaint(c); if (p?.tex) tex.add(p.tex); }
  for (const t of S.level.terrain?.tris || []) { const p = parsePaint(t[4]); if (p?.tex) tex.add(p.tex); }
  $('paintInfo').textContent = `Palette: ${n} of 156 colours` + (tex.size ? `; textures painted: ${[...tex].sort().join(', ')}` : '');
}
