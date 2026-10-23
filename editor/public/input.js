// Mouse and keys in the views: select, drag, box select, pan / orbit / zoom, double-click insert, WASD panning,
// the shortcuts (docs/EDITOR.md "Controls").
import * as THREE from './vendor/three.module.js';
import { $, S, sel, T, T3, status, snapshot, selected, hasTerrain, tinfo, tpos, positionsOf, setPositions, TABS } from './state.js';
import { views, canvas, local, viewAt, toScreen, rayAt, axes, updateCamera, frame } from './views.js';
import { draw } from './draw.js';
import { syncPanel, setMode, setTab } from './panels.js';
import { rebuild, change, trackState, undo, redo } from './edit.js';
import { pickNode, pickSection, pickEdge, pickTri, clickSection, visibleTris } from './pick.js';
import { tool, paintDown, brushAt, paintValue, useColour, choosePick } from './tools/paint.js';
import { rulerOn, worldAt, showRuler } from './ruler.js';
import { setInspect, showTip } from './inspect.js';
import { insertInto, deleteSelected, setTrackPick } from './tabs/track.js';
import { deleteTris, setPick, deletePoints, copyTerrain, pasteTerrain, rotateStart, rotation } from './tabs/landscape.js';
import { deleteObjects, pickObject, duplicateObjects } from './tabs/assets.js';
import { pickGizmo, gizmoStart, gizmoMove, gizmoEnd } from './gizmo.js';
import { assetClick, deleteBodies, faceTool, duplicateBodies, renameSelectedBody } from './tabs/assetedit.js';
import { dragEnded, deleteKey, removeSelectedFromAnim } from './tabs/anim.js';
import { deleteSources } from './tabs/sounds.js';
import { editedAsset } from './state.js';
import { save } from './tabs/file.js';

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  const [px, py] = local(e);
  const v = viewAt(px, py);
  if (!v || !S.level) return;
  // a field of the panels still holding the focus lets go: what was typed applies to the selection it was typed for,
  // and the panel shows the next selection's values (a focused field is not overwritten), and the keys work again
  const fo = document.activeElement;
  if (fo && fo !== document.body && fo.closest?.('#left, #header, #viewbar, .popover')) fo.blur();
  S.hotView = v.index;
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 2) { S.drag = { kind: v.type === '3d' ? 'orbit' : 'pan', view: v, x: px, y: py }; return; }
  if (e.button === 1) { S.drag = { kind: 'pan', view: v, x: px, y: py }; e.preventDefault(); return; }
  if (e.button !== 0) return;
  if (S.inspectOn) return;
  if (rulerOn()) { const a = worldAt(v, px, py); S.drag = { kind: 'ruler', view: v, a }; showRuler(a, a, px, py); return; }
  const { mode } = S;
  if (mode === 'view') return;
  if (mode === 'paint') return paintDown(v, px, py, e);
  // Assets / asset editor: the gizmo's handles come first (move / rotate / scale the selection)
  if (((mode === 'assets' || mode === 'anim') && sel.objects.size) || (mode === 'asset' && sel.bodies.size && !faceTool())) {
    const h = pickGizmo(v, px, py);
    // Ctrl+drag on an arrow copies the selection and moves the copies along the axis (as Ctrl+drag on the faces)
    const dup = e.ctrlKey && h?.kind === 'move' && (mode === 'assets' || mode === 'asset');
    if (h) { S.drag = { kind: 'gizmo', view: v, x: px, y: py, h, dup, moved: false, g: gizmoStart(v, px, py, h) }; canvas.style.cursor = 'grabbing'; return; }
  }
  if (mode === 'asset' && faceTool()) { assetClick(v, px, py, e); return; }
  // things (objects, bodies): Ctrl+drag copies the selection, Ctrl+click (no drag) toggles - decided on release
  const things = mode === 'assets' || mode === 'asset' || mode === 'anim';
  // a drag of the selected points / things from (px, py); in 3D along the ground plane through `ref` (game coordinates)
  const startDrag = (ref, opts = {}) => {
    canvas.style.cursor = 'move';
    const drag = S.drag = { kind: 'nodes', view: v, x: px, y: py, moved: false, start: positionsOf(selected()), ...opts };
    if (v.type === '3d') {
      drag.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ref[1]);
      drag.hit0 = rayAt(v, px, py).ray.intersectPlane(drag.plane, new THREE.Vector3());
    }
  };
  const id = mode === 'track' && S.trackPick === 'sections' ? null : pickNode(v, px, py);
  // a tangent handle: dragged on its own, the selection stays
  if (id !== null && typeof id === 'string' && id.includes('#')) {
    const h = S.editable.find(x => x.id === id);
    startDrag(h.pos, { start: new Map([[id, h.pos.slice()]]) });
    return;
  }
  if (id !== null) {
    const sl = selected();
    const wasSelected = sl.has(id);            // only selected points move: a click on another one just selects it
    if (mode === 'terrain' && !wasSelected) S.anchor = id;             // the point clicked last (align, rotate)
    if (e.ctrlKey) { if (!(things && wasSelected)) { sl.has(id) ? sl.delete(id) : sl.add(id); } }
    else if (e.shiftKey) sl.add(id);
    else if (!sl.has(id)) { sl.clear(); sel.edges.clear(); sl.add(id); }
    draw(); syncPanel();
    if (!wasSelected || !sl.has(id)) { S.drag = { kind: 'none' }; return; }
    startDrag(positionsOf(sl).get(id), things && e.ctrlKey ? { dup: true, toggleOnClick: id } : mode === 'terrain' ? { clickId: id } : {});
    // Landscape, the rotate tool: dragging a selected point (not the anchor itself) turns the selection about the anchor
    if (mode === 'terrain' && S.vtool === 'rotate' && id !== S.anchor) S.drag.rotate = rotateStart(v, px, py, S.drag.start);
    return;
  }
  // triangles: decided on release - hardly moved is a click on the triangle, dragged is a box
  if (mode === 'terrain' && S.pickTris) { S.drag = { kind: 'box', view: v, x: px, y: py, add: e.shiftKey, toggle: e.ctrlKey, tri: pickTri(v, px, py) }; return; }
  // asset editor: a click on the asset picks the body under the cursor; a drag on a selected body moves the selection
  if (mode === 'asset') {
    S.drag = { kind: 'none' };
    const hit = assetClick(v, px, py, e);
    if (hit && sel.bodies.has(hit.body)) startDrag([hit.point.x, hit.point.y, -hit.point.z], e.ctrlKey ? { dup: true, toggleOnClick: hit.body } : {});
    return;
  }
  // Assets / Animation: a click on an object's faces picks it, a drag on a selected one moves the selection (in the
  // Animation tab the pose at the playhead; no copies there)
  if (mode === 'assets' || mode === 'anim') {
    const hit = pickObject(v, px, py);
    if (hit) {
      const was = sel.objects.has(hit.index);
      if (e.ctrlKey) { if (!was) sel.objects.add(hit.index); }
      else if (e.shiftKey) sel.objects.add(hit.index);
      else if (!was) sel.objects = new Set([hit.index]);
      draw(); syncPanel();
      S.drag = { kind: 'none' };
      const dup = e.ctrlKey && mode === 'assets';
      if (sel.objects.has(hit.index)) startDrag([hit.point.x, hit.point.y, -hit.point.z], dup && was ? { dup: true, toggleOnClick: hit.index } : dup ? { dup: true } : e.ctrlKey && was ? { toggleOnClick: hit.index } : {});
      return;
    }
  }
  const section = pickSection(v, px, py);
  if (section) { clickSection(section, e); return; }
  const edge = mode === 'track' && S.trackPick === 'sections' ? null : pickEdge(v, px, py);
  if (edge) {
    if (e.ctrlKey) { sel.edges.has(edge.key) ? sel.edges.delete(edge.key) : sel.edges.add(edge.key); }
    else if (e.shiftKey) sel.edges.add(edge.key);
    else { sel.nodes.clear(); sel.edges.clear(); sel.edges.add(edge.key); }
    draw(); syncPanel();
    return;
  }
  S.drag = { kind: 'box', view: v, x: px, y: py, add: e.shiftKey, toggle: e.ctrlKey };
});

