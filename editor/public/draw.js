// Drawing the compiled level: faces with their colours and the baked light, track decorations, selection, holes,
// control points, terrain points, problem spots. Rebuilt whole on every change (edit.js).
import * as THREE from './vendor/three.module.js';
import { edgeKey, nodeRole, nodeMap } from '/core/model.js';
import { MATERIALS } from '/core/materials.js';
import { lightFaces, faceColour } from '/core/lighting.js';
import { rgb } from '/core/palette.js';
import { placedFaces } from '/core/objects.js';
import { bodyPolygons } from '/core/csg.js';
import { frameOf } from '/core/texmap.js';
import { parsePaint, paintUV, roadFrame } from '/core/paint.js';
import { $, S, sel, T, T3, colourOf, tinfo, assetOf, editedAsset, secMap, collectEditable, animEntry, poseOf } from './state.js';
import { poseAt } from '/core/anim.js';
import { sourcePosition } from '/core/sounds.js';
import { rotationOf } from '/core/objects.js';
import { trackGroup, objectGroup, assetGroup, overlay, solid, glass, onTop, grid } from './views.js';
import { updateGizmo } from './gizmo.js';
import { atlasTexture, tileSlot, tileUV, whenTilesLoad } from './tiles.js';
import { textureOf, textureMeta, whenTexturesChange } from './textures.js';
import { syncReference } from './reference.js';

const POINT = { main: 0x3d8bff, branch: 0x2ee6d6, start: 0x22cc44, selected: 0xff2020 };
// textured object faces: the tile atlas times the vertex colour (the baked light as grey); transparent texels cut out
const texMat = new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
// the user's own textures (own assets): one material per image, repeating
const ownMats = new Map();
const ownMat = name => {
  const tex = textureOf(name);
  if (!tex) return null;
  if (!ownMats.has(name)) ownMats.set(name, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }));
  return ownMats.get(name);
};
// a mesh that is not drawn but can be hit by a ray (the preview of the asset being built is picked by faces)
const pickOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
whenTilesLoad(() => { if (S.level && S.compiled) draw(); });
whenTexturesChange(() => { if (S.level && S.compiled) draw(); });

