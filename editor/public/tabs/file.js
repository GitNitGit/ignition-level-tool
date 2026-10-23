// The File tab: the level list, load, save, save as, new (undo / redo are edit.js).
import { $, S, sel, api, status, snapshot, confirmDiscard, anchorNow } from '../state.js';
import { views, frame } from '../views.js';
import { rebuild, undo, redo } from '../edit.js';
import { markDirty } from '../info.js';
import { showRuler } from '../ruler.js';
import { ensureObjectIds } from '/core/anim.js';

export async function load(name) {
  S.levelName = name;
  window.history.replaceState(null, '', '?level=' + encodeURIComponent(name));   // a reload comes back to this level
  S.level = await api('levels/' + name);
  ensureObjectIds(S.level);
  S.anim.id = null; S.anim.time = 0; S.anim.playing = false; S.animPose.clear();
  S.savedJSON = snapshot(); S.history = []; S.future = [];
  for (const s of Object.values(sel)) s.clear();
  showRuler(null);
  rebuild();
  views.forEach(v => frame(v, null));
  $('install').disabled = true; $('zipLink').hidden = true;
  $('levelName').textContent = name;
  $('slot').textContent = $('slotInfo').textContent = `LEVELS\\${S.level.slot || 'Canada'}`;
}

export async function save(asName, at = anchorNow()) {
  const n = asName || S.levelName;
  S.level.name = n;
  await api('levels/' + n, { method: 'PUT', body: JSON.stringify(S.level) });
  S.savedJSON = snapshot(); markDirty();
  if (asName) {
    S.levelName = n;
    if (![...$('level').options].some(o => o.value === n)) $('level').add(new Option(n, n));
    $('level').value = n;
    $('levelName').textContent = n;
  }
  status('saved: ' + n, 'ok', at);
}
const validName = n => /^[A-Za-z0-9_-]{1,64}$/.test(n);
$('save').onclick = () => save(undefined, $('save'));
$('saveAs').onclick = () => {
  const n = $('newName').value.trim();
  if (!validName(n)) return status('Name: letters, digits, _ and - only', 'warn');
  save(n, $('saveAs'));
};
$('create').onclick = async () => {
  const n = $('newName').value.trim();
  if (!validName(n)) return status('Name: letters, digits, _ and - only', 'warn');
  if (!confirmDiscard()) return;
  try {
    await api('levels', { method: 'POST', body: JSON.stringify({ name: n }) });
    $('level').add(new Option(n, n)); $('level').value = n;
    await load(n);
    status('new level: ' + n, 'ok', $('create'));
  } catch (err) { status(err.message, 'err', $('create')); }
};
$('level').onchange = async () => {
  if (!confirmDiscard()) { $('level').value = S.levelName; return; }
  await load($('level').value);
};
$('undo').onclick = undo;
$('redo').onclick = redo;