canvas.addEventListener('pointermove', e => {
  const [px, py] = local(e);
  const hv = viewAt(px, py);
  const { drag, mode, level } = S;
  if (hv && !drag) S.hotView = hv.index;
  if (hv) S.mouse = { view: hv.index, px, py };
  views.forEach(v => v.frameEl.classList.toggle('hot', v.index === S.hotView));
  if (S.inspectOn && !drag) { showTip(hv, px, py); canvas.style.cursor = 'help'; return; }
  // brush outline in paint mode
  const showBrush = mode === 'paint' && tool() === 'brush' && hv;
  $('brush').hidden = !showBrush;
  if (showBrush) {
    const d = Number($('brushSize').value);
    Object.assign($('brush').style, { left: px - d / 2 + 'px', top: py - d / 2 + 'px', width: d + 'px', height: d + 'px' });
  }
  if (drag && drag.kind === 'brush') { brushAt(drag.view, px, py); return; }
  if (drag && drag.kind === 'ruler') { showRuler(drag.a, worldAt(drag.view, px, py), px, py); return; }
  if (drag && drag.kind === 'gizmo') {
    if (!drag.moved) {
      S.history.push(snapshot()); S.future = []; drag.moved = true;
      if (drag.dup) {                              // the copies stand where the originals are; they are the ones moved
        if (mode === 'asset') { const A = editedAsset(); if (A) duplicateBodies(A, false); } else duplicateObjects(false);
        drag.g = gizmoStart(drag.view, drag.x, drag.y, drag.h);
      }
    }
    gizmoMove(drag.view, px, py, drag.g, e.ctrlKey && !drag.dup);
    S.rebuildPending = true;
    return;
  }
  if (!drag) {
    if (rulerOn()) { canvas.style.cursor = 'crosshair'; return; }
    if (hv && level && mode === 'paint') { canvas.style.cursor = tool() === 'brush' ? 'none' : 'crosshair'; return; }
    if (hv && level && (((mode === 'assets' || mode === 'anim') && sel.objects.size) || (mode === 'asset' && sel.bodies.size && !faceTool())) && pickGizmo(hv, px, py)) { canvas.style.cursor = 'grab'; return; }
    if (hv && level && mode === 'asset' && faceTool()) { canvas.style.cursor = 'crosshair'; return; }
    if (hv && level) {
      const id = pickNode(hv, px, py);
      canvas.style.cursor = id !== null && selected().has(id) ? 'move' : id !== null || pickEdge(hv, px, py) || pickSection(hv, px, py) ? 'crosshair' : '';
    }
    return;
  }
  const v = drag.view, dx = px - drag.x, dy = py - drag.y;
  if (drag.kind === 'pan') {
    if (v.type === '3d') {
      const { right, up } = axes(v), k = v.dist * 0.0012;
      v.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    } else {
      const { right, up } = axes(v);
      v.center.addScaledVector(right, -dx * v.scale).addScaledVector(up, dy * v.scale);
    }
    drag.x = px; drag.y = py;
  } else if (drag.kind === 'orbit') {
    v.yaw -= dx * 0.006;
    v.pitch = Math.max(0.05, Math.min(1.5, v.pitch + dy * 0.006));
    drag.x = px; drag.y = py;
  } else if (drag.kind === 'nodes') {
    let d;                                         // move in game coordinates
    if (v.type === '3d') {
      const hit = rayAt(v, px, py).ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit || !drag.hit0) return;
      d = { x: hit.x - drag.hit0.x, y: 0, z: -(hit.z - drag.hit0.z) };
    } else {
      const { right, up } = axes(v);
      const w = right.clone().multiplyScalar(dx * v.scale).addScaledVector(up, -dy * v.scale);
      d = { x: w.x, y: w.y, z: -w.z };
    }
    if (!drag.moved) {
      S.history.push(snapshot()); S.future = []; drag.moved = true;
      // the landscape is adapted from where it was at the start of the drag, at every step
      if (mode === 'track' && level.terrain) drag.adapt = { old: trackState(), terrain: JSON.stringify(level.terrain), cuts: JSON.stringify(level.track.cuts || null) };
      // Ctrl+drag on objects or bodies: copies are made where they stand and those are dragged
      if (drag.dup) {
        if (mode === 'asset') { const A = editedAsset(); if (A) duplicateBodies(A, false); } else if (mode === 'assets') duplicateObjects(false);
        drag.start = positionsOf(selected());
        delete drag.toggleOnClick;
      }
    }
    if (drag.rotate) { setPositions(rotation(drag.rotate, v, px, py)); S.rebuildPending = true; return; }
    const snap = e.ctrlKey && !drag.dup ? 100 : 1, snapY = e.ctrlKey && !drag.dup ? 25 : 1;
    const moved = new Map();
    for (const [id, s] of drag.start) {
      moved.set(id, [Math.round((s[0] + d.x) / snap) * snap, Math.round((s[1] + d.y) / snapY) * snapY,
                     Math.round((s[2] + d.z) / snap) * snap]);
    }
    setPositions(moved);
    S.rebuildPending = true;
  } else if (drag.kind === 'box') {
    Object.assign($('box').style, { left: Math.min(px, drag.x) + 'px', top: Math.min(py, drag.y) + 'px',
      width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
    $('box').hidden = false;
  }
});

canvas.addEventListener('pointerup', e => {
  const { drag, mode, level } = S;
  if (!drag) return;
  if (drag.kind === 'ruler') { S.drag = null; return; }                  // the measurement stays until the next one
  if (drag.kind === 'gizmo') {
    canvas.style.cursor = '';
    if (drag.moved) { gizmoEnd(drag.g); if (mode === 'anim') dragEnded(); drag.final = true; S.rebuildPending = false; rebuild(); }
    S.drag = null;
    return;
  }
  if (drag.kind === 'nodes' && drag.moved) { if (mode === 'anim') dragEnded(); drag.final = true; S.rebuildPending = false; rebuild(); }
  else if (S.rebuildPending) { S.rebuildPending = false; rebuild(); }
  else if (drag.kind === 'nodes' && drag.toggleOnClick !== undefined) { selected().delete(drag.toggleOnClick); draw(); syncPanel(); }   // Ctrl+click without a drag: toggled off
  else if (drag.kind === 'nodes' && drag.clickId !== undefined && selected().has(drag.clickId)) { S.anchor = drag.clickId; draw(); }   // a click on a selected point: the anchor
  if (drag.kind === 'nodes') canvas.style.cursor = '';
  if (drag.kind === 'brush') { const c = paintValue(); if (c) useColour(c); S.drag = null; rebuild(); return; }
  const [px, py] = local(e);
  if (drag.kind === 'box') {
    $('box').hidden = true;
    const x0 = Math.min(px, drag.x), x1 = Math.max(px, drag.x), y0 = Math.min(py, drag.y), y1 = Math.max(py, drag.y);
    const click = x1 - x0 < 4 && y1 - y0 < 4;
    if (click && drag.tri !== undefined && drag.tri >= 0) {          // a click on a triangle
      const tri = drag.tri;
      if (drag.toggle) { sel.tris.has(tri) ? sel.tris.delete(tri) : sel.tris.add(tri); }
      else if (drag.add) sel.tris.add(tri);
      else { sel.tris.clear(); sel.tris.add(tri); }
      draw(); syncPanel(); S.drag = null;
      return;
    }
    // sections mode: the road sections whose middle lies in the box
    if (mode === 'track' && S.trackPick === 'sections') {
      if (!drag.add && !drag.toggle) sel.sections.clear();
      if (!click) for (const s of S.compiled.sections) {
        if (s.jump) continue;
        const c = toScreen(drag.view, T((s.c0[0] + s.c1[0]) / 2, s.y, (s.c0[1] + s.c1[1]) / 2));
        if (!(c[2] > -1 && c[2] < 1 && c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1)) continue;
        if (drag.toggle && sel.sections.has(s.id)) sel.sections.delete(s.id); else sel.sections.add(s.id);
      }
      draw(); syncPanel(); S.drag = null;
      return;
    }
    const tris = mode === 'terrain' && S.pickTris, sl = tris ? sel.tris : selected();
    let inside;
    if (tris) {
      // every triangle the box touches, however little
      const pos = tpos(), proj = new Map();
      const at = i => { if (!proj.has(i)) proj.set(i, pos[i] ? toScreen(drag.view, T3(pos[i])) : null); return proj.get(i); };
      const crosses = (a, b, c, d) => {               // segments a-b and c-d (screen) intersect
        const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        return o(a, b, c) * o(a, b, d) <= 0 && o(c, d, a) * o(c, d, b) <= 0;
      };
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const touches = q => {
        if (q.some(p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1)) return true;      // a corner in the box
        if (Math.max(...q.map(p => p[0])) < x0 || Math.min(...q.map(p => p[0])) > x1
            || Math.max(...q.map(p => p[1])) < y0 || Math.min(...q.map(p => p[1])) > y1) return false;
        for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++)                                  // an edge across the box
          if (crosses(q[i], q[(i + 1) % 3], corners[k], corners[(k + 1) % 4])) return true;
        const s = (a, b, p) => Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
        const c = corners[0], sg = [s(q[0], q[1], c), s(q[1], q[2], c), s(q[2], q[0], c)];      // the box inside the triangle
        return sg.every(x => x >= 0) || sg.every(x => x <= 0);
      };
      // 3D: only what can be seen in the box (hidden triangles behind hills or the road stay out)
      if (drag.view.type === '3d') inside = hasTerrain() ? [...visibleTris(drag.view, x0, y0, x1, y1)] : [];
      else inside = hasTerrain() ? level.terrain.tris.map((t, id) => [t, id]).filter(([t]) => {
        const q = [at(t[0]), at(t[1]), at(t[2])];
        return q.every(Boolean) && touches(q);
      }).map(([, id]) => id) : [];
    } else {
      inside = S.editable.filter(e2 => {
        const [sx, sy, sz] = toScreen(drag.view, T(e2.pos[0], e2.pos[1] + 10, e2.pos[2]));
        return sz > -1 && sz < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      }).map(e2 => e2.id);
      // 3D: a terrain point counts when one of its triangles is visible in the box
      if (mode === 'terrain' && drag.view.type === '3d' && hasTerrain() && inside.length) {
        const vis = visibleTris(drag.view, x0, y0, x1, y1), seen = new Set();
        for (const id of vis) for (const i of level.terrain.tris[id].slice(0, 3)) seen.add(i);
        inside = inside.filter(i => seen.has(i) || level.terrain.points[i]?.lock);
      }
    }
    if (!drag.add && !drag.toggle) { sl.clear(); sel.edges.clear(); if (mode === 'track') sel.sections.clear(); }
    if (!click) for (const id of inside) { if (drag.toggle && sl.has(id)) sl.delete(id); else sl.add(id); }
    if (click && mode === 'terrain') status(S.pickTris ? 'No terrain triangle there: road, kerbs and the brown verge belong to the Track tab.'
                                                       : 'No terrain point there: the points are the small dots; those on the outer row of the road belong to the Track tab.');
    draw(); syncPanel();
  }
  const done = drag.adapt?.last;
  S.drag = null;
  if (done?.removed) status(`Terrain adapted: ${done.removed} triangles beside the changed road re-made (${done.added} new).`, 'ok');
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const [px, py] = local(e);
  const v = viewAt(px, py);
  if (!v) return;
  const f = Math.exp(e.deltaY * 0.0012);
  if (v.type === '3d') { v.dist = Math.max(30, Math.min(300000, v.dist * f)); return; }     // closer since 2026-10-11 (300 before)
  // zoom around the cursor
  const before = rayAt(v, px, py).ray.origin.clone();
  v.scale = Math.max(0.03, Math.min(400, v.scale * f));                                     // world units per pixel (0.3 before)
  updateCamera(v);
  const after = rayAt(v, px, py).ray.origin.clone();
  v.center.add(before.sub(after));
}, { passive: false });

