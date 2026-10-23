// The Track tab (mode 1) in two pick modes (Space switches): POINTS - control points are selected, dragged, deleted
// (Del), inserted (double-click on the track); the fields of the selection (position, track width, verge widths),
// the tangent mode of the spline knots (auto / linked / separated / corner, with draggable handles), the toggles
// Jump and Branch for two selected points, Set start, Reverse direction. SECTIONS - road sections are selected
// (Shift: range, Ctrl: toggle, box) and styled with toggles (kerbs, verge, terrain, slippery, wrong order, ramp),
// the camera slider and the sign dropdown. Below both: the kerb profile and colours, the centre line, the crossings.
import { edgeKey, nextId, nodeMap, nodeRole, KERB_DEFAULT, DEFAULT_WIDTH, DEFAULT_VERGE, TANGENT_MODES } from '/core/model.js';
import { orderedTrack, autoHandles } from '/core/paths.js';
import { setRange, inRange } from '/core/sections.js';
import { materialColour } from '/core/paint.js';
import { $, S, sel, status, esc, T, collectEditable } from '../state.js';
import { views } from '../views.js';
import { change } from '../edit.js';
import { draw } from '../draw.js';
import { syncPanel } from '../panels.js';

// ---------------------------------------------------------------- points / sections
export function setTrackPick(p) {
  if (p === S.trackPick) return;
  S.trackPick = p;
  if (p === 'sections') { sel.nodes.clear(); sel.edges.clear(); } else sel.sections.clear();
  collectEditable(); draw(); syncPanel();
}
$('tpPoints').onchange = () => setTrackPick('points');
$('tpSections').onchange = () => setTrackPick('sections');

const KERB_COLOURS = [['kcIn', 'in', 'kerbIn'], ['kcTop', 'top', 'kerbTop'], ['kcOut', 'out', 'kerbOut']];
export function syncTrackPanel() {
  const { level } = S, t = level.track;
  $('tpPoints').checked = S.trackPick !== 'sections'; $('tpSections').checked = S.trackPick === 'sections';
  $('tpPointsPanel').hidden = S.trackPick === 'sections'; $('tpSectionsPanel').hidden = S.trackPick !== 'sections';
  // ---- points
  const ids = [...sel.nodes], nodes = nodeMap(t);
  $('selProps').hidden = !ids.length;
  if (ids.length) {
    const vals = (k, d) => [...new Set(ids.map(id => Math.round(nodes.get(id)[k] ?? d)))];
    for (const [id, k, d] of [['px', 'x', 0], ['pz', 'z', 0], ['py', 'y', 0], ['pw', 'width', DEFAULT_WIDTH], ['pvl', 'vl', DEFAULT_VERGE], ['pvr', 'vr', DEFAULT_VERGE]]) {
      const v = vals(k, d);
      if (document.activeElement !== $(id)) { $(id).value = v.length === 1 ? v[0] : ''; $(id).placeholder = v.length > 1 ? 'mixed' : ''; }
      $(id).disabled = (k === 'x' || k === 'z') && ids.length > 1;
    }
    const modes = [...new Set(ids.map(id => nodes.get(id).tm || 'auto'))];
    for (const m of TANGENT_MODES) $('tm' + m).checked = modes.length === 1 && modes[0] === m;
  }
  const mainSel = ids.filter(id => t.main.includes(id)), two = ids.length === 2;
  const br = two ? branchBetween(ids[0], ids[1]) : null, jk = two ? edgeOfTwoNodes() : null;
  $('branch').disabled = !(two && (br || mainSel.length === 2));
  $('branch').classList.toggle('on', !!br);
  $('jump').disabled = !(sel.edges.size || jk);
  $('jump').classList.toggle('on', !!(jk && t.jumps.includes(jk)) || (sel.edges.size > 0 && [...sel.edges].every(k => t.jumps.includes(k))));
  $('setStart').disabled = !(ids.length === 1 && mainSel.length === 1);
  // ---- sections: a toggle is on when every selected section has the style
  const secs = S.compiled.sections.filter(s => sel.sections.has(s.id)), ns = secs.length;
  for (const [id, map, side, inverted] of SECTION_TOGGLES) {
    $(id).disabled = !ns;
    const on = ns > 0 && secs.every(s => !!inRange(t[map] || {}, s, side) !== inverted);
    $(id).classList.toggle('on', on);
  }
  $('camSlider').disabled = $('signSel').disabled = !ns;
  const keyed = key => [...new Set(secs.map(s => Object.entries(t[key] || {}).find(([, m]) => inRange(m, s))?.[0] || ''))];
  const cams = keyed('camera'), signs = keyed('signs');
  const camValue = c => (!c ? 0 : Number(c) > 10 ? (Number(c) - 10) * 50 : -Number(c) * 50);
  if (document.activeElement !== $('camSlider')) $('camSlider').value = cams.length === 1 ? camValue(cams[0]) : 0;
  $('camVal').textContent = cams.length > 1 ? 'mixed' : (camValue(cams[0]) > 0 ? '+' : '') + camValue(cams[0] || '');
  $('signSel').value = signs.length === 1 ? signs[0] : '';
  // ---- kerbs, centre line, crossings
  const kerb = { ...KERB_DEFAULT, ...(t.kerb || {}) };
  for (const [id, k] of [['kLid', 'lid'], ['kFoot', 'foot'], ['kHeight', 'height']]) if (document.activeElement !== $(id)) $(id).value = kerb[k];
  for (const [id, k, mat] of KERB_COLOURS) if (document.activeElement !== $(id)) $(id).value = t.kerb?.colours?.[k] || materialColour(mat);
  $('markCentre').value = t.marking?.centre || 'none';
  const crossings = S.compiled.base?.crossings || [], cl = $('crossList');
  cl.innerHTML = crossings.length ? crossings.map((c, i) => {
    const [ku, kl] = c.key.split('^');
    const opts = ['tunnel', 'bridge', 'none'].map(m => `<option value="${m}"${m === c.mode ? ' selected' : ''}>${m}${c.auto && m === c.mode ? ' (auto)' : ''}</option>`).join('');
    return `<div class="cross"><a data-i="${i}" title="centre the views here">${esc(c.upper)} ${esc(ku)} over ${esc(c.lower)} ${esc(kl)}</a><select data-key="${esc(c.key)}">${opts}</select></div>`;
  }).join('') : 'none';
  cl.querySelectorAll('a').forEach(a => { a.onclick = () => { const p = T(...crossings[a.dataset.i].at); views.forEach(v => { if (v.type === '3d') v.target.copy(p); else v.center.copy(p); }); }; });
  cl.querySelectorAll('select').forEach(s => { s.onchange = () => change(() => { S.level.track.crossings ||= {}; S.level.track.crossings[s.dataset.key] = s.value; }); });
}

