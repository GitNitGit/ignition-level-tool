// The Sounds tab (mode 'sounds'): the level's sounds (WAV files uploaded to the server, which converts them to the
// game's format: 8 bit mono 11025 Hz) and the sources where they play (core/sounds.js). A sound is dragged from the
// list into a view (the source lands on the ground there) and the source moved like a control point; it can ride on
// a placed object (and its animation). The compiler places a marker of type 144 + slot per source and writes the
// WAV files into the level's Sound folder.
import { soundOf, sourcePosition, soundSlots, soundFileName, newId, SLOT_FIRST, SLOT_MAX } from '/core/sounds.js';
import { $, S, sel, status, esc } from '../state.js';
import { host, viewAt, views } from '../views.js';
import { change } from '../edit.js';
import { draw } from '../draw.js';
import { syncPanel } from '../panels.js';
import { worldAt } from '../ruler.js';

let chosen = null;                                 // the sound chosen in the list (dragged, placed by double-click)
const soundUrl = s => `/api/levels/${encodeURIComponent(S.levelName)}/sound/${s.id}?t=${s.stamp || 0}`;
const sourcesOf = id => (S.level.soundSources || []).filter(x => x.sound === id).length;

// ---------------------------------------------------------------- the library
$('sndFile').onchange = async () => {
  const files = [...$('sndFile').files], at = $('sndFile');
  $('sndFile').value = '';
  for (const file of files) {
    const id = newId(S.level.sounds, 's');
    try {
      const r = await fetch(`/api/levels/${encodeURIComponent(S.levelName)}/sound/${id}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: file });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      change(() => { S.level.sounds ||= []; S.level.sounds.push({ id, name: file.name.replace(/\.wav$/i, ''), gain: 100, info: data.info, stamp: Date.now() }); });
      chosen = id;
      status(`${file.name}: ${data.info.seconds} s, ${data.info.rate} Hz, ${data.info.channels} channel(s), ${data.info.bits} bit, converted to 8 bit mono 11025 Hz`, 'ok', at);
    } catch (e) { status(`${file.name}: ${e.message}`, 'err', at); }
  }
  syncPanel();
};
function choose(id) { chosen = id; syncPanel(); }
$('sndList').onclick = e => {
  const row = e.target.closest('.orow');
  if (!row) return;
  const id = row.dataset.id, s = soundOf(S.level, id);
  if (!s) return;
  if (e.target.closest('.sndPlay')) {                           // preview through the browser
    const a = $('sndAudio');
    if (a.dataset.id === id && !a.paused) { a.pause(); return; }
    a.src = soundUrl(s); a.dataset.id = id; a.loop = true; a.play().catch(err => status('play: ' + err.message, 'warn'));
    return;
  }
  if (e.target.closest('.sndDel')) {
    if (!confirm(`Delete the sound "${s.name}"${sourcesOf(id) ? ` and its ${sourcesOf(id)} source(s)` : ''}?`)) return;
    fetch(`/api/levels/${encodeURIComponent(S.levelName)}/sound/${id}`, { method: 'DELETE' }).catch(() => {});
    change(() => { S.level.sounds = S.level.sounds.filter(x => x.id !== id); S.level.soundSources = (S.level.soundSources || []).filter(x => x.sound !== id); tidy(); });
    if (chosen === id) chosen = null;
    sel.sources.clear();
    return;
  }
  choose(id);
};
$('sndList').ondblclick = e => { const row = e.target.closest('.orow'); if (row && !e.target.closest('button')) { choose(row.dataset.id); placeAtViewCentre(); } };
// a drag must not rebuild the list (the dragged row would vanish and the browser cancel the drag): the choice is
// marked on the rows only
$('sndList').addEventListener('dragstart', e => {
  const row = e.target.closest('.orow');
  if (!row) return;
  chosen = row.dataset.id;
  $('sndList').querySelectorAll('.orow').forEach(r => r.classList.toggle('on', r.dataset.id === chosen));
  e.dataTransfer.setData('text/plain', 'sound:' + chosen); e.dataTransfer.effectAllowed = 'copy';
});
$('sndList').addEventListener('dragend', () => syncPanel());
$('sndList').onchange = e => {                                 // the gain field of a row
  const inp = e.target.closest('.sndGain'), row = e.target.closest('.orow');
  if (!inp || !row) return;
  const s = soundOf(S.level, row.dataset.id), v = Math.max(0, Math.min(400, Math.round(Number(inp.value) || 100)));
  if (s) change(() => { s.gain = v; });
};
$('sndList').oninput = e => { const inp = e.target.closest('.sndGain'), row = e.target.closest('.orow'); if (inp && row) { const s = soundOf(S.level, row.dataset.id); if (s) s.gain = Math.max(0, Math.min(400, Math.round(Number(inp.value) || 100))); } };
$('sndName').onchange = () => { const s = soundOf(S.level, chosen); if (s) change(() => { s.name = $('sndName').value.trim() || s.name; }); };
const tidy = () => { if (S.level.sounds && !S.level.sounds.length) delete S.level.sounds; if (S.level.soundSources && !S.level.soundSources.length) delete S.level.soundSources; };

// ---------------------------------------------------------------- sources
host.addEventListener('dragover', e => { if (S.mode === 'sounds' && chosen) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
host.addEventListener('drop', e => {
  if (S.mode !== 'sounds') return;
  const data = e.dataTransfer.getData('text/plain'), id = data.startsWith('sound:') ? data.slice(6) : chosen;
  if (!id) return;
  e.preventDefault();
  const r = host.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, v = viewAt(px, py);
  if (!v) return;
  placeSource(id, worldAt(v, px, py));
});
function placeAtViewCentre() {
  const v = views[S.hotView] || null;
  const vv = v && v.visible ? v : views.find(x => x.visible);
  if (!vv) return;
  placeSource(chosen, worldAt(vv, vv.rect.x + vv.rect.w / 2, vv.rect.y + vv.rect.h / 2));
}
export function placeSource(soundId, p) {
  if (!soundOf(S.level, soundId)) return status('Choose a sound first.', 'warn');
  change(() => {
    S.level.soundSources ||= [];
    S.level.soundSources.push({ id: newId(S.level.soundSources, 'q'), sound: soundId, x: Math.round(p[0]), y: Math.round(p[1]) + 50, z: Math.round(p[2]) });
    sel.sources = new Set([S.level.soundSources.length - 1]);
  });
}
export function deleteSources() {
  if (!sel.sources.size) return;
  change(() => { S.level.soundSources = (S.level.soundSources || []).filter((x, i) => !sel.sources.has(i)); sel.sources.clear(); tidy(); });
}
$('srcDelete').onclick = deleteSources;
// attached to an object: the offset from the object's placement is kept; detached: the world position stays
$('srcObject').onchange = () => {
  const i = [...sel.sources][0], src = S.level.soundSources?.[i];
  if (src === undefined) return;
  const id = $('srcObject').value, pos = sourcePosition(S.level, src);
  change(() => {
    if (!id) { delete src.object; delete src.off; [src.x, src.y, src.z] = pos; return; }
    const o = S.level.objects.find(x => x.id === id);
    if (!o) return;
    src.object = id; src.off = [pos[0] - o.x, pos[1] - o.y, pos[2] - o.z]; delete src.x; delete src.y; delete src.z;
  });
};
for (const [id, k] of [['srcX', 0], ['srcY', 1], ['srcZ', 2]]) $(id).onchange = () => {
  const i = [...sel.sources][0], src = S.level.soundSources?.[i], v = Number($(id).value);
  if (!src || !Number.isFinite(v)) return;
  change(() => { moveSource(src, k, v); });
};
// a source moved to a world position (drag, field): its point, or the offset when it rides on an object
export function moveSource(src, k, v) {
  if (!src.object) { src[['x', 'y', 'z'][k]] = Math.round(v); return; }
  const o = S.level.objects.find(x => x.id === src.object);
  if (!o) return;
  src.off ||= [0, 0, 0]; src.off[k] = Math.round(v - [o.x, o.y, o.z][k]);
}

export function syncSoundsPanel() {
  const level = S.level, sounds = level.sounds || [], slots = soundSlots(level);
  if (chosen && !soundOf(level, chosen)) chosen = null;
  $('sndList').innerHTML = sounds.map(s => {
    const slot = slots.get(s.id), over = slot > SLOT_MAX;
    return `<div class="orow${s.id === chosen ? ' on' : ''}" data-id="${esc(s.id)}" draggable="true" title="drag into a view: a source there; double-click: at the view's centre">`
      + `<button class="sndPlay" title="play / pause in the browser">▶</button><span class="name">${esc(s.name)}<br><small class="${over ? 'err' : ''}" title="length; the file in the level's Sound folder (its number is the slot, 144 + slot the marker type)">${s.info ? s.info.seconds + ' s · ' : ''}${over ? 'no free slot' : soundFileName(s, slot)}</small></span>`
      + `<input class="sndGain" type="number" min="0" max="400" step="10" value="${s.gain ?? 100}" title="gain in per cent, applied when the level is compiled">`
      + `<button class="sndDel danger" title="delete">🗑</button></div>`;
  }).join('') || '<div class="muted">No sounds yet: choose WAV files (any PCM format; they are converted to 8 bit mono 11025 Hz).</div>';
  const s = soundOf(level, chosen);
  $('sndBox').hidden = !s;
  if (s && document.activeElement !== $('sndName')) $('sndName').value = s.name;
  if (s) $('sndInfo').textContent = `${sourcesOf(s.id)} source(s); ${s.info ? `from ${s.info.rate} Hz, ${s.info.channels} ch, ${s.info.bits} bit` : ''}`;
  $('sndSlots').textContent = sounds.length > SLOT_MAX - SLOT_FIRST + 1 ? `Only ${SLOT_MAX - SLOT_FIRST + 1} own sounds fit (slots ${SLOT_FIRST}-${SLOT_MAX}).` : '';
  // the selected source
  const srcs = level.soundSources || [], i = sel.sources.size === 1 ? [...sel.sources][0] : -1, src = srcs[i];
  $('srcBox').hidden = !src;
  $('srcDelete').disabled = !sel.sources.size;
  if (!src) return;
  const snd = soundOf(level, src.sound), pos = sourcePosition(level, src);
  $('srcTitle').textContent = snd ? snd.name : '(no sound)';
  for (const [id, k] of [['srcX', 0], ['srcY', 1], ['srcZ', 2]]) if (document.activeElement !== $(id)) $(id).value = Math.round(pos[k]);
  const objs = level.objects || [];
  $('srcObject').innerHTML = '<option value="">none (a fixed point)</option>' + objs.map((o, k) => `<option value="${esc(o.id)}">${esc(level.assets?.[o.asset]?.name || o.asset)} ${k}</option>`).join('');
  $('srcObject').value = src.object && objs.some(o => o.id === src.object) ? src.object : '';
}
