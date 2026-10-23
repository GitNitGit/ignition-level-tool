// Level editor, browser part (docs/EDITOR.md): the entry. The modules:
//   state.js    the shared state (S) and helpers      views.js      scene, renderer, the four views, cameras
//   draw.js     drawing the compiled level            info.js       report, selection summary, save state
//   edit.js     change / rebuild / undo               panels.js     tabs, modes, syncPanel
//   pick.js     what is under the cursor              input.js      mouse and keys
//   ruler.js    measuring                             inspect.js    the ? tooltip
//   tabs/track.js, tabs/landscape.js, tools/paint.js, tabs/file.js, tabs/deployment.js   the tabs' tools
import { $, S, api, status, T } from './state.js';
import { host, views, renderer, layout, toScreen, render, objectGroup } from './views.js';
import { rebuild } from './edit.js';
import { setMode, setTab } from './panels.js';
import { clickSection, visibleTris } from './pick.js';
import { setInspect, describeAt } from './inspect.js';
import { panStep } from './input.js';
import { load } from './tabs/file.js';
import { thumbnail, initLibrary, thumbStats, rethumb } from './tabs/assets.js';
import { startAssetEdit, finishAssetEdit, addBody } from './tabs/assetedit.js';
import { pickGizmo, centre as gizmoCentre, handleAt } from './gizmo.js';
import { setReference, refMesh } from './reference.js';
import { animTick, setTime } from './tabs/anim.js';
import { startTextureWatch, textureNames } from './textures.js';
import './tabs/deployment.js';

// ---------------------------------------------------------------- errors
// an error in an event handler must not leave the mouse in a half-finished drag; it is shown in the status line
const showError = msg => { S.drag = null; S.rebuildPending = false; $('box').hidden = true; status('Editor error: ' + msg + ' (F12 shows details)', 'err'); };
addEventListener('error', e => showError(e.message));
addEventListener('unhandledrejection', e => showError(String(e.reason && e.reason.message || e.reason)));

// ---------------------------------------------------------------- start
layout();
let names = await api('levels');
if (!names.length) {
  await api('levels', { method: 'POST', body: JSON.stringify({ name: 'demo' }) });
  names = ['demo'];
}
for (const n of names) $('level').add(new Option(n, n));
const wanted = new URLSearchParams(location.search).get('level');
if (wanted && names.includes(wanted)) $('level').value = wanted;
await load($('level').value);

renderer.setAnimationLoop(() => {
  panStep();
  animTick();
  if (S.rebuildPending && (!S.drag || performance.now() - (S.drag.lastBuild || 0) > 30)) {
    S.rebuildPending = false;
    if (S.drag) S.drag.lastBuild = performance.now();
    rebuild();
  }
  render();
});
initLibrary();                            // the asset library with its previews (rendered after the first frames)
startTextureWatch();                      // the user's own textures (data/textures), polled for changes

// for tests and the browser console
window.editor = { get level() { return S.level; }, get compiled() { return S.compiled; }, get mode() { return S.mode; }, get tab() { return S.tab; },
  get editable() { return S.editable; }, setMode, setTab, setInspect, sel: S.sel, views, clickSection, thumbnail, thumbStats, rethumb, assetCache: S.assetCache, renderer, objectGroup, startAssetEdit, finishAssetEdit, addBody, get assetEdit() { return S.assetEdit; }, gizmoCentre,
  pickGizmo: (vi, x, y) => { const r = host.getBoundingClientRect(); return pickGizmo(views[vi], x - r.left, y - r.top); },
  handleAt: (vi, kind, axis) => { const r = host.getBoundingClientRect(), p = handleAt(views[vi], kind, axis); return p && [p[0] + r.left, p[1] + r.top]; },
  get drag() { return S.drag && { kind: S.drag.kind, moved: S.drag.moved }; }, textureNames, setReference, refMesh, get anim() { return S.anim; }, animPose: S.animPose, setTime,
  describeAt: (vi, x, y) => { const r = host.getBoundingClientRect(); return describeAt(views[vi], x - r.left, y - r.top); },
  visibleTris: (vi, x0, y0, x1, y1) => { const r = host.getBoundingClientRect(); return [...visibleTris(views[vi], x0 - r.left, y0 - r.top, x1 - r.left, y1 - r.top)]; },
  screenOf: (vi, xz, y) => { const r = host.getBoundingClientRect(), [x, yy] = toScreen(views[vi], T(xz[0], y, xz[1])); return [x + r.left, yy + r.top]; },
  nodeScreen: (vi, id) => {
    const e = S.editable.find(q => q.id === id), r = host.getBoundingClientRect();
    const [x, y] = toScreen(views[vi], T(e.pos[0], e.pos[1] + 10, e.pos[2]));
    return [x + r.left, y + r.top];
  } };
