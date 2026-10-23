// The header tabs and the modes: a tab decides what the tools area shows and what clicks in the views do.
// Track = mode 'track', Landscape = mode 'terrain', Paint = mode 'paint', Assets = mode 'assets', the other
// tabs = mode 'view' (looking around only). syncPanel brings every panel up to date with the level and the selection.
import { $, S, sel, TABS, TAB_OF_MODE, collectEditable } from './state.js';
import { layout } from './views.js';
import { draw } from './draw.js';
import { showSelection } from './info.js';
import { syncTrackPanel } from './tabs/track.js';
import { syncTerrainPanel, syncViewTools } from './tabs/landscape.js';
import { syncPaintPanel } from './tools/paint.js';
import { syncAssetsPanel } from './tabs/assets.js';
import { syncAssetEditPanel, finishAssetEdit } from './tabs/assetedit.js';
import { syncAnimPanel, showTimeline, setPlaying } from './tabs/anim.js';
import { syncSoundsPanel } from './tabs/sounds.js';

export function syncPanel() {
  const { mode, tab } = S;
  document.querySelectorAll('section[data-tab]').forEach(el => { el.hidden = el.dataset.tab !== tab; });
  document.querySelectorAll('section[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== mode; });
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  if (mode === 'terrain') { $('pickPoints').checked = !S.pickTris; $('pickTris').checked = S.pickTris; }
  showSelection();
  syncViewTools();
  if (mode === 'terrain') return syncTerrainPanel();
  if (mode === 'paint') return syncPaintPanel();
  $('assetLib').hidden = mode === 'asset'; $('assetEdit').hidden = mode !== 'asset';
  if (mode === 'assets') return syncAssetsPanel();
  if (mode === 'asset') return syncAssetEditPanel();
  if (mode === 'anim') return syncAnimPanel();
  if (mode === 'sounds') return syncSoundsPanel();
  if (mode === 'track') syncTrackPanel();
}

export function setMode(m) {
  S.mode = m;
  S.tab = TAB_OF_MODE[m] || S.tab;
  // the Assets tab shows its library as a grid: the tools area is three times as wide there; the asset editor is a
  // compact properties panel
  const wide = document.body.classList.contains('wideTools'), edit = document.body.classList.contains('editTools');
  document.body.classList.toggle('wideTools', m === 'assets'); document.body.classList.toggle('editTools', m === 'asset');
  if (wide !== (m === 'assets') || edit !== (m === 'asset')) layout();
  sel.edges.clear();
  collectEditable();
  draw(); syncPanel();
}
export function setTab(t) {
  if (!TABS.includes(t)) return;
  if (S.assetEdit && t !== 'assets') finishAssetEdit(true);      // leaving the Assets tab keeps the asset being built
  if (S.assetEdit && t === 'assets') { S.tab = t; return setMode('asset'); }
  S.tab = t;
  if (t !== 'anim') { setPlaying(false); S.animPose.clear(); }
  showTimeline(t === 'anim');
  setMode(t === 'track' ? 'track' : t === 'landscape' ? 'terrain' : t === 'paint' ? 'paint' : t === 'assets' ? 'assets' : t === 'anim' ? 'anim' : t === 'sounds' ? 'sounds' : 'view');
}
document.querySelectorAll('.tab').forEach(el => { el.onclick = () => { if (!el.disabled) setTab(el.dataset.tab); el.blur(); }; });
