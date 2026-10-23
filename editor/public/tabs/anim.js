// The Animation tab (mode 'anim'): placed objects move along keyframes (core/anim.js). The panel holds the animations
// of the level (name, length in seconds, the objects in it); the timeline under the views has the time ruler, a track
// per object with its keys, the playhead, Play, Auto-key and Key. Working: scrub to a time, move the selected object
// with the gizmo or by dragging (as in the Assets tab), the pose becomes a key at the playhead (Auto-key, or the Key
// button). The views show every object of the current animation at its pose at the playhead (draw.js keeps those
// objects as separate groups, so scrubbing and playing are cheap). Objects not in an animation are moved as usual.
import { ANIM_FPS, ANIM_MAX_SECONDS, animOf, animEntryOf, poseAt, setKey } from '/core/anim.js';
import { $, S, sel, status, esc, poseOf, animEntry } from '../state.js';
import { change, rebuild } from '../edit.js';
import { draw, applyAnimPoses } from '../draw.js';
import { syncPanel } from '../panels.js';
import { layout } from '../views.js';

export const currentAnim = () => (S.level && S.anim.id ? animOf(S.level, S.anim.id) : null);
const objectName = o => { const A = S.level.assets?.[o.asset]; return A?.name || o.asset; };
const clampTime = t => Math.max(0, Math.min(currentAnim()?.length || 0, t));

// ---------------------------------------------------------------- the panel
export function syncAnimPanel() {
  const level = S.level, list = level.animations || [], sel0 = $('animSel');
  if (S.anim.id && !animOf(level, S.anim.id)) S.anim.id = null;
  if (!S.anim.id && list.length) S.anim.id = list[0].id;
  sel0.innerHTML = list.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  sel0.value = S.anim.id || '';
  const a = currentAnim();
  $('animBox').hidden = !a;
  for (const id of ['animDel', 'animAdd', 'animRemove']) $(id).disabled = !a;
  if (a) {
    if (document.activeElement !== $('animName')) $('animName').value = a.name;
    if (document.activeElement !== $('animLen')) $('animLen').value = a.length;
    const objs = level.objects || [];
    $('animObjs').innerHTML = a.objects.map((e, k) => {
      const i = objs.findIndex(o => o.id === e.object), o = objs[i];
      return `<div class="orow${sel.objects.has(i) ? ' on' : ''}" data-i="${i}"><span class="glyph">◆</span><span class="name">${o ? esc(objectName(o)) : '(missing)'} <small>${i >= 0 ? i : ''}</small></span><span class="dim">${e.keys.length} keys</span></div>`;
    }).join('') || '<div class="muted">No objects: select objects in the views and add them.</div>';
    $('animInfo').textContent = `${Math.round(a.length * ANIM_FPS) + 1} frames at ${ANIM_FPS}/s; the game restarts the path after the last frame`;
    const selAnimated = [...sel.objects].some(i => animEntry(i));
    $('animRemove').disabled = !selAnimated;
    $('animAdd').disabled = ![...sel.objects].some(i => objs[i] && !animEntryOf(level, objs[i].id));
  }
  renderTimeline();
}
$('animSel').onchange = () => { selectAnim($('animSel').value); };
export function selectAnim(id) { S.anim.id = id; S.anim.time = 0; S.anim.playing = false; S.anim.selKey = null; S.animPose.clear(); draw(); syncPanel(); }
$('animNew').onclick = () => {
  const level = S.level, n = (level.animations || []).length + 1, id = 'a' + Date.now().toString(36);
  change(() => { level.animations ||= []; level.animations.push({ id, name: `Animation ${n}`, length: 10, objects: [] }); });
  selectAnim(id);
};
$('animDel').onclick = () => {
  const a = currentAnim();
  if (!a || !confirm(`Delete the animation "${a.name}" with its keys? Ctrl+Z brings it back.`)) return;
  change(() => { S.level.animations = S.level.animations.filter(x => x !== a); if (!S.level.animations.length) delete S.level.animations; });
  S.anim.id = null; S.animPose.clear(); draw(); syncPanel();
};
$('animName').onchange = () => { const a = currentAnim(); if (a) change(() => { a.name = $('animName').value.trim() || a.name; }); };
$('animLen').onchange = () => {
  const a = currentAnim(), v = Number($('animLen').value);
  if (!a || !Number.isFinite(v)) return;
  change(() => { a.length = Math.max(1, Math.min(ANIM_MAX_SECONDS, Math.round(v * 10) / 10)); for (const e of a.objects) e.keys = e.keys.filter(k => k.t <= a.length); });
  S.anim.time = clampTime(S.anim.time);
};
// the selected objects into the animation: a key at t = 0 with the placement as the pose
$('animAdd').onclick = () => {
  const a = currentAnim(), objs = S.level.objects || [];
  if (!a) return;
  const add = [...sel.objects].map(i => objs[i]).filter(Boolean);
  const busy = add.filter(o => animEntryOf(S.level, o.id)), solid = add.filter(o => o.collide);
  if (busy.length) status(`${busy.length} object(s) are in an animation already (one path per object).`, 'warn');
  if (solid.length) status(`${solid.length} object(s) are part of the landscape (Collision ON): they cannot move.`, 'warn');
  const list = add.filter(o => !animEntryOf(S.level, o.id) && !o.collide);
  if (!list.length) return;
  change(() => { for (const o of list) a.objects.push({ object: o.id, keys: [{ t: 0, pos: [o.x, o.y, o.z], rot: (o.rot || [0, 0, 0]).slice() }] }); });
};
export function removeSelectedFromAnim() {
  const a = currentAnim();
  if (!a) return;
  const ids = new Set([...sel.objects].map(i => S.level.objects?.[i]?.id).filter(Boolean));
  if (!ids.size) return;
  change(() => { a.objects = a.objects.filter(e => !ids.has(e.object)); });
  S.animPose.clear();
}
$('animRemove').onclick = removeSelectedFromAnim;
$('animObjs').onclick = e => {
  const row = e.target.closest('.orow');
  if (!row) return;
  const i = Number(row.dataset.i);
  if (i < 0) return;
  if (e.ctrlKey) { sel.objects.has(i) ? sel.objects.delete(i) : sel.objects.add(i); } else if (e.shiftKey) sel.objects.add(i); else sel.objects = new Set([i]);
  draw(); syncPanel();
};

