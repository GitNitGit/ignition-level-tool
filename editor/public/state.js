// Level editor, browser part (docs/EDITOR.md): the state every module shares and small helpers.
// Game coordinates (x, y, z) are drawn as three.js (x, y, -z).
import * as THREE from './vendor/three.module.js';
import { nodeMap } from '/core/model.js';
import * as TR from '/core/terrain.js';
import { MATERIALS } from '/core/materials.js';
import { baseColour, setBaseColour, setTerrainColour, materialColour } from '/core/paint.js';
import { hex } from '/core/palette.js';
import { buildAsset } from '/core/csg.js';
import { animOf, poseAt } from '/core/anim.js';
import { sourcePosition } from '/core/sounds.js';
import { badge, anchorNow } from './badge.js';

export const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
export const api = async (path, opts) => {
  const r = await fetch('/api/' + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
};
// a message as a badge at the action (badge.js): ok green, hint grey, warn orange, err red, busy until replaced
export const status = (text, cls = 'hint', at) => badge(text, cls, at);
export { anchorNow };
export const T = (x, y, z) => new THREE.Vector3(x, y, -z);           // game -> three
export const T3 = p => T(p[0], p[1], p[2]);

export const TABS = ['track', 'landscape', 'paint', 'assets', 'sounds', 'anim', 'deployment', 'file'];
export const TAB_OF_MODE = { track: 'track', terrain: 'landscape', paint: 'paint', assets: 'assets', asset: 'assets', anim: 'anim', sounds: 'sounds' };

// One object, so every module sees the same level, selection and mode (ES modules cannot assign each other's bindings).
export const S = {
  level: null, levelName: null, compiled: null,
  history: [], future: [], savedJSON: '',          // undo list, redo list, the level as last saved
  // nodes/edges/sections: mode 1; points/tris: indices into level.terrain (mode 2); objects: indices into level.objects
  sel: { nodes: new Set(), edges: new Set(), sections: new Set(), points: new Set(), tris: new Set(), objects: new Set(), bodies: new Set(), sources: new Set() },
  assetCache: new Map(),                          // asset geometry fetched from the server, by "<level>/<index>" (tabs/assets.js)
  assetEdit: null,                                // the custom asset being built (tabs/assetedit.js): {ref, at, before, isNew}
  lastSection: null,                              // anchor of Shift-click ranges
  faceList: [],                                   // everything drawn: [{kind: 'base' | 'terrain', t | id, p, mat}] (draw())
  secCache: null,
  mode: 'track',                                  // 'track' | 'terrain' | 'paint' | 'assets' | 'asset' (building one) | 'view' (looking only)
  trackPick: 'points',                            // the Track tab: 'points' (control points) or 'sections' (road sections); Space switches
  anim: { id: null, time: 0, playing: false, autoKey: true, selKey: null },   // the Animation tab: the animation shown, the playhead (s), Auto-key, the selected key
  animPose: new Map(),                            // object index -> {pos, rot} edited at the playhead, not yet a key
  tab: 'track',                                   // the header tab: track | landscape (mode terrain) | assets | paint | deployment | file
  pickTris: false,                                // mode 2: pick triangles instead of points
  newMat: 'land',                                 // material of new triangles
  editable: [],                                   // points the current mode edits: [{id, pos: [x, y, z]}]
  rebuildPending: false,                          // dragging: rebuild once per frame
  drag: null,                                     // {kind: 'nodes' | 'box' | 'pan' | 'orbit' | 'ruler' | 'brush', view, x, y, ...}
  hotView: 0, maxView: -1,                        // the view under the mouse; the maximised view (-1: all four)
  inspectOn: false,                               // the ? mode (inspect.js)
  anchor: null,                                   // Landscape: the point clicked last (aligning to it, rotating about it)
  vtool: 'move',                                  // Landscape: what dragging selected points does: 'move' | 'rotate'
  clipboard: null,                                // Landscape: copied triangles (terrain.js copyTriangles)
};
export const sel = S.sel;

export const secMap = () => {
  if (S.secCache?.of !== S.compiled) S.secCache = { of: S.compiled, byId: new Map((S.compiled.sections || []).map(s => [s.id, s])) };
  return S.secCache;
};
// colour of a face: painted, or its material's
export const colourOf = f => (f.kind === 'base' ? baseColour(S.level, f.t, secMap()) : S.level.terrain?.tris[f.id]?.[4]) || materialColour(f.mat, S.level);
export const paintFace = (f, colour) => (f.kind === 'base' ? setBaseColour(S.level, f.t, secMap(), colour) : setTerrainColour(S.level, f.id, colour));

// ---------------------------------------------------------------- mode adapters
export const selected = () => (S.mode === 'terrain' ? sel.points : S.mode === 'assets' || S.mode === 'anim' ? sel.objects : S.mode === 'asset' ? sel.bodies : S.mode === 'sounds' ? sel.sources : sel.nodes);
// the Animation tab: the entry of object i in the animation shown, its pose at the playhead (an edited pose first)
export const animEntry = i => { const a = S.level && S.anim.id ? animOf(S.level, S.anim.id) : null, o = S.level?.objects?.[i]; return a && o ? a.objects.find(e => e.object === o.id) || null : null; };
export const poseOf = i => { if (S.animPose.has(i)) return S.animPose.get(i); const e = animEntry(i); return e ? poseAt(e, S.anim.time) : null; };
export const setPose = (i, pose) => S.animPose.set(i, { pos: pose.pos.slice(), rot: (pose.rot || [0, 0, 0]).slice() });
// the custom asset being built and where it is shown
export const editedAsset = () => (S.assetEdit && S.level?.assets?.[S.assetEdit.ref]) || null;
// geometry of a placed object's asset: in the level (once placed) or in the cache (chosen in the library)
export const assetOf = ref => S.level?.assets?.[ref] || S.assetCache.get(ref) || null;
export const hasTerrain = () => !!(S.level && S.level.terrain && S.level.terrain.tris.length);
export const tinfo = () => S.compiled && S.compiled.terrainInfo;
export const tpos = () => tinfo().pos;
export function collectEditable() {
  if (S.mode === 'terrain') {
    const info = tinfo();
    // the base's outer row (locked) too: it can be picked (to make triangles, fill), not moved (2026-10-11)
    S.editable = info ? S.level.terrain.points.map((P, i) => ({ id: i, pos: info.pos[i], free: !P.d, lock: !!P.lock }))
      .filter(e => e.pos) : [];
  } else if (S.mode === 'track') {
    // points: the control points and, for selected knots with handles, their tangent handles '<id>#i' / '<id>#o'
    S.editable = S.trackPick === 'sections' ? [] : S.level.track.nodes.map(n => ({ id: n.id, pos: [n.x, n.y ?? 0, n.z] }));
    if (S.trackPick !== 'sections') for (const n of S.level.track.nodes) {
      if (!S.sel.nodes.has(n.id) || !(n.tm === 'linked' || n.tm === 'separated') || !n.ti || !n.to) continue;
      for (const [k, off] of [['i', n.ti], ['o', n.to]]) S.editable.push({ id: `${n.id}#${k}`, pos: [n.x + off[0], (n.y ?? 0) + off[1], n.z + off[2]], handle: true });
    }
  }
  else if (S.mode === 'assets' || S.mode === 'anim') S.editable = (S.level.objects || []).map((o, i) => { const p = S.mode === 'anim' ? poseOf(i) : null; return { id: i, pos: p ? p.pos.slice() : [o.x, o.y, o.z] }; });
  else if (S.mode === 'asset') { const A = editedAsset(); S.editable = A ? A.bodies.map((b, i) => ({ id: i, pos: b.pos.map((v, k) => v + S.assetEdit.at[k]) })) : []; }
  else if (S.mode === 'sounds') S.editable = (S.level.soundSources || []).map((q, i) => ({ id: i, pos: sourcePosition(S.level, q) }));
  else S.editable = [];
}
export const positionsOf = ids => {
  const byId = new Map(S.editable.map(e => [e.id, e.pos]));
  return new Map([...ids].filter(id => byId.has(id)).map(id => [id, byId.get(id).slice()]));
};
// write new positions (game coordinates) of the edited points into the level
export function setPositions(map) {
  if (S.mode === 'terrain') {
    for (const [id, pos] of map) TR.setPointPos(S.level.terrain, id, pos, tinfo().ctx);
    return;
  }
  if (S.mode === 'assets' || S.mode === 'anim') {
    for (const [id, pos] of map) {
      const o = S.level.objects?.[id];
      if (!o) continue;
      const p = S.mode === 'anim' ? poseOf(id) : null;                 // an animated object: its pose at the playhead moves
      if (p) { setPose(id, { pos: pos.map(Math.round), rot: p.rot }); continue; }
      o.x = Math.round(pos[0]); o.y = Math.round(pos[1]); o.z = Math.round(pos[2]);
    }
    return;
  }
  if (S.mode === 'sounds') {                      // a source: its point, or its offset on the object it rides on
    for (const [id, pos] of map) {
      const q = S.level.soundSources?.[id];
      if (!q) continue;
      const o = q.object ? (S.level.objects || []).find(x => x.id === q.object) : null;
      if (o) q.off = [0, 1, 2].map(k => Math.round(pos[k] - [o.x, o.y, o.z][k]));
      else { q.x = Math.round(pos[0]); q.y = Math.round(pos[1]); q.z = Math.round(pos[2]); }
    }
    return;
  }
  if (S.mode === 'asset') {
    const A = editedAsset(), at = S.assetEdit.at;
    if (!A) return;
    for (const [id, pos] of map) { const b = A.bodies[id]; if (b) b.pos = pos.map((v, k) => Math.round((v - at[k]) * 10) / 10); }
    buildAsset(A);
    return;
  }
  const nodes = nodeMap(S.level.track);
  for (const [id, pos] of map) {
    if (id.includes('#')) {                         // a tangent handle: the offset from its knot; linked keeps the other opposite
      const [nid, k] = id.split('#'), n = nodes.get(nid);
      if (!n) continue;
      const off = [Math.round(pos[0] - n.x), Math.round(pos[1] - (n.y ?? 0)), Math.round(pos[2] - n.z)];
      if (k === 'i') { n.ti = off; if (n.tm === 'linked') n.to = off.map(v => -v); } else { n.to = off; if (n.tm === 'linked') n.ti = off.map(v => -v); }
      continue;
    }
    const n = nodes.get(id);
    if (n) { n.x = Math.round(pos[0]); n.y = Math.round(pos[1]); n.z = Math.round(pos[2]); }
  }
}
export const snapshot = () => JSON.stringify(S.level);
export const isDirty = () => !!S.level && snapshot() !== S.savedJSON;
// unsaved changes: the browser asks before a reload (Ctrl+R), closing or leaving the page
addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
export const confirmDiscard = () => !isDirty() || confirm(`${S.levelName} has unsaved changes. Discard them?`);
