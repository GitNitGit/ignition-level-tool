// Finding the game directory of Ignition (Node, Windows): the setting in
// data/config.json, else a Steam installation (Steam path from the registry of
// the current user, its libraries from libraryfolders.vdf), else the user picks
// it (setup page, folder dialog). Valid: a directory with LEVELS (holding at
// least one level) and sys.col. The user may pick a parent of it (Steam keeps
// the game in ...\common\Ignition\ignition): it is looked for two levels down.
import { promises as fs, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';

const run = (cmd, args, opts = {}) => new Promise(ok => {
  execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 10000, maxBuffer: 1 << 20 }, (err, stdout) => ok(err ? '' : String(stdout)));
});

async function entries(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

// Is dir the game directory itself?
export async function isGameDir(dir) {
  if (!dir || !existsSync(dir)) return false;
  const list = await entries(dir);
  if (!list.some(d => d.isFile() && d.name.toLowerCase() === 'sys.col')) return false;
  const levels = list.find(d => d.isDirectory() && d.name.toLowerCase() === 'levels');
  if (!levels) return false;
  for (const d of await entries(join(dir, levels.name))) {
    if (!d.isDirectory()) continue;
    if ((await entries(join(dir, levels.name, d.name))).some(f => f.name.toLowerCase().endsWith('.msh'))) return true;
  }
  return false;
}

// The game directory at dir or up to `depth` levels below it (null if none).
export async function findGameDirIn(dir, depth = 2) {
  if (await isGameDir(dir)) return dir;
  if (depth <= 0) return null;
  for (const d of await entries(dir)) {
    if (!d.isDirectory()) continue;
    const hit = await findGameDirIn(join(dir, d.name), depth - 1);
    if (hit) return hit;
  }
  return null;
}

// Steam's library folders (Windows): Steam path from the registry, the
// libraries from steamapps/libraryfolders.vdf
export async function steamLibraries() {
  if (process.platform !== 'win32') return [];
  const roots = new Set();
  for (const [key, value] of [['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
                              ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
                              ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']]) {
    const out = await run('reg', ['query', key, '/v', value]);
    const m = new RegExp(`${value}\\s+REG_SZ\\s+(.+)`, 'i').exec(out);
    if (m) roots.add(m[1].trim().replace(/\//g, '\\'));
  }
  const libs = new Map();                                    // lower case -> path (Windows paths ignore case)
  const addLib = p => { if (!libs.has(p.toLowerCase())) libs.set(p.toLowerCase(), p); };
  for (const root of roots) {
    addLib(root);
    for (const vdf of [join(root, 'steamapps', 'libraryfolders.vdf'), join(root, 'config', 'libraryfolders.vdf')]) {
      let text = '';
      try { text = await fs.readFile(vdf, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/gi)) addLib(m[1].replace(/\\\\/g, '\\'));
    }
  }
  return [...libs.values()];
}

// Ignition in the Steam libraries: steamapps/common/<folder named like Ignition>
export async function findSteamGame() {
  for (const lib of await steamLibraries()) {
    const common = join(lib, 'steamapps', 'common');
    for (const d of await entries(common)) {
      if (!d.isDirectory() || !/ignition/i.test(d.name)) continue;
      const hit = await findGameDirIn(join(common, d.name), 2);
      if (hit) return hit;
    }
  }
  return null;
}

// The game directory: the configured one if valid, else Steam. {dir, source} or {dir: null}
export async function resolveGameDir(configured) {
  if (configured && await isGameDir(configured)) return { dir: configured, source: 'config' };
  const steam = await findSteamGame();
  if (steam) return { dir: steam, source: 'steam' };
  return { dir: null, source: null };
}

// The Windows folder dialog (in front of the browser); resolves to the chosen path or ''.
export function browseFolder(start = '') {
  if (process.platform !== 'win32') return Promise.resolve('');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false}',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Ignition game directory (the folder with LEVELS and sys.col, or one above it)'",
    '$d.ShowNewFolderButton = $false',
    start && existsSync(start) ? `$d.SelectedPath = '${start.replace(/'/g, "''")}'` : '',
    "if ($d.ShowDialog($f) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
  ].filter(Boolean).join('; ');
  return run('powershell', ['-NoProfile', '-STA', '-Command', script], { timeout: 10 * 60 * 1000 });
}

export const parentOf = dir => dirname(dir);