// ---------------------------------------------------------------- poses and keys
// a pose edited at the playhead (gizmo, drag) becomes a key: at once with Auto-key, else with the Key button
export function setPose(i, pose) { S.animPose.set(i, { pos: pose.pos.slice(), rot: (pose.rot || [0, 0, 0]).slice() }); }
export function commitPoses(undo = true) {
  const a = currentAnim();
  if (!a || !S.animPose.size) return false;
  const t = S.anim.time, work = () => {
    for (const [i, pose] of S.animPose) { const e = animEntry(i); if (e) setKey(e, t, pose); }
    S.animPose.clear();
  };
  if (undo) change(work); else work();                 // without undo: inside a drag whose start pushed the undo step; the caller rebuilds
  return true;
}
// a drag ended (input.js): Auto-key keeps the pose as a key, else it waits for the Key button
export function dragEnded() { if (S.anim.autoKey) commitPoses(false); }
$('tlKey').onclick = () => {
  const a = currentAnim();
  if (!a) return;
  if (!S.animPose.size) {                                 // nothing edited: the selected objects' current poses become keys
    for (const i of sel.objects) { const p = poseOf(i); if (p) S.animPose.set(i, p); }
  }
  if (!commitPoses(true)) status('Select an object of the animation first.', 'warn');
};
$('tlAuto').onchange = () => { S.anim.autoKey = $('tlAuto').checked; };
export function deleteKey() {
  const a = currentAnim(), k = S.anim.selKey;
  if (!a || !k) return false;
  const e = a.objects[k.entry];
  if (!e || k.key === 0) { status('The key at 0 is the object\'s placement: it stays (remove the object from the animation instead).', 'warn'); return true; }
  change(() => { e.keys.splice(k.key, 1); });
  S.anim.selKey = null;
  return true;
}
$('tlDelKey').onclick = deleteKey;