// ---------------------------------------------------------------- the control point fields
for (const [id, k] of [['px', 'x'], ['pz', 'z'], ['py', 'y'], ['pw', 'width'], ['pvl', 'vl'], ['pvr', 'vr']]) {
  $(id).onchange = () => {
    const v = Number($(id).value);
    if ($(id).value === '' || !Number.isFinite(v)) return;
    const nodes = nodeMap(S.level.track);
    change(() => { for (const n of sel.nodes) nodes.get(n)[k] = k === 'width' ? Math.max(120, Math.min(1200, v)) : k === 'vl' || k === 'vr' ? Math.max(0, Math.min(800, v)) : v; });
  };
}
// the tangent mode of the selected knots: linked / separated get handles (started from the automatic tangents),
// auto and corner have none
for (const m of TANGENT_MODES) $('tm' + m).onchange = () => change(() => {
  const t = S.level.track, nodes = nodeMap(t);
  for (const id of sel.nodes) {
    const n = nodes.get(id);
    if (!n) continue;
    if (m === 'auto') { delete n.tm; delete n.ti; delete n.to; continue; }
    n.tm = m;
    if (m === 'corner') { delete n.ti; delete n.to; continue; }
    if (!n.ti || !n.to) Object.assign(n, autoHandles(t, id));
    if (m === 'linked') n.to = n.ti.map(v => -v);
  }
});
// kerb profile and colours
for (const [id, k, lo, hi] of [['kLid', 'lid', 10, 300], ['kFoot', 'foot', 30, 400], ['kHeight', 'height', 5, 300]]) {
  $(id).onchange = () => {
    const v = Number($(id).value);
    if (!Number.isFinite(v)) return;
    change(() => { const t = S.level.track; t.kerb = { ...KERB_DEFAULT, ...(t.kerb || {}) }; t.kerb[k] = Math.max(lo, Math.min(hi, Math.round(v)));
                   if (t.kerb.lid > t.kerb.foot) t.kerb.lid = t.kerb.foot; });
  };
}
for (const [id, k] of KERB_COLOURS) $(id).onchange = () => change(() => {
  const t = S.level.track;
  t.kerb = { ...KERB_DEFAULT, ...(t.kerb || {}) };
  t.kerb.colours = { ...(t.kerb.colours || {}), [k]: $(id).value };
});
$('markCentre').onchange = () => change(() => { S.level.track.marking = { ...(S.level.track.marking || {}), centre: $('markCentre').value }; });

