// Reading a level and the shared files from the game directory (Node).
import { promises as fs, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

// level files by extension, as the converter takes them
const LEVEL_EXTS = ['COL', 'TEX', 'TFX', 'MSH', 'PLC', 'POS', 'TRI', 'SRF'];

// A level directory: {files: {COL, TEX, ...}, sounds: ["Sound/03_TRAIN.WAV", ...]}
// (file names are matched without regard to case, as the game does).
export async function readLevelDir(dir) {
  const files = {}, sounds = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (d.isFile()) {
      const ext = extname(d.name).slice(1).toUpperCase();
      if (LEVEL_EXTS.includes(ext) && !files[ext]) files[ext] = new Uint8Array(await fs.readFile(join(dir, d.name)));
    } else if (d.isDirectory()) {
      for (const s of await fs.readdir(join(dir, d.name))) sounds.push(`${d.name}/${s}`);
    }
  }
  return { files, sounds };
}

// The system palette and the effect sprites of GENERAL: {syscol, smoke, darksmok, light}
// (missing ones are left out; the viewer then does without those sprites).
export async function readGeneral(gameDir) {
  const out = {};
  if (!gameDir) return out;
  const pick = async (dir, name) => {
    try {
      const f = (await fs.readdir(dir)).find(x => x.toLowerCase() === name);
      return f ? new Uint8Array(await fs.readFile(join(dir, f))) : undefined;
    } catch { return undefined; }
  };
  out.syscol = await pick(gameDir, 'sys.col');
  const general = (await fs.readdir(gameDir).catch(() => [])).find(x => x.toLowerCase() === 'general');
  if (general) {
    for (const [k, f] of [['smoke', 'smoke.tfx'], ['darksmok', 'darksmok.tfx'], ['light', 'light.tfx']]) {
      out[k] = await pick(join(gameDir, general), f);
    }
  }
  return out;
}

// Directory of an original level: while a level of the editor is installed in its
// place, the original is kept as <name>.org.
export function originalDir(gameDir, name) {
  const base = join(gameDir, 'LEVELS', name);
  return existsSync(base + '.org') ? base + '.org' : base;
}

// The original levels in the game directory (the folders of LEVELS with a mesh
// file; backups "<name>.org" count as <name>; Canada_Japan is a copy of Japan).
export async function listOriginalLevels(gameDir) {
  const dir = join(gameDir, 'LEVELS'), names = new Set();
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const name = d.name.replace(/\.org$/i, '');
    if (name.includes('.') || name.toLowerCase() === 'canada_japan') continue;
    const files = await fs.readdir(join(dir, d.name)).catch(() => []);
    if (files.some(f => f.toLowerCase().endsWith('.msh'))) names.add(name);
  }
  return [...names].sort();
}