// ---------------------------------------------------------------- the timeline
let scrub = null;                                  // a drag on the ruler / tracks, or on a key {entry, key}
export function setTime(t) {
  S.anim.time = Math.round(clampTime(t) * 100) / 100;
  S.animPose.clear();                              // an uncommitted pose is dropped when the playhead moves
  applyAnimPoses();
  renderTimeline();
}
export function setPlaying(on) {
  S.anim.playing = on && !!currentAnim();
  $('tlPlay').textContent = S.anim.playing ? '❚❚' : '▶';
  if (S.anim.playing) S.animPose.clear();
}
$('tlPlay').onclick = () => setPlaying(!S.anim.playing);
// called from the animation loop: the playhead runs, the path restarts hard after the last frame
let lastTick = 0;
export function animTick() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (!S.anim.playing || S.mode !== 'anim') return;
  const a = currentAnim();
  if (!a) { setPlaying(false); return; }
  let t = S.anim.time + dt;
  if (t > a.length) t = 0;
  S.anim.time = t;
  applyAnimPoses();
  renderTimeline(true);
}
const trackX = t => { const a = currentAnim(); const w = $('tlRuler').clientWidth; return a && a.length ? t / a.length * w : 0; };
const timeAtX = x => { const a = currentAnim(); const w = $('tlRuler').clientWidth || 1; return a ? x / w * a.length : 0; };
export function renderTimeline(light = false) {
  const a = currentAnim(), tl = $('timeline');
  if (tl.hidden) return;
  $('tlTime').textContent = `${S.anim.time.toFixed(2)} s`;
  $('tlHead').style.left = trackX(S.anim.time) + 'px';
  if (light) return;
  $('tlAuto').checked = S.anim.autoKey;
  $('tlPlay').textContent = S.anim.playing ? '❚❚' : '▶';
  const ruler = $('tlRuler'), tracks = $('tlTracks');
  if (!a) { ruler.innerHTML = ''; tracks.querySelectorAll('.tlrow').forEach(r => r.remove()); return; }
  const w = ruler.clientWidth || 600, step = a.length <= 12 ? 1 : a.length <= 30 ? 2 : a.length <= 60 ? 5 : 10;
  let ticks = '';
  for (let t = 0; t <= a.length + 1e-6; t += step) ticks += `<i style="left:${t / a.length * w}px"><b>${t}</b></i>`;
  ruler.innerHTML = ticks;
  tracks.querySelectorAll('.tlrow').forEach(r => r.remove());
  const objs = S.level.objects || [];
  a.objects.forEach((e, k) => {
    const i = objs.findIndex(o => o.id === e.object), row = document.createElement('div');
    row.className = 'tlrow' + (sel.objects.has(i) ? ' on' : ''); row.dataset.entry = k;
    row.innerHTML = `<span class="tllabel">${objs[i] ? esc(objectName(objs[i])) : '(missing)'}</span><div class="tlline">` + e.keys.map((key, j) =>
      `<b class="tlkey${S.anim.selKey && S.anim.selKey.entry === k && S.anim.selKey.key === j ? ' on' : ''}" data-entry="${k}" data-key="${j}" style="left:${key.t / a.length * w}px" title="${key.t} s"></b>`).join('') + '</div>';
    tracks.append(row);
  });
}
const lineX = e => e.clientX - $('tlRuler').getBoundingClientRect().left;
$('tlRuler').addEventListener('pointerdown', e => { scrub = { kind: 'time' }; $('tlRuler').setPointerCapture(e.pointerId); setPlaying(false); setTime(timeAtX(lineX(e))); });
$('tlRuler').addEventListener('pointermove', e => { if (scrub?.kind === 'time') setTime(timeAtX(lineX(e))); });
$('tlRuler').addEventListener('pointerup', () => { scrub = null; });
$('tlTracks').addEventListener('pointerdown', e => {
  const key = e.target.closest('.tlkey');
  if (!key && !e.target.closest('.tlline')) return;      // a click on a label does nothing
  $('tlTracks').setPointerCapture(e.pointerId);
  setPlaying(false);
  if (key) {
    const k = { entry: Number(key.dataset.entry), key: Number(key.dataset.key) };
    S.anim.selKey = k; scrub = { kind: 'key', ...k, t0: currentAnim().objects[k.entry].keys[k.key].t, moved: false };
    const row = e.target.closest('.tlrow'), i = (S.level.objects || []).findIndex(o => o.id === currentAnim().objects[k.entry].object);
    if (row && i >= 0 && !sel.objects.has(i)) { sel.objects = new Set([i]); draw(); }
    setTime(scrub.t0); syncPanel();
    return;
  }
  scrub = { kind: 'time' };
  setTime(timeAtX(lineX(e)));
});
$('tlTracks').addEventListener('pointermove', e => {
  if (!scrub) return;
  const t = timeAtX(lineX(e));
  if (scrub.kind === 'time') return setTime(t);
  if (scrub.key === 0) return;                      // the first key stays at 0
  scrub.moved = true; scrub.t = Math.round(Math.max(0.01, t) * 100) / 100;
  $('tlTracks').querySelector(`.tlkey[data-entry="${scrub.entry}"][data-key="${scrub.key}"]`).style.left = trackX(scrub.t) + 'px';
  S.anim.time = scrub.t; applyAnimPosesAt(scrub.t); renderTimeline(true);
});
$('tlTracks').addEventListener('pointerup', () => {
  if (scrub?.kind === 'key' && scrub.moved) {
    const a = currentAnim(), e = a.objects[scrub.entry], key = e.keys[scrub.key], t = scrub.t;
    change(() => { e.keys = e.keys.filter(x => x !== key && Math.abs(x.t - t) >= 0.005); key.t = t; e.keys.push(key); e.keys.sort((p, q) => p.t - q.t); });
    S.anim.selKey = { entry: scrub.entry, key: e.keys.indexOf(key) };
    setTime(t); syncPanel();
  }
  scrub = null;
});
function applyAnimPosesAt(t) { const keep = S.anim.time; S.anim.time = t; applyAnimPoses(); S.anim.time = keep; }
// the timeline shows only in the Animation tab; the views give it the room
export function showTimeline(on) { if ($('timeline').hidden === !on) return; $('timeline').hidden = !on; layout(); if (on) renderTimeline(); }
addEventListener('resize', () => { if (!$('timeline').hidden) renderTimeline(); });
