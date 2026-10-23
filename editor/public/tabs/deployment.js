// The Deployment tab: compile (write the game files and the zip), install into the game, the viewer, the links.
import { $, S, api, status } from '../state.js';
import { save } from './file.js';

$('compile').onclick = async () => {
  const at = $('compile');
  try {
    await save(undefined, at);
    status('compiling …', 'busy', at);
    const r = await api(`levels/${S.levelName}/compile`, { method: 'POST' });
    if (!r.written) return status('not written: the checks report errors', 'err', at);
    $('install').disabled = false;
    $('zipLink').href = `/api/levels/${S.levelName}/zip`; $('zipLink').hidden = false;
    status('written: ' + r.output, 'ok', at);
  } catch (err) { status(err.message, 'err', at); }
};
$('install').onclick = () => { $('confirm').hidden = false; };
$('installNo').onclick = () => { $('confirm').hidden = true; };
$('installYes').onclick = async () => {
  $('confirm').hidden = true;
  const at = $('install');
  status('installing …', 'busy', at);
  try {
    const r = await api(`levels/${S.levelName}/install`, { method: 'POST' });
    status(`installed: ${r.installed}`, 'ok', at);
  } catch (err) { status(err.message, 'err', at); }
};

// the level as it is in the editor goes to the server (nothing is saved); the viewer makes its game files on request
$('showViewer').onclick = async () => {
  const at = $('showViewer');
  const win = window.open('', 'ignition-viewer');            // opened at the click, else the browser blocks the pop-up
  try {
    const r = await api(`levels/${S.levelName}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.level) });
    if (win) win.location.href = r.viewer; else window.open(r.viewer, 'ignition-viewer');
    status('opened in the viewer', 'ok', at);
  } catch (err) { win?.close(); status(err.message, 'err', at); }
};

api('setup').then(r => { $('gameDirInfo').textContent = r.gameDir || '(not set)'; $('gameDirInfo').title = r.source === 'steam' ? 'found in the Steam library' : ''; }).catch(() => {});