canvas.addEventListener('dblclick', e => {
  const [px, py] = local(e);
  const v = viewAt(px, py);
  if (!v || !S.level || S.mode !== 'track' || (v.type !== 'top' && v.type !== '3d')) return;
  const edge = pickEdge(v, px, py, 25);
  if (!edge) return status('Double-click closer to the track to insert a point.', 'warn');
  change(() => {
    const id = insertInto(edge.key, edge.p);
    sel.nodes.clear(); sel.edges.clear();
    if (id) sel.nodes.add(id);
  });
});

// ---------------------------------------------------------------- keys
// WASD pans the view under the mouse while held, Q / E move it down / up (Shift faster). The speed follows the zoom,
// plus a floor of up to PAN_FLOOR world units a second, so a view zoomed in close still gets somewhere (2026-10-11, user:
// too slow); the floor is at most 4 times the zoomed speed, so the closest zoom stays controllable
const PAN_FLOOR = 800, panSpeed = zoomed => zoomed + Math.min(PAN_FLOOR, 4 * zoomed);
const panKeys = new Set();
const PAN_DIR = { KeyW: [0, 1, 0], KeyS: [0, -1, 0], KeyA: [-1, 0, 0], KeyD: [1, 0, 0], KeyQ: [0, 0, -1], KeyE: [0, 0, 1] };
addEventListener('keyup', e => { panKeys.delete(e.code); panKeys.fast = e.shiftKey; });
addEventListener('blur', () => panKeys.clear());
let lastPan = performance.now();
export function panStep() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastPan) / 1000);
  lastPan = now;
  if (!panKeys.size) return;
  let ax = 0, ay = 0, az = 0;
  for (const k of panKeys) { ax += PAN_DIR[k][0]; ay += PAN_DIR[k][1]; az += PAN_DIR[k][2]; }
  if (!ax && !ay && !az) return;
  const v = views[S.hotView], fast = panKeys.fast ? 3 : 1;
  if (v.type === '3d') {                          // along the ground, as seen from the camera; Q / E up and down
    const k = panSpeed(v.dist * 0.8) * fast * dt;
    const fwd = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw)), right = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    v.target.addScaledVector(right, ax * k).addScaledVector(fwd, ay * k);
    v.target.y += az * k;
  } else {
    const { right, up } = axes(v), k = panSpeed(700 * v.scale) * fast * dt;   // 700 px per second and the floor
    v.center.addScaledVector(right, ax * k).addScaledVector(up, ay * k);
    if (v.type !== 'top') v.center.y += az * k;
  }
}