export function draw() {
  const { level, compiled, mode } = S;
  for (const g of [trackGroup, objectGroup, assetGroup, overlay]) {
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    g.clear();
  }
  const paths = compiled.paths;
  if (!paths) return;
  if (mode === 'track') collectEditable();           // the tangent handles follow the selection
  const edgePt = (f, s, dy = 0) => T(f.c[0] + f.left[0] * s * f.half, f.c[1] + dy, f.c[2] + f.left[1] * s * f.half);
  const buf = () => ({ pos: [], col: [], uv: null });
  const push = (b, pts, c) => {                       // c in sRGB, vertex colours are linear
    const l = new THREE.Color().setRGB(...c, THREE.SRGBColorSpace);
    for (const p of pts) { b.pos.push(p.x, p.y, p.z); b.col.push(l.r, l.g, l.b); }
  };
  const mesh = (b, mat, order = 0) => {
    if (!b.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    if (b.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order;
    return m;
  };
  // the faces as the game shows them: painted colour (or the material's) with the baked light, one colour per face
  // (core/lighting.js, core/paint.js); faceList is also what paint and pick work on
  const dim = mode === 'track' ? 0.85 : 1;
  const textured = $('colTextured').checked;       // view bar: painted colours (as the game shows them) or the material's
  const ground = buf(), lines = [], painted = new Map();      // painted: image name -> buffer of the faces painted with it
  let minY = Infinity;
  const info = tinfo();
  const faceList = S.faceList = compiled.base.tris.map(t => ({ kind: 'base', t, p: t.p, mat: t.mat, facing: t.facing }));
  if (info) level.terrain.tris.forEach(([a, b, c, m], id) => {
    if (info.pos[a] && info.pos[b] && info.pos[c]) faceList.push({ kind: 'terrain', id, p: [info.pos[a], info.pos[b], info.pos[c]], mat: m });
  });
  const roadPts = compiled.base.tris.filter(t => t.zone === 'road').flatMap(t => t.p);
  const light = lightFaces(faceList, roadPts, { smooth: false });
  faceList.forEach((f, i) => {
    const P = f.p.map(T3);
    if (f.kind === 'terrain') for (const p of P) p.y -= 1;
    const paint = textured ? parsePaint(colourOf(f)) : null, meta = paint?.tex ? textureMeta(paint.tex) : null;
    if (paint?.tex && meta && ownMat(paint.tex)) {
      if (!painted.has(paint.tex)) { const b = buf(); b.uv = []; painted.set(paint.tex, b); }
      const b = painted.get(paint.tex);
      push(b, P, faceColour([255, 255, 255], light[i], f.p).map(v => v / 255 * (f.kind === 'terrain' ? dim : 1)));
      for (const [u, v] of paintUV(f.p, paint, meta, f.kind === 'base' ? roadFrame(secMap(), f.t.sec) : null)) b.uv.push(u / meta.w, 1 - v / meta.h);
    } else {
      const c = faceColour(paint ? rgb(paint.colour || meta?.mean || '#808080') : MATERIALS[f.mat].color, light[i], f.p).map(v => v / 255 * (f.kind === 'terrain' ? dim : 1));
      push(ground, P, c);
    }
    for (const p of P) minY = Math.min(minY, p.y);
    // the edges: of the landscape in the Landscape tab, of every face (road, kerbs, verge, landscape) in the Paint tab
    if (!(mode === 'paint' || (mode === 'terrain' && f.kind === 'terrain'))) return;
    for (let j = 0; j < 3; j++) {
      const q0 = P[j], q1 = P[(j + 1) % 3];
      lines.push(q0.x, q0.y + 3, q0.z, q1.x, q1.y + 3, q1.z);
    }
  });
  const gm = mesh(ground, solid);
  if (gm) trackGroup.add(gm);
  for (const [name, b] of painted) { const m = mesh(b, ownMat(name)); if (m) trackGroup.add(m); }
  if (lines.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    trackGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x0c160c, transparent: true, opacity: 0.55 })));
  }
  grid.position.y = Number.isFinite(minY) ? minY - 40 : 0;

  // placed objects (Assets tab): the asset's faces at every placement, their own colours with the baked light
  const objects = level.objects || [], editing = editedAsset(), editAt = S.assetEdit?.at;
  // an instance of the asset being built that stands where the preview stands is left out (it would fight with it)
  // in the Animation tab the objects of the animation shown are own groups at their pose of t = 0, moved to the
  // playhead's pose by applyAnimPoses (cheap while scrubbing and playing)
  const animated = mode === 'anim' ? new Map(objects.map((o, i) => [i, animEntry(i)]).filter(([, e]) => e)) : new Map();
  const placed = placedFaces(level, assetOf).filter(x => !(editing && x.o.asset === S.assetEdit.ref && x.o.x === editAt[0] && x.o.y === editAt[1] && x.o.z === editAt[2]) && !animated.has(x.index));
  const ofaces = placed.flatMap(x => x.faces);
  // faces of objects: flat colours with the light; textured ones ("Textured" on) the tile of an original through the
  // tile atlas, or one of the user's own images (repeating), with the light as grey
  const drawFaces = (list, group, order = 0) => {
    const ob = buf(), tb = buf(), own = new Map(), ol = lightFaces(list, roadPts, { smooth: false });
    tb.uv = [];
    list.forEach((f, i) => {
      const grey = () => faceColour([255, 255, 255], ol[i], f.p).map(v => v / 255);
      if (textured && f.tile && f.uv && f.tile.startsWith('png:')) {
        const name = f.tile.slice(4), meta = textureMeta(name);
        if (ownMat(name) && meta) {
          if (!own.has(name)) { const b = buf(); b.uv = []; own.set(name, b); }
          const b = own.get(name);
          push(b, f.p.map(T3), grey());
          for (const [u, v] of f.uv) b.uv.push(u / meta.w, 1 - v / meta.h);
          return;
        }
      } else if (textured && f.tile && f.uv) {
        const s = tileSlot(f.tile);
        if (s !== null) { push(tb, f.p.map(T3), grey()); for (const q of f.uv) tb.uv.push(...tileUV(s, q)); return; }
      }
      push(ob, f.p.map(T3), faceColour(rgb(f.colour), ol[i], f.p).map(v => v / 255));
    });
    for (const [b, mat] of [[ob, solid], [tb, texMat], ...[...own].map(([name, b]) => [b, ownMat(name)])]) { const m = mesh(b, mat, order); if (m) group.add(m); }
  };
  for (const [i, e] of animated) {
    const o = objects[i], base = poseAt(e, 0), g = new THREE.Group();
    const [x] = placedFaces({ ...level, objects: [{ ...o, x: base.pos[0], y: base.pos[1], z: base.pos[2], rot: base.rot }] }, assetOf);
    if (!x.faces.length) continue;
    drawFaces(x.faces, g);
    const pb = buf();
    for (const f of x.faces) push(pb, f.p.map(T3), [0, 0, 0]);
    const pm = mesh(pb, pickOnly, 1);
    pm.userData.objOf = x.faces.map(() => i);
    g.add(pm);
    // the object's marker rides in the group (at the pose of t = 0 it lands on the pose at the playhead)
    const mg = new THREE.BufferGeometry().setFromPoints([T(base.pos[0], base.pos[1] + 5, base.pos[2])]), on = sel.objects.has(i);
    [[on ? 18 : 14, on ? 0xffffff : 0x0b0e14], [on ? 13 : 10, on ? POINT.selected : 0xe8d8a0]].forEach(([size, color], k) => {
      const m = new THREE.Points(mg, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false }));
      m.renderOrder = 10 + k + (on ? 4 : 0);
      g.add(m);
    });
    g.userData.animIndex = i; g.userData.base = base; g.matrixAutoUpdate = false;
    objectGroup.add(g);
  }
  applyAnimPoses();
  if (ofaces.length) {
    drawFaces(ofaces, objectGroup);
    // the pick mesh: one triangle per face in order, which object each belongs to (clicks and drags on objects)
    const pb = buf();
    for (const f of ofaces) push(pb, f.p.map(T3), [0, 0, 0]);
    const pm = mesh(pb, pickOnly, 1);
    pm.userData.objOf = placed.flatMap(x => x.faces.map(() => objects.indexOf(x.o)));
    objectGroup.add(pm);
  }

  // track decorations: jump gaps, chevrons, selected segments and sections
  const trans = buf(), over = buf(), marks = buf();
  const edgeSel = new Set(sel.edges);
  for (const s of compiled.sections) {
    const q = [edgePt(s.f0, -1, 6), edgePt(s.f0, 1, 6), edgePt(s.f1, 1, 6), edgePt(s.f1, -1, 6)];
    const quadPts = [q[0], q[1], q[2], q[0], q[2], q[3]];
    if (s.jump) push(trans, quadPts, [0.78, 0.38, 1]);
    if (edgeSel.has(edgeKey(...s.path.edge(s.f0.seg)))) push(over, quadPts, [0.9, 0.1, 0.1]);
    if (mode === 'track' && sel.sections.has(s.id)) push(over, quadPts.map(p => new THREE.Vector3(p.x, p.y + 4, p.z)), [0.95, 0.2, 0.2]);
    if (s.j % 3 === 1 && !s.jump && mode !== 'paint') {
      const m = k => edgePt(s.f0, k * 0.5, 9), tip = T((s.f0.c[0] + s.f1.c[0]) / 2, (s.f0.c[1] + s.f1.c[1]) / 2 + 9, (s.f0.c[2] + s.f1.c[2]) / 2);
      push(marks, [m(-1), tip, m(1)], [1, 1, 1]);
    }
  }
  for (const [b, mat, order] of [[trans, glass, 3], [over, glass, 4], [marks, solid, 5]]) { const m = mesh(b, mat, order); if (m) overlay.add(m); }
  // faint centre line for the side views
  const centreMat = new THREE.LineBasicMaterial({ color: 0x8a94a6, transparent: true, opacity: 0.5 });
  for (const p of paths.all)
    overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.line.map(s => T(s.p[0], s.p[1] + 6, s.p[2]))), centreMat));
  // start/finish line (red) at the start of the main loop
  const f0 = paths.main.frames[0];
  const sg = new THREE.BufferGeometry().setFromPoints([edgePt(f0, -1.4, 8), edgePt(f0, 1.4, 8)]);
  overlay.add(new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xff3030, depthTest: false })));

  // terrain mode: selected triangles, holes, floating pieces
  if (mode === 'terrain' && info) {
    const tt = level.terrain.tris, selb = buf();
    for (const id of sel.tris) {
      const [a, b, c] = tt[id] || [];
      if (!info.pos[a] || !info.pos[b] || !info.pos[c]) continue;
      push(selb, [a, b, c].map(i => T3(info.pos[i])), [0.95, 0.15, 0.15]);
    }
    const sm = mesh(selb, onTop, 6);                 // drawn in front of the face itself (also on steep faces)
    if (sm) overlay.add(sm);
    const hl = [], hp = [];
    for (const [pa, pb] of info.holes) {                         // open edges: thin red lines with small end points (screen size, whatever the zoom)
      const a = T3(pa), b = T3(pb);
      hl.push(a.x, a.y + 4, a.z, b.x, b.y + 4, b.z);
      hp.push(new THREE.Vector3(a.x, a.y + 4, a.z), new THREE.Vector3(b.x, b.y + 4, b.z));
    }
    if (hl.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(hl, 3));
      const hm = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xff2020, depthTest: false }));
      hm.renderOrder = 11;
      const m = new THREE.Points(new THREE.BufferGeometry().setFromPoints(hp),
        new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, color: 0xff2020, depthTest: false }));
      m.renderOrder = 12;
      overlay.add(hm, m);
    }
    // landscape that nothing docked holds: separate objects, tinted
    const fl = buf();
    for (const c of info.comps) {
      if (c.docked) continue;
      for (const id of c.tris) {
        const [a, b, c2] = tt[id];
        push(fl, [a, b, c2].map(i => { const p = T3(info.pos[i]); p.y += 3; return p; }), [0.95, 0.7, 0.2]);
      }
    }
    const fm = mesh(fl, glass, 6);
    if (fm) overlay.add(fm);
  }

  // control points (mode 1)
  const start = level.track.start?.node;
  const groups = { main: [], branch: [], start: [], selected: [] };
  for (const n of mode === 'track' ? level.track.nodes : []) {
    const g = sel.nodes.has(n.id) ? 'selected' : n.id === start ? 'start' : nodeRole(level.track, n.id).main < 0 ? 'branch' : 'main';
    groups[g].push(T(n.x, (n.y ?? 0) + 10, n.z));
  }
  // squares with a dark outline; selected ones larger with a white outline
  for (const [g, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const big = g === 'selected' || g === 'start';
    const geo = new THREE.BufferGeometry().setFromPoints(list);
    const layers = [[big ? 18 : 14, g === 'selected' ? 0xffffff : 0x0b0e14], [big ? 13 : 10, POINT[g]]];
    layers.forEach(([size, color], k) => {
      const m = new THREE.Points(geo, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false }));
      m.renderOrder = 10 + k + (g === 'selected' ? 4 : g === 'start' ? 2 : 0);
      overlay.add(m);
    });
  }
  // tangent handles of the selected knots (linked / separated): a line from the knot, an orange square
  if (mode === 'track') {
    const hs = S.editable.filter(e => e.handle);
    if (hs.length) {
      const nodes = nodeMap(level.track), lpts = [], hp = [];
      for (const h of hs) { const n = nodes.get(h.id.split('#')[0]); lpts.push(T(n.x, (n.y ?? 0) + 10, n.z), T(h.pos[0], h.pos[1] + 10, h.pos[2])); hp.push(T(h.pos[0], h.pos[1] + 10, h.pos[2])); }
      const lm = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lpts), new THREE.LineBasicMaterial({ color: 0xffa040, depthTest: false }));
      lm.renderOrder = 11; overlay.add(lm);
      const pg = new THREE.BufferGeometry().setFromPoints(hp);
      [[14, 0x0b0e14], [10, 0xffa040]].forEach(([size, color], k) => { const m = new THREE.Points(pg, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false })); m.renderOrder = 15 + k; overlay.add(m); });
    }
  }
  // terrain points (mode 2): small light squares, free ones yellow, the track's outer row (pick only) blue, selected
  // red, the point clicked last (aligning to it, rotating about it) with a yellow ring
  if (mode === 'terrain') {
    const tg = { track: [], plain: [], free: [], selected: [], anchor: [] };
    for (const e of S.editable) {
      const p = T(e.pos[0], e.pos[1] + 5, e.pos[2]);
      tg[sel.points.has(e.id) ? 'selected' : e.lock ? 'track' : e.free ? 'free' : 'plain'].push(p);
      if (e.id === S.anchor && sel.points.has(e.id)) tg.anchor.push(p);
    }
    // [outline size, outline colour, size, colour]; plain points are small dots without outline
    const style = { track: [0, 0, 5, 0x6f9cff], plain: [0, 0, 4, 0xd8ecc4], free: [9, 0x0b0e14, 6, 0xffc94a],
                    selected: [15, 0xffffff, 11, POINT.selected], anchor: [21, 0xffcc33, 0, 0] };
    for (const [g, list] of Object.entries(tg)) {
      if (!list.length) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(list);
      const [s0, c0, s1, c1] = style[g];
      [[s0, c0], [s1, c1]].filter(([size]) => size).forEach(([size, color], k) => {
        const m = new THREE.Points(geo, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false }));
        m.renderOrder = 10 + k + (g === 'selected' ? 4 : 0);
        overlay.add(m);
      });
    }
  }
  // the custom asset being built (asset editor): its mesh at `at` (picked by faces), the selected bodies' outlines,
  // a marker at every body's centre (selected ones red)
  if (editing) {
    const pf = editing.faces.map(f => ({ p: [f[0], f[1], f[2]].map(i => editing.verts[i].map((v, k) => v + editAt[k])), colour: f[3], tile: f[6], uv: f[7] }));
    if (pf.length) {
      drawFaces(pf, assetGroup, 2);
      const pb = buf();                                  // the pick mesh: one triangle per face, in the faces' order
      for (const f of pf) push(pb, f.p.map(T3), [0, 0, 0]);
      const pm = mesh(pb, pickOnly, 1);
      pm.userData.preview = true;
      assetGroup.add(pm);
    }
    // the texture frame of the selected body while the texture is placed: the image on a translucent quad, its outline
    for (const i of S.assetEdit?.frame ? sel.bodies : []) {
      const t = editing.bodies[i]?.texture, f = t && frameOf(editing.bodies[i]);
      if (!f) continue;
      const q = f.quad.map(p => T3(p.map((v, k) => v + editAt[k])));
      const fb = buf(); fb.uv = [];
      push(fb, [q[0], q[1], q[2], q[0], q[2], q[3]], [1, 1, 1]);
      fb.uv.push(0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0);
      const base = ownMat(t.name);
      const fm = mesh(fb, base ? new THREE.MeshBasicMaterial({ map: base.map, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthTest: false }) : glass, 9);
      if (fm) assetGroup.add(fm);
      const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(q), new THREE.LineBasicMaterial({ color: 0xffcc33, depthTest: false }));
      ol.renderOrder = 9;
      assetGroup.add(ol);
    }
    const lines = [];
    for (const i of sel.bodies) {
      if (!editing.bodies[i]) continue;
      for (const poly of bodyPolygons(editing.bodies[i], i)) {
        const vs = poly.vertices.map(v => T3(v.map((x, k) => x + editAt[k])));
        for (let k = 0; k < vs.length; k++) { const a = vs[k], b = vs[(k + 1) % vs.length]; lines.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      }
    }
    if (lines.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      const lm = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xff3030, depthTest: false }));
      lm.renderOrder = 8;
      assetGroup.add(lm);
    }
    const og = new THREE.BufferGeometry().setFromPoints([T(...editAt)]);
    for (const [size, color, k] of [[S.assetEdit.origin ? 20 : 14, 0x0b0e14, 0], [S.assetEdit.origin ? 15 : 9, 0xffcc33, 1]]) {
      const m = new THREE.Points(og, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false }));
      m.renderOrder = 12 + k;
      overlay.add(m);
    }
    const bg = { plain: [], selected: [] };
    editing.bodies.forEach((b, i) => bg[sel.bodies.has(i) ? 'selected' : 'plain'].push(T(...b.pos.map((v, k) => v + editAt[k]))));
    const style = { plain: [14, 0x0b0e14, 10, 0xe8d8a0], selected: [18, 0xffffff, 13, POINT.selected] };
    for (const [g, list] of Object.entries(bg)) {
      if (!list.length) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(list);
      const [s0, c0, s1, c1] = style[g];
      [[s0, c0], [s1, c1]].forEach(([size, color], k) => {
        const m = new THREE.Points(geo, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false }));
        m.renderOrder = 10 + k + (g === 'selected' ? 4 : 0);
        overlay.add(m);
      });
    }
  }
  // placed objects (Assets / Animation tab): a marker at every placement point (the pose at the playhead), selected ones red
  if ((mode === 'assets' || mode === 'anim') && objects.length) {
    const og = { plain: [], selected: [] };
    objects.forEach((o, i) => { if (animated.has(i)) return; og[sel.objects.has(i) ? 'selected' : 'plain'].push(T(o.x, o.y + 5, o.z)); });   // animated ones ride in their groups
    const style = { plain: [14, 0x0b0e14, 10, 0xe8d8a0], selected: [18, 0xffffff, 13, POINT.selected] };
    for (const [g, list] of Object.entries(og)) {
      if (!list.length) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(list);
      const [s0, c0, s1, c1] = style[g];
      [[s0, c0], [s1, c1]].forEach(([size, color], k) => {
        const m = new THREE.Points(geo, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false }));
        m.renderOrder = 10 + k + (g === 'selected' ? 4 : 0);
        overlay.add(m);
      });
    }
  }
  // sound sources (Sounds tab): a yellow marker where each plays, selected ones red
  if (mode === 'sounds' && level.soundSources?.length) {
    const sg = { plain: [], selected: [] };
    level.soundSources.forEach((q, i) => { const p = sourcePosition(level, q); sg[sel.sources.has(i) ? 'selected' : 'plain'].push(T(p[0], p[1] + 5, p[2])); });
    const style = { plain: [16, 0x0b0e14, 12, 0xffd34f], selected: [20, 0xffffff, 15, POINT.selected] };
    for (const [g, list] of Object.entries(sg)) {
      if (!list.length) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(list);
      const [s0, c0, s1, c1] = style[g];
      [[s0, c0], [s1, c1]].forEach(([size, color], k) => {
        const m = new THREE.Points(geo, new THREE.PointsMaterial({ size, color, sizeAttenuation: false, depthTest: false }));
        m.renderOrder = 10 + k + (g === 'selected' ? 4 : 0);
        overlay.add(m);
      });
    }
  }
  // problem spots
  const at = [...compiled.report.errors, ...compiled.report.warnings].filter(e => Array.isArray(e.at)).map(e => T(...e.at));
  if (at.length) {
    const g = new THREE.BufferGeometry().setFromPoints(at);
    const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, color: 0xff3030,
                                                              transparent: true, opacity: 0.7, depthTest: false }));
    m.renderOrder = 9;
    overlay.add(m);
  }
  solid.wireframe = glass.wireframe = $('drawWire').checked;
  updateGizmo();
  syncReference();
}
// the groups of the animated objects (draw) moved to their pose at the playhead: a rotation about the pose of t = 0
// (which is baked into the geometry) and the translation
export function applyAnimPoses() {
  for (const g of objectGroup.children) {
    if (g.userData.animIndex === undefined) continue;
    const i = g.userData.animIndex, base = g.userData.base, p = poseOf(i) || base;
    const R0 = rotationOf(base.rot), R = rotationOf(p.rot), P = R.map((r, a) => [0, 1, 2].map(b => r[0] * R0[b][0] + r[1] * R0[b][1] + r[2] * R0[b][2]));   // R * R0^T
    const m = new THREE.Matrix4().set(P[0][0], P[0][1], -P[0][2], 0, P[1][0], P[1][1], -P[1][2], 0, -P[2][0], -P[2][1], P[2][2], 0, 0, 0, 0, 1);   // game -> three: z mirrored
    const pivot = T(...base.pos), to = T(...p.pos);
    g.matrix.makeTranslation(to.x, to.y, to.z).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    g.updateMatrixWorld(true);
  }
  updateGizmo();
}
// view bar: how and in what colours the faces are drawn
$('drawWire').onchange = $('drawSolid').onchange = $('colSurface').onchange = $('colTextured').onchange = () => draw();