// ---------------------------------------------------------------- styles of the selected road sections
// [button, range map, side (+1 left, -1 right, null both), inverted (the map stores the absence: no verge, no terrain)]
const SECTION_TOGGLES = [['sKerbL', 'kerbs', 1, false], ['sKerbR', 'kerbs', -1, false], ['sVergeL', 'noVerge', 1, true], ['sVergeR', 'noVerge', -1, true],
  ['sTerrain', 'noTerrain', null, true], ['sSlip', 'slippery', null, false], ['sOrder', 'order', null, false], ['sRamp', 'ramp', null, false]];
function styleSections(fn) {
  const secs = S.compiled.sections.filter(s => sel.sections.has(s.id));
  if (!secs.length) return;
  change(() => {
    for (const k of ['kerbs', 'slippery', 'order', 'ramp', 'noVerge', 'noTerrain']) S.level.track[k] ||= {};
    fn(secs, S.level.track);
  });
}
for (const [id, map, side, inverted] of SECTION_TOGGLES) $(id).onclick = () => {
  const on = !$(id).classList.contains('on');                 // all on -> off, else on
  styleSections((s, t) => setRange(t[map], s, [side], on !== inverted));
};
// warning signs and camera offsets: one range map per value (track.signs["<sign>"], track.camera["<value>"]); a
// section has at most one of each
const setKeyed = (key, secs, value) => {
  const t = S.level.track;
  t[key] ||= {};
  for (const m of Object.values(t[key])) setRange(m, secs, [null], false);
  if (value) { t[key][value] ||= {}; setRange(t[key][value], secs, [null], true); }
  for (const [k, m] of Object.entries(t[key])) if (!Object.keys(m).length) delete t[key][k];
};
// camera: -500..+500 in steps of 50 = placement flags2 1-10 (minus) and 11-20 (plus), 0 = none
$('camSlider').oninput = () => { const v = Number($('camSlider').value); $('camVal').textContent = (v > 0 ? '+' : '') + v; };
$('camSlider').onchange = () => { const v = Number($('camSlider').value); styleSections(s => setKeyed('camera', s, v === 0 ? null : String(v < 0 ? -v / 50 : 10 + v / 50))); };
$('signSel').onchange = () => styleSections(s => setKeyed('signs', s, $('signSel').value || null));

// ---------------------------------------------------------------- editing the track
function edgeOfTwoNodes() {
  if (sel.nodes.size !== 2) return null;
  const [a, b] = [...sel.nodes], key = edgeKey(a, b);
  const exists = (S.compiled.paths?.all || []).some(p => [...Array(p.segs).keys()].some(i => edgeKey(...p.edge(i)) === key));
  return exists ? key : null;
}
const branchBetween = (a, b) => S.level.track.branches.find(br => (br.from === a && br.to === b) || (br.from === b && br.to === a)) || null;
$('jump').onclick = () => {
  const keys = sel.edges.size ? [...sel.edges] : [edgeOfTwoNodes()].filter(Boolean);
  if (!keys.length) return status('Select two neighbouring points.', 'warn');
  change(() => {
    const j = new Set(S.level.track.jumps);
    const on = keys.some(k => !j.has(k));
    for (const k of keys) { if (on) j.add(k); else j.delete(k); }
    S.level.track.jumps = [...j].sort();
  });
};
$('setStart').onclick = () => change(() => { S.level.track.start.node = [...sel.nodes][0]; });
$('reverse').onclick = () => change(() => { S.level.track.start.reverse = !S.level.track.start.reverse; });

