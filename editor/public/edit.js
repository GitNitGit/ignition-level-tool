// Changing the level: every change is one undo step, compiles the level again and redraws (rebuild); track changes
// keep the landscape (core/adapt.js). Undo / redo.
import { compileLevel } from '/core/compile.js';
import { edgeKey } from '/core/model.js';
import { adaptLevel } from '/core/adapt.js';
import { ensureObjectIds } from '/core/anim.js';
import { S, sel, status, snapshot, collectEditable } from './state.js';
import { draw } from './draw.js';
import { showReport, markDirty } from './info.js';
import { syncPanel } from './panels.js';

export function change(fn) {                     // one undo step
  S.history.push(snapshot()); S.future = [];
  if (S.history.length > 100) S.history.shift();
  const old = S.mode === 'track' && trackState();
  fn();
  if (old) adaptTo(old);
  rebuild();
}
// Changes of the track keep the landscape: it is pushed along and only re-made where the base does not fit any more
// (core/adapt.js). trackState() is taken before the change, adaptTo() after it.
export const trackState = () => (S.compiled?.base ? { base: S.compiled.base, pos: S.compiled.terrainInfo?.pos || [] } : null);
export function adaptTo(old, quiet = false) {
  const r = adaptLevel(S.level, old);
  if (r.removed) {
    sel.points.clear(); sel.tris.clear();
    if (!quiet) status(`Terrain adapted: ${r.removed} triangles beside the changed road re-made (${r.added} new).`, 'ok');
  }
  return r;
}

// While a control point is dragged only the ground is built (no kerbs, markings, compiler fixes) and the terrain is
// not adapted (its docked points follow the track, the rest stays): quick. On release the terrain is adapted from its
// state at the start of the drag and everything is built.
export function rebuild() {
  const { level, drag } = S;
  const quick = !!(drag && (drag.kind === 'nodes' || drag.kind === 'gizmo') && drag.moved && !drag.final);
  if (drag?.adapt && !quick) {
    level.terrain = JSON.parse(drag.adapt.terrain);
    const c = JSON.parse(drag.adapt.cuts);
    if (c) level.track.cuts = c; else delete level.track.cuts;
    drag.adapt.last = adaptTo(drag.adapt.old, true);
  }
  ensureObjectIds(level);                        // animations refer to objects by id
  const compiled = S.compiled = compileLevel(level, { quick });
  // forget selected things that no longer exist
  const ids = new Set(level.track.nodes.map(n => n.id));
  for (const id of [...sel.nodes]) if (!ids.has(id)) sel.nodes.delete(id);
  const edges = new Set((compiled.paths?.all || []).flatMap(p => [...Array(p.segs).keys()].map(i => edgeKey(...p.edge(i)))));
  for (const e of [...sel.edges]) if (!edges.has(e)) sel.edges.delete(e);
  const secIds = new Set((compiled.sections || []).map(s => s.id));
  for (const k of [...sel.sections]) if (!secIds.has(k)) sel.sections.delete(k);
  const np = level.terrain ? level.terrain.points.length : 0, nt = level.terrain ? level.terrain.tris.length : 0;
  for (const i of [...sel.points]) if (i >= np) sel.points.delete(i);
  for (const i of [...sel.tris]) if (i >= nt) sel.tris.delete(i);
  const no = level.objects ? level.objects.length : 0;
  for (const i of [...sel.objects]) if (i >= no) sel.objects.delete(i);
  const nb = S.assetEdit && level.assets?.[S.assetEdit.ref]?.bodies ? level.assets[S.assetEdit.ref].bodies.length : 0;
  for (const i of [...sel.bodies]) if (i >= nb) sel.bodies.delete(i);
  collectEditable();
  draw();
  showReport();
  syncPanel();
  markDirty();
}

export function undo() {
  if (!S.history.length) return;
  S.future.push(snapshot()); S.level = JSON.parse(S.history.pop());
  rebuild();
}
export function redo() {
  if (!S.future.length) return;
  S.history.push(snapshot()); S.level = JSON.parse(S.future.pop());
  rebuild();
}