addEventListener('keydown', e => {
  if (e.key === 'F1') { e.preventDefault(); setInspect(!S.inspectOn); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || !S.level) return;
  const { mode, tab, level } = S;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.code in PAN_DIR && !ctrl && !e.altKey) {
    e.preventDefault();
    panKeys.add(e.code); panKeys.fast = e.shiftKey;
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); return save(undefined, $('levelName')); }
  // Space switches what is picked: Track points / sections, Landscape points / triangles
  if (e.key === ' ' && !ctrl && !e.altKey) {
    if (tab === 'track') { e.preventDefault(); return setTrackPick(S.trackPick === 'sections' ? 'points' : 'sections'); }
    if (tab === 'landscape' && mode === 'terrain') { e.preventDefault(); return setPick(!S.pickTris); }
  }
  // tabs: 1-5, Tab / Shift+Tab cycles
  if (e.key === 'Tab' && !ctrl && !e.altKey) { e.preventDefault(); return setTab(TABS[(TABS.indexOf(tab) + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length]); }
  if (!ctrl && !e.altKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); return setTab(TABS[Number(e.key) - 1]); }
  if (e.key === 'Escape') { for (const s of Object.values(sel)) s.clear(); showRuler(null); draw(); syncPanel(); return; }
  if (!ctrl && !e.altKey && e.key.toLowerCase() === 'r') { $('ruler').checked = !rulerOn(); $('ruler').onchange(); return; }
  if (mode === 'paint' && !ctrl && !e.altKey && e.key.toLowerCase() === 'i') return choosePick();     // the pipette
  if (mode === 'asset' && e.key === 'F2') { e.preventDefault(); return renameSelectedBody(); }
  if (mode === 'terrain' && ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); return copyTerrain(); }
  if (mode === 'terrain' && ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); return pasteTerrain(); }
  if (e.key === 'Delete') { e.preventDefault(); return mode === 'terrain' ? (S.pickTris ? deleteTris() : deletePoints()) : mode === 'track' ? deleteSelected() : mode === 'assets' ? deleteObjects() : mode === 'asset' ? deleteBodies() : mode === 'anim' ? (deleteKey() || removeSelectedFromAnim()) : mode === 'sounds' ? deleteSources() : undefined; }
  if (e.key.toLowerCase() === 'f') {
    let ids = selected();
    if (mode === 'terrain' && sel.tris.size) ids = new Set([...sel.tris].flatMap(t => level.terrain.tris[t].slice(0, 3)));
    const pos = mode === 'terrain' ? tinfo()?.pos : null;
    const pts = mode === 'terrain' && pos ? [...ids].filter(i => pos[i]).map(i => T3(pos[i])) : [...positionsOf(ids).values()].map(p => T(...p));
    frame(views[S.hotView], pts.length ? pts : null);
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const page = { PageUp: 1, PageDown: -1 }[e.key];
  if (!(e.key in arrows) && !page) return;
  if (mode === 'view' || !selected().size) return;
  e.preventDefault();
  const v = views[S.hotView];
  const step = ctrl ? 100 : e.shiftKey ? 250 : 50;
  const start = positionsOf(selected()), moved = new Map();
  change(() => {
    for (const [id, p] of start) {
      const n = { x: p[0], y: p[1], z: p[2] };
      moved.set(id, n);
      if (page) { n.y = Math.round(n.y + page * (e.shiftKey ? 125 : 25)); continue; }
      const [ax, ay] = arrows[e.key];
      let w;
      if (v.type === '3d') {                          // along the ground, as seen from the camera
        const fwd = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw)), right = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
        w = right.multiplyScalar(ax * step).addScaledVector(fwd, ay * step);
      } else {
        const { right, up } = axes(v);
        w = right.clone().multiplyScalar(ax * step).addScaledVector(up, ay * step);
      }
      const snap = v => (ctrl ? Math.round(v / 100) * 100 : Math.round(v));
      n.x = snap(n.x + w.x); n.z = snap(n.z - w.z);
      if (Math.abs(w.y) > 0.5) n.y = Math.round(n.y + w.y);
    }
    setPositions(new Map([...moved].map(([id, n]) => [id, [n.x, n.y, n.z]])));
  });
});
