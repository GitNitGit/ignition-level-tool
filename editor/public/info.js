// The warnings & info panel: the check report (click to centre the views on the spot) or the statistics, switched
// by a toggle; the selection summed up under both; the save state in the header.
import { nodeMap } from '/core/model.js';
import { inRange } from '/core/sections.js';
import { $, S, sel, esc, T, tinfo, isDirty } from './state.js';
import { views } from './views.js';

// Warnings that only tell what the compiler did by itself (nothing to fix): notes, shown pale yellow below the real
// warnings. A warning object can also say so itself with level: 'info'.
const NOTES = [/^Long terrain edges were split/, /sections per placement \(/, /^Scenery cells of /, /\.SRF records \(originals/];
const isNote = e => (typeof e === 'object' && e.level === 'info') || NOTES.some(re => re.test(typeof e === 'string' ? e : e.text));
let infoView = 'warn';
try { if (localStorage.getItem('editor2.infoView') === 'info') infoView = 'info'; } catch {}

export function showReport() {
  const { errors, warnings, stats } = S.compiled.report;
  const item = cls => e => typeof e === 'string' ? `<li class="${cls}">${esc(e)}</li>`
    : `<li class="${cls}"><a data-at="${Array.isArray(e.at) ? e.at.join(',') : ''}">${esc(e.text)}</a></li>`;
  const real = warnings.filter(w => !isNote(w)), notes = warnings.filter(isNote);
  const rows = [['Track sections', stats.sections], ['Branches', stats.branches], ['Jumps', stats.jumps],
                ['Bridges/tunnels', stats.crossings], ['Track length', stats.trackLength],
                ['Lap time (expected)', stats.lapTime === undefined ? undefined : stats.lapTimeLong > stats.lapTime ? `${stats.lapTime} s (long way ${stats.lapTimeLong} s)` : `${stats.lapTime} s`], ['Terrain triangles', stats.terrainFaces], ['Triangles', stats.triangles],
                ['Objects', stats.objects || undefined], ['Placements', stats.placements], ['Wall edge to point (max)', stats.terrainFaces ? stats.maxWallDistance : undefined]];
  // red, orange, yellow from the top
  $('report').innerHTML = errors.length + warnings.length
    ? `<ul class="msgs">${errors.map(item('err')).join('')}${real.map(item('warn')).join('')}${notes.map(item('note')).join('')}</ul>`
    : '<div class="ok">all checks passed</div>';
  $('stats').innerHTML = `<table class="muted">${rows.filter(r => r[1] !== undefined).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
  // the toggle's label counts what is there, in the colour of the worst
  const counts = [[errors.length, 'err'], [real.length, 'warn'], [notes.length, 'note']].filter(c => c[0]);
  $('infoWarnLabel').innerHTML = 'Warnings' + counts.map(([n, cls]) => ` <b class="cnt ${cls}">${n}</b>`).join('');
  $('compile').disabled = errors.length > 0;
  $('report').querySelectorAll('a[data-at]').forEach(a => {
    a.onclick = () => {
      if (!a.dataset.at) return;
      const p = T(...a.dataset.at.split(',').map(Number));
      views.forEach(v => { if (v.type === '3d') v.target.copy(p); else v.center.copy(p); });
    };
  });
}
function setInfoView(v) {
  infoView = v;
  try { localStorage.setItem('editor2.infoView', v); } catch {}
  $('infoWarn').checked = v === 'warn'; $('infoInfo').checked = v === 'info';
  $('report').hidden = v !== 'warn'; $('stats').hidden = v !== 'info';
}
$('infoWarn').onchange = () => setInfoView('warn');
$('infoInfo').onchange = () => setInfoView('info');
setInfoView(infoView);

// the selection, summed up: what, how many, where (one point: its position; more: the box they span)
const plural = (n, word) => `${n} ${n === 1 ? word : word === 'body' ? 'bodies' : word + 's'}`;
function extentOf(ps) {
  if (!ps.length) return '';
  if (ps.length === 1) return ` at ${ps[0].map(Math.round).join(', ')}`;
  const lo = [0, 1, 2].map(k => Math.min(...ps.map(p => p[k]))), hi = [0, 1, 2].map(k => Math.max(...ps.map(p => p[k])));
  return `, ${Math.round(hi[0] - lo[0])} × ${Math.round(hi[2] - lo[2])}, height ${Math.round(lo[1])} to ${Math.round(hi[1])}`;
}
export function showSelection() {
  const { level, compiled, mode } = S, parts = [];
  if (mode === 'track') {
    const nodes = nodeMap(level.track), ids = [...sel.nodes];
    if (ids.length) parts.push(plural(ids.length, 'control point') + (ids.length <= 4 ? ` ${ids.join(', ')}` : '') + extentOf(ids.map(id => nodes.get(id)).filter(Boolean).map(n => [n.x, n.y ?? 0, n.z])));
    if (sel.edges.size) parts.push(plural(sel.edges.size, 'segment'));
    if (sel.sections.size) {
      const secs = compiled.sections.filter(s => sel.sections.has(s.id));
      const of = map => [...new Set(secs.map(s => Object.entries(map || {}).find(([, m]) => inRange(m, s))?.[0]))].filter(Boolean);
      const signs = of(level.track.signs), cams = of(level.track.camera);
      parts.push(plural(secs.length, 'road section') + (signs.length ? `, sign ${signs.join('/')}` : '') + (cams.length ? `, camera ${cams.join('/')}` : ''));
    }
  } else if (mode === 'terrain') {
    const info = tinfo();
    if (sel.points.size && info) parts.push(plural(sel.points.size, 'terrain point') + extentOf([...sel.points].map(i => info.pos[i]).filter(Boolean)));
    if (sel.tris.size && info) parts.push(plural(sel.tris.size, 'triangle') + extentOf([...new Set([...sel.tris].flatMap(id => level.terrain.tris[id].slice(0, 3)))].map(i => info.pos[i]).filter(Boolean)));
  } else if (mode === 'asset' && sel.objects.size === 0 && S.assetEdit) {
    const A = level.assets?.[S.assetEdit.ref];
    if (A && sel.bodies.size) parts.push(plural(sel.bodies.size, 'body') + ([...sel.bodies].length === 1 ? ` (${A.bodies[[...sel.bodies][0]]?.kind})` : ''));
  } else if (mode === 'sounds' && sel.sources.size) {
    parts.push(plural(sel.sources.size, 'sound source'));
  } else if ((mode === 'assets' || mode === 'anim') && sel.objects.size) {
    const objs = [...sel.objects].map(i => level.objects?.[i]).filter(Boolean);
    parts.push(plural(objs.length, 'object') + (objs.length === 1 ? ` ${objs[0].asset}` : '') + extentOf(objs.map(o => [o.x, o.y, o.z])));
  }
  $('selSummary').textContent = parts.length ? 'Selected: ' + parts.join('; ') : '';
  $('selSummary').title = $('selSummary').textContent;
}

// the save state beside the level name in the header
export function markDirty() {
  $('dirty').hidden = !isDirty();
}