// insert a control point into segment `key` at game position p (default: spline middle)
export function insertInto(key, p = null) {
  const { level, compiled } = S;
  const path = compiled.paths.all.find(q => [...Array(q.segs).keys()].some(i => edgeKey(...q.edge(i)) === key));
  if (!path) return null;
  const seg = [...Array(path.segs).keys()].find(i => edgeKey(...path.edge(i)) === key);
  const [a, b] = path.edge(seg), nodes = nodeMap(level.track);
  const mid = path.at(seg, 0.5);
  const id = nextId(level.track.nodes, 'n');
  const na = nodes.get(a), nb = nodes.get(b);
  const node = { id, x: Math.round(p ? p[0] : mid.x), z: Math.round(p ? p[2] : mid.z),
                 y: Math.round(((na.y ?? 0) + (nb.y ?? 0)) / 2), width: Math.round(((na.width ?? DEFAULT_WIDTH) + (nb.width ?? DEFAULT_WIDTH)) / 2),
                 vl: Math.round(((na.vl ?? DEFAULT_VERGE) + (nb.vl ?? DEFAULT_VERGE)) / 2), vr: Math.round(((na.vr ?? DEFAULT_VERGE) + (nb.vr ?? DEFAULT_VERGE)) / 2) };
  level.track.nodes.push(node);
  const putBetween = (list, i0, i1) => {          // list contains a and b next to each other (or wrapped)
    if (Math.abs(i0 - i1) === 1) list.splice(Math.max(i0, i1), 0, id);
    else list.push(id);                            // wrap: last <-> first
  };
  if (path.key === 'main') putBetween(level.track.main, level.track.main.indexOf(a), level.track.main.indexOf(b));
  else {
    const br = level.track.branches.find(x => x.id === path.key);
    const full = [br.from, ...br.nodes, br.to];
    const i0 = full.indexOf(a), i1 = full.indexOf(b);
    full.splice(Math.max(i0, i1), 0, id);
    br.nodes = full.slice(1, -1);
  }
  const j = new Set(level.track.jumps);
  if (j.delete(key)) { j.add(edgeKey(a, id)); j.add(edgeKey(id, b)); }
  level.track.jumps = [...j].sort();
  return id;
}

export function deleteSelected() {
  if (!sel.nodes.size) return;
  const t = S.level.track;
  for (const id of sel.nodes) {
    const r = nodeRole(t, id);
    if (r.endpointOf.length) return status(`${id} is the end of branch ${r.endpointOf[0].id}: delete the branch's points first.`, 'warn');
  }
  const mainLeft = t.main.filter(id => !sel.nodes.has(id)).length;
  if (mainLeft < 3) return status('The main loop needs at least 3 points.', 'warn');
  change(() => {
    for (const id of sel.nodes) {
      if (t.start.node === id) {
        const i = t.main.indexOf(id);
        t.start.node = t.main.find((x, k) => k > i && !sel.nodes.has(x)) || t.main.find(x => !sel.nodes.has(x));
      }
    }
    t.main = t.main.filter(id => !sel.nodes.has(id));
    for (const b of t.branches) b.nodes = b.nodes.filter(id => !sel.nodes.has(id));
    t.branches = t.branches.filter(b => b.nodes.length);
    t.nodes = t.nodes.filter(n => !sel.nodes.has(n.id) && (t.main.includes(n.id) || t.branches.some(b => b.nodes.includes(n.id))));
    t.jumps = t.jumps.filter(k => !k.split('|').some(id => sel.nodes.has(id)));
    sel.nodes.clear();
  });
}

// Branch: between two main-loop points a new branch bulging outwards; between the ends of an existing branch the
// branch is removed (with its points)
$('branch').onclick = () => {
  const t = S.level.track, nodes = nodeMap(t);
  const [p, q] = [...sel.nodes], existing = branchBetween(p, q);
  if (existing) {
    return change(() => {
      t.branches = t.branches.filter(b => b !== existing);
      const gone = new Set(existing.nodes);
      t.nodes = t.nodes.filter(n => !gone.has(n.id));
      t.jumps = t.jumps.filter(k => !k.split('|').some(id => gone.has(id)));
    });
  }
  const { main } = orderedTrack(t);
  const [a, b] = [p, q].sort((x, y) => main.indexOf(x) - main.indexOf(y));
  if (main.indexOf(a) === 0 || main.indexOf(b) === 0) return status('A branch must not start or end at the start point.', 'warn');
  change(() => {
    const na = nodes.get(a), nb = nodes.get(b);
    const cx = t.nodes.reduce((s, n) => s + n.x, 0) / t.nodes.length, cz = t.nodes.reduce((s, n) => s + n.z, 0) / t.nodes.length;
    const made = [1 / 3, 2 / 3].map(f => {
      const x = na.x + (nb.x - na.x) * f, z = na.z + (nb.z - na.z) * f;
      const d = Math.hypot(x - cx, z - cz) || 1;
      const id = nextId(t.nodes, 'n');
      t.nodes.push({ id, x: Math.round(x + (x - cx) / d * 2500), z: Math.round(z + (z - cz) / d * 2500),
                     y: Math.round(((na.y ?? 0) + (nb.y ?? 0)) / 2), width: DEFAULT_WIDTH, vl: DEFAULT_VERGE, vr: DEFAULT_VERGE });
      return id;
    });
    const br = { id: nextId(t.branches, 'b'), from: a, to: b, nodes: made };
    if (t.start.reverse) Object.assign(br, { from: b, to: a, nodes: made.slice().reverse() });   // stored in loop order
    t.branches.push(br);
    sel.nodes.clear(); made.forEach(id => sel.nodes.add(id));
  });
};
