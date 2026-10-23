// Local server of the Ignition Level Tool: the viewer and the level editor,
// no dependencies (Node 18 or newer).
//   node editor/server.js                 editor on http://localhost:8767/
//   node editor/server.js --viewer        viewer only (original levels) on http://localhost:8765/
//   options: --port <n>, --no-open (do not open the browser)
// Everything the user makes stays in data/: config.json (game directory),
// levels/ (the editor's levels), textures/ (own PNG textures), out/ (compiled levels).
import { createServer } from 'node:http';
import { promises as fs, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileLevel } from './core/compile.js';
import { newLevel } from './core/model.js';
import { makeZip } from './zip.js';
import { buildTextures } from './textures.js';
import { convertWAV } from './wav.js';
import { soundMarkers, soundSlots, soundFileName } from './core/sounds.js';
import { listSourceLevels, listObjects, getObject, getAllObjects, tilePixels } from './assets.js';
import { encodePNG, decodePNG } from './png.js';
import { resolveGameDir, findGameDirIn, browseFolder } from './gamedir.js';
import { convertLevel, exportObj } from '../viewer/convert.js';
import { readLevelDir, readGeneral, originalDir, listOriginalLevels } from '../viewer/gamefiles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'data');
const CONFIG = join(DATA, 'config.json');
const LEVELS = join(DATA, 'levels');
const TEXTURES = join(DATA, 'textures');              // the user's own textures (PNG), watched by the editor
const OUT = join(DATA, 'out');
const VIEWER = join(ROOT, 'viewer');

const args = process.argv.slice(2);
const VIEWER_ONLY = args.includes('--viewer');
const PORT = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || (VIEWER_ONLY ? 8765 : 8767);
const APP = 'ignition-level-tool';

// ---------- settings and the game directory ----------

const DEFAULTS = { gameDir: null, slot: 'Canada' };
async function config() {
  try { return { ...DEFAULTS, ...JSON.parse(await fs.readFile(CONFIG, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
async function saveConfig(changes) {
  const cfg = { ...(await config()), ...changes };
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(CONFIG, JSON.stringify(cfg, null, 2));
  return cfg;
}
// resolved once and after every change of the setting (the Steam lookup takes a moment)
let game = null;
async function gameInfo() {
  if (!game) {
    const cfg = await config();
    game = { ...(await resolveGameDir(cfg.gameDir)), configured: cfg.gameDir || null };
    if (game.dir && game.source === 'steam' && !cfg.gameDir) await saveConfig({ gameDir: game.dir });
  }
  return game;
}
async function gameDir() {
  const g = await gameInfo();
  if (!g.dir) throw Object.assign(new Error('The Ignition game directory is not set (open /setup.html)'), { status: 409 });
  return g.dir;
}

// ---------- http helpers ----------

const STATIC = [['/core/', join(HERE, 'core')], ['/viewer/', VIEWER], ['/', join(HERE, 'public')]];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css; charset=utf-8' };
const validName = n => /^[A-Za-z0-9_-]{1,64}$/.test(n);

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body));
}
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
async function serveStatic(res, path) {
  for (const [prefix, dir] of STATIC) {
    if (!path.startsWith(prefix)) continue;
    let file = resolve(dir, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
    if (!file.startsWith(dir + sep) && file !== dir) return send(res, 403, { error: 'forbidden' });
    try {
      if ((await fs.stat(file)).isDirectory()) file = join(file, 'index.html');
      return send(res, 200, await fs.readFile(file), TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
    } catch { /* next prefix */ }
  }
  send(res, 404, { error: 'not found' });
}

// ---------- the editor's levels: building the game files ----------

const levelFile = name => join(LEVELS, name, 'level.json');
async function readLevel(name) { return JSON.parse(await fs.readFile(levelFile(name), 'utf8')); }

// copied from the source level: effect table, preview picture (and the Sound folder);
// palette, textures and colour tables are generated (textures.js)
const COPIED = ['.tfx', '.pic'];
const GENERATED = ['MSH', 'PLC', 'POS', 'TRI', 'SRF'];

// The game files of a level, in memory: {report, ok, prefix, entries: [[path, bytes]],
// files: {COL, TEX, TFX, MSH, ...} for the viewer, sounds: ["Sound/03_X.WAV", ...]}
async function buildLevel(name, level) {
  const cfg = await config(), dir = await gameDir();
  const tiles = await loadTiles(dir, level);
  const { files, report, palette, atlas } = compileLevel(level, { tiles, textures: tiles.textures, slot: cfg.slot });
  const slot = level.slot || cfg.slot, prefix = slot.toUpperCase();
  if (report.errors.length) return { report, ok: false, prefix };
  const entries = [], gameFiles = {}, sounds = [];
  const add = (path, data, ext) => { entries.push([path, data]); if (ext) gameFiles[ext] = data; };
  const slots = soundSlots(level), ownSlots = new Set(soundMarkers(level).map(m => m.slot));
  let soundDir = 'Sound';
  const src = originalDir(dir, level.source || slot);
  if (!existsSync(src)) throw new Error(`source level not found: ${src}`);
  for (const f of await fs.readdir(src, { withFileTypes: true })) {
    const ext = extname(f.name).toLowerCase();
    if (f.isFile() && COPIED.includes(ext)) add(`${prefix}/${prefix}${ext.toUpperCase()}`, new Uint8Array(await fs.readFile(join(src, f.name))), ext.slice(1).toUpperCase());
    if (f.isDirectory()) {                                     // Sound: the originals' files, except the slots of own sounds
      soundDir = f.name;
      for (const s of await fs.readdir(join(src, f.name))) {
        const m = /^(\d+)/.exec(s);
        if (m && ownSlots.has(Number(m[1]))) continue;
        add(`${prefix}/${f.name}/${s}`, new Uint8Array(await fs.readFile(join(src, f.name, s))));
        sounds.push(`${f.name}/${s}`);
      }
    }
  }
  // own sounds (sounds.js): the converted WAVs with their gain, named by slot
  const used = new Map(soundMarkers(level).map(m => [m.sound.id, m]));
  for (const s of level.sounds || []) {
    if (!used.has(s.id)) continue;
    let data;
    try { data = convertWAV(await fs.readFile(join(LEVELS, name, 'sound', s.id + '.wav')), s.gain ?? 100).wav; }
    catch (e) { report.warnings.push(`Sound ${s.name}: ${e.message}`); continue; }
    const file = soundFileName(s, slots.get(s.id));
    add(`${prefix}/${soundDir}/${file}`, data);
    sounds.push(`${soundDir}/${file}`);
  }
  for (const [ext, data] of Object.entries(await buildTextures(src, palette, atlas))) add(`${prefix}/${prefix}.${ext}`, data, ext);
  for (const ext of GENERATED) add(`${prefix}/${prefix}.${ext}`, files[ext], ext);
  return { report, ok: true, prefix, entries, files: gameFiles, sounds };
}

// level -> data/out/<name>/<SLOT>/ and data/out/<name>.zip (containing <SLOT>/...)
async function compile(name) {
  const built = await buildLevel(name, await readLevel(name));
  if (!built.ok) return { report: built.report, written: false };
  const base = join(OUT, name);
  await fs.rm(base, { recursive: true, force: true });
  for (const [path, data] of built.entries) {
    await fs.mkdir(dirname(join(base, path)), { recursive: true });
    await fs.writeFile(join(base, path), data);
  }
  await fs.writeFile(join(OUT, name + '.zip'), makeZip(built.entries));
  views.delete('my_' + name.toLowerCase());
  return { report: built.report, written: true, output: join(base, built.prefix), zip: join(OUT, name + '.zip'),
           viewer: `/viewer/?level=my_${name.toLowerCase()}` };
}

// the texture tiles the level's assets refer to ("<level>/<tex>/<tile>", LEVELFORMAT.md ch. 4) from the original levels:
// Map key -> rgba (64 x 64); a tile that cannot be read is left out (the compiler falls back to the flat colour)
async function loadTiles(dir, level) {
  const tiles = new Map();
  for (const A of Object.values(level.assets || {})) for (const f of A.faces || []) {
    const key = f[6];
    if (!key || tiles.has(key)) continue;
    const [name, tex, tile] = key.split('/');
    const src = validName(name) ? originalDir(dir, name) : null;
    if (!src || !existsSync(src)) continue;
    try { tiles.set(key, await tilePixels(src, Number(tex), Number(tile))); } catch { /* no such tile */ }
  }
  // the user's own textures: every PNG a textured face or a paint names, cut into 64 x 64 tiles "png/<name>/<i>/<j>"
  const textures = new Map(), names = new Set();
  for (const A of Object.values(level.assets || {})) for (const f of A.faces || []) if (f[6] && f[6].startsWith('png:')) names.add(f[6].slice(4));
  for (const list of Object.values(level.paint?.base || {})) for (const r of list) if (typeof r[2] === 'string' && r[2].startsWith('png:')) names.add(r[2].slice(4).split('@')[0]);
  for (const t of level.terrain?.tris || []) if (typeof t[4] === 'string' && t[4].startsWith('png:')) names.add(t[4].slice(4).split('@')[0]);
  for (const name of names) {
    if (textures.has(name) || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) continue;
    let img;
    try { img = decodePNG(await fs.readFile(join(TEXTURES, name + '.png'))); } catch { continue; }
    const tw = Math.max(1, Math.ceil(img.w / 64)), th = Math.max(1, Math.ceil(img.h / 64));
    const sum = [0, 0, 0]; let k = 0;
    for (let i = 0; i < img.w * img.h; i++) { if (img.rgba[i * 4 + 3] < 255) continue; for (let j = 0; j < 3; j++) sum[j] += img.rgba[i * 4 + j]; k++; }   // not fully opaque = transparent in the game (compile.js)
    const mean = '#' + sum.map(v => Math.round(k ? v / k : 128).toString(16).padStart(2, '0')).join('');
    textures.set(name, { tw, th, w: img.w, h: img.h, mean });
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const rgba = new Uint8Array(64 * 64 * 4);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const sx = i * 64 + x, sy = j * 64 + y;
        if (sx >= img.w || sy >= img.h) continue;
        rgba.set(img.rgba.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (y * 64 + x) * 4);
      }
      tiles.set(`png/${name}/${i}/${j}`, rgba);
    }
  }
  tiles.textures = textures;
  return tiles;
}

// install: the original slot folder is kept as <slot>.org (made once), then replaced
async function install(name) {
  const cfg = await config(), dir = await gameDir();
  const level = await readLevel(name);
  const slot = level.slot || cfg.slot;
  const src = join(OUT, name, slot.toUpperCase());
  if (!existsSync(src)) throw new Error('compile first');
  const target = join(dir, 'LEVELS', slot), org = target + '.org';
  if (!existsSync(org)) {
    if (!existsSync(target)) throw new Error(`${target} not found`);
    await fs.rename(target, org);
  }
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(src, target, { recursive: true });
  views.clear();                                                // the original may have moved to <slot>.org
  return { installed: target, original: org };
}

// ---------- viewer data, made on request (viewer/convert.js) ----------
// ids: the original levels by lower-case name ("canada"), the editor's levels as "my_<name>"

const views = new Map();               // id -> {level, images: Map, png: Map}
const previews = new Map();            // editor level name (lower case) -> level sent by the editor ("Show in viewer")
let general = null;

async function editorLevelNames() {
  const names = [];
  for (const d of await fs.readdir(LEVELS, { withFileTypes: true }).catch(() => [])) {
    if (d.isDirectory() && existsSync(levelFile(d.name))) names.push(d.name);
  }
  return names;
}

async function viewData(id) {
  if (views.has(id)) return views.get(id);
  const dir = await gameDir();
  general ||= await readGeneral(dir);
  let data;
  if (id.startsWith('my_')) {
    if (VIEWER_ONLY) throw Object.assign(new Error('the editor\'s levels are shown when the editor is started'), { status: 404 });
    const lower = id.slice(3), name = (await editorLevelNames()).find(n => n.toLowerCase() === lower) || lower;
    const level = previews.get(lower) || await readLevel(name).catch(() => null);
    if (!level) throw Object.assign(new Error(`no editor level ${name}`), { status: 404 });
    const built = await buildLevel(name, level);
    if (!built.ok) throw Object.assign(new Error('the level has errors: ' + built.report.errors.slice(0, 3).map(e => e.text || e).join('; ')), { status: 409 });
    data = convertLevel(id, built.files, { sounds: built.sounds, general });
  } else {
    const name = (await listOriginalLevels(dir)).find(n => n.toLowerCase() === id);
    if (!name) throw Object.assign(new Error(`no level ${id} in the game directory`), { status: 404 });
    const { files, sounds } = await readLevelDir(originalDir(dir, name));
    data = convertLevel(id, files, { sounds, general });
  }
  data.png = new Map();
  if (views.size > 12) views.delete(views.keys().next().value);   // keep the memory small
  views.set(id, data);
  return data;
}

// /viewer/levels/index.json, /viewer/levels/<id>/level.json, /viewer/levels/<id>/<image>.png,
// /viewer/levels/<id>/export.zip
async function viewerApi(res, path) {
  const parts = path.split('/').filter(Boolean).slice(2);    // after viewer/levels
  if (parts[0] === 'index.json') {
    const list = (await listOriginalLevels(await gameDir())).map(n => n.toLowerCase());
    if (!VIEWER_ONLY) {
      for (const n of await editorLevelNames()) list.push('my_' + n.toLowerCase());
      for (const n of previews.keys()) if (!list.includes('my_' + n)) list.push('my_' + n);
    }
    return send(res, 200, list);
  }
  const id = String(parts[0] || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,70}$/.test(id) || parts.length !== 2) return send(res, 404, { error: 'not found' });
  const data = await viewData(id);
  if (parts[1] === 'level.json') return send(res, 200, JSON.stringify(data.level));
  if (parts[1] === 'export.zip') {                             // OBJ + MTL + the textures, for 3D programs
    const { obj, mtl, images } = exportObj(data.tris, id, data.ntex), enc = new TextEncoder();
    const entries = [[`${id}.obj`, enc.encode(obj)], [`${id}.mtl`, enc.encode(mtl)]];
    for (const n of images) entries.push([n, data.png.get(n) || encodePNG(data.images.get(n).w, data.images.get(n).h, data.images.get(n).rgba)]);
    return send(res, 200, makeZip(entries), 'application/zip', { 'Content-Disposition': `attachment; filename="${id}_obj.zip"` });
  }
  const img = data.images.get(parts[1]);
  if (!img) return send(res, 404, { error: 'no such image' });
  if (!data.png.has(parts[1])) data.png.set(parts[1], encodePNG(img.w, img.h, img.rgba));
  return send(res, 200, data.png.get(parts[1]), 'image/png');
}

// ---------- setup: the game directory ----------

async function setupApi(req, res, parts) {
  if (parts[2] === 'browse' && req.method === 'POST') {
    const g = await gameInfo();
    return send(res, 200, { path: await browseFolder(g.dir || g.configured || '') });
  }
  if (req.method === 'GET') {
    const g = await gameInfo();
    return send(res, 200, { gameDir: g.dir, source: g.source, configured: g.configured, mode: VIEWER_ONLY ? 'viewer' : 'editor' });
  }
  if (req.method === 'POST') {                                  // {gameDir}: the directory or one above it
    const { gameDir: chosen } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const found = chosen ? await findGameDirIn(String(chosen), 2) : null;
    if (!found) return send(res, 400, { error: `No Ignition game directory found at ${chosen} (looked for LEVELS and sys.col, two folders deep)` });
    await saveConfig({ gameDir: found });
    game = null; views.clear(); general = null; tilePng.clear();
    return send(res, 200, { gameDir: found });
  }
  send(res, 404, { error: 'unknown api' });
}

// ---------- editor apis ----------

// the objects of the original levels (assets.js): GET /api/assets (the levels in the game directory),
// /api/assets/<level> (its placeable objects), /api/assets/<level>/all (all with geometry), /api/assets/<level>/<ref>
// (one object's geometry and colours; ref = <index> or <index>.<part> for an object embedded in a section mesh)
async function assetsApi(req, res, parts) {
  const dir = await gameDir();
  if (parts.length === 2) return send(res, 200, await listSourceLevels(join(dir, 'LEVELS')));
  const name = parts[2];
  if (!validName(name)) return send(res, 400, { error: 'invalid level name' });
  const src = originalDir(dir, name);
  if (!existsSync(src)) return send(res, 404, { error: `no level ${name} in the game directory` });
  if (parts.length === 3) return send(res, 200, await listObjects(src));
  if (parts[3] === 'all') return send(res, 200, await getAllObjects(src, name));
  const ref = String(parts[3] || '');
  if (!/^\d{1,5}(\.\d{1,4})?$/.test(ref)) return send(res, 400, { error: 'invalid object ref (<index> or <index>.<part>)' });
  return send(res, 200, await getObject(src, name, ref));
}

// a 64 x 64 tile of an original level's texture as PNG (index 0 transparent): GET /api/tiles/<level>/<tex>/<tile>.png
const tilePng = new Map();
async function tilesApi(req, res, parts) {
  const name = parts[2], tex = Number(parts[3]), tile = Number(String(parts[4] || '').replace(/\.png$/i, ''));
  if (!validName(name) || !Number.isInteger(tex) || !Number.isInteger(tile)) return send(res, 400, { error: 'tile: /api/tiles/<level>/<tex>/<tile>.png' });
  const key = `${name}/${tex}/${tile}`;
  if (!tilePng.has(key)) {
    const src = originalDir(await gameDir(), name);
    if (!existsSync(src)) return send(res, 404, { error: `no level ${name}` });
    tilePng.set(key, encodePNG(64, 64, await tilePixels(src, tex, tile)));
  }
  return send(res, 200, tilePng.get(key), 'image/png');
}

// the user's own textures: GET /api/textures = [{name, w, h, mtime}] of data/textures/*.png (the editor polls
// it and reloads a changed file), GET /api/textures/<name>.png = the file
const texMeta = new Map();                                     // name -> {mtime, w, h}
async function texturesApi(req, res, parts) {
  await fs.mkdir(TEXTURES, { recursive: true });
  if (parts.length === 2) {
    const out = [];
    for (const f of await fs.readdir(TEXTURES)) {
      if (extname(f).toLowerCase() !== '.png') continue;
      const name = f.slice(0, -4), st = await fs.stat(join(TEXTURES, f)), mtime = Math.round(st.mtimeMs);
      if (!texMeta.has(name) || texMeta.get(name).mtime !== mtime) {
        try { const img = decodePNG(await fs.readFile(join(TEXTURES, f))); texMeta.set(name, { mtime, w: img.w, h: img.h }); }
        catch (e) { texMeta.set(name, { mtime, w: 0, h: 0, error: String(e.message || e) }); }
      }
      out.push({ name, ...texMeta.get(name) });
    }
    return send(res, 200, out.sort((a, b) => a.name.localeCompare(b.name)));
  }
  const name = String(parts[2] || '').replace(/\.png$/i, '');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return send(res, 400, { error: 'texture name' });
  try { return send(res, 200, await fs.readFile(join(TEXTURES, name + '.png')), 'image/png'); }
  catch { return send(res, 404, { error: 'no such texture' }); }
}

async function levelsApi(req, res, parts) {
  await fs.mkdir(LEVELS, { recursive: true });
  if (parts.length === 2 && req.method === 'GET') return send(res, 200, (await editorLevelNames()).sort());
  if (parts.length === 2 && req.method === 'POST') {            // new level {name}
    const { name } = JSON.parse((await readBody(req)).toString('utf8'));
    if (!validName(name)) return send(res, 400, { error: 'name: letters, digits, _ and - only' });
    if (existsSync(levelFile(name))) return send(res, 409, { error: `level ${name} exists` });
    await fs.mkdir(join(LEVELS, name), { recursive: true });
    await fs.writeFile(levelFile(name), JSON.stringify(newLevel(name), null, 2));
    return send(res, 200, { created: name });
  }
  const name = parts[2];
  if (!validName(name)) return send(res, 400, { error: 'invalid level name' });
  if (parts.length === 3 && req.method === 'GET') {
    try { return send(res, 200, await fs.readFile(levelFile(name), 'utf8')); }
    catch { return send(res, 404, { error: 'no such level' }); }
  }
  if (parts.length === 3 && req.method === 'PUT') {
    const body = (await readBody(req)).toString('utf8');
    JSON.parse(body);
    await fs.mkdir(join(LEVELS, name), { recursive: true });
    await fs.writeFile(levelFile(name), body);
    views.delete('my_' + name.toLowerCase());
    previews.delete(name.toLowerCase());
    return send(res, 200, { saved: name });
  }
  // "Show in viewer": the editor sends its level as it is (saved or not); the viewer shows it as my_<name>
  if (parts[3] === 'preview' && req.method === 'POST') {
    const level = JSON.parse((await readBody(req)).toString('utf8'));
    previews.set(name.toLowerCase(), level);
    views.delete('my_' + name.toLowerCase());
    return send(res, 200, { viewer: `/viewer/?level=my_${name.toLowerCase()}` });
  }
  // a reference image for a flat view (the editor's build aid, reference.js): PUT /api/levels/<name>/ref/<view> with
  // the image bytes (png or jpeg), GET the same, DELETE removes it; stored as levels/<name>/ref_<view>.<png|jpg>
  if (parts[3] === 'ref') {
    const view = parts[4];
    if (!['top', 'front', 'left'].includes(view)) return send(res, 400, { error: 'ref: top, front or left' });
    const dir = join(LEVELS, name), files = existsSync(dir) ? await fs.readdir(dir) : [], cur = files.find(f => f.startsWith(`ref_${view}.`));
    if (req.method === 'PUT') {
      const type = String(req.headers['content-type'] || ''), ext = type.includes('png') ? 'png' : /jpe?g/.test(type) ? 'jpg' : null;
      if (!ext) return send(res, 400, { error: 'a PNG or JPEG image' });
      const body = await readBody(req);
      await fs.mkdir(dir, { recursive: true });
      if (cur) await fs.rm(join(dir, cur), { force: true });
      await fs.writeFile(join(dir, `ref_${view}.${ext}`), body);
      return send(res, 200, { file: `ref_${view}.${ext}` });
    }
    if (req.method === 'DELETE') { if (cur) await fs.rm(join(dir, cur), { force: true }); return send(res, 200, { removed: !!cur }); }
    if (!cur) return send(res, 404, { error: 'no reference image' });
    return send(res, 200, await fs.readFile(join(dir, cur)), cur.endsWith('.png') ? 'image/png' : 'image/jpeg');
  }
  // the level's own sounds (sounds.js): PUT /api/levels/<name>/sound/<id> with a WAV (converted to 8 bit mono 11025 Hz
  // and stored beside the level), GET it back, DELETE removes it
  if (parts[3] === 'sound') {
    const id = String(parts[4] || '').replace(/\.wav$/i, '');
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) return send(res, 400, { error: 'sound id' });
    const dir = join(LEVELS, name, 'sound'), file = join(dir, id + '.wav');
    if (req.method === 'PUT') {
      let conv;
      try { conv = convertWAV(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, conv.wav);
      return send(res, 200, { file: id + '.wav', info: conv.info });
    }
    if (req.method === 'DELETE') { await fs.rm(file, { force: true }); return send(res, 200, { removed: true }); }
    try { return send(res, 200, await fs.readFile(file), 'audio/wav'); } catch { return send(res, 404, { error: 'no such sound' }); }
  }
  if (parts[3] === 'compile' && req.method === 'POST') return send(res, 200, await compile(name));
  if (parts[3] === 'install' && req.method === 'POST') return send(res, 200, await install(name));
  if (parts[3] === 'zip' && req.method === 'GET') {
    const file = join(OUT, name + '.zip');
    if (!existsSync(file)) return send(res, 404, { error: 'compile first' });
    return send(res, 200, await fs.readFile(file), 'application/zip',
                { 'Content-Disposition': `attachment; filename="${name}.zip"` });
  }
  send(res, 404, { error: 'unknown api' });
}

async function api(req, res, path) {
  const parts = path.split('/').filter(Boolean);             // ['api', ...]
  if (parts[1] === 'ping') return send(res, 200, { app: APP, mode: VIEWER_ONLY ? 'viewer' : 'editor' });
  if (parts[1] === 'setup') return setupApi(req, res, parts);
  if (parts[1] === 'config') return send(res, 200, { ...(await config()), gameDir: (await gameInfo()).dir });
  if (VIEWER_ONLY) return send(res, 404, { error: 'the editor is not started (editor.bat)' });
  if (parts[1] === 'textures') return texturesApi(req, res, parts);
  if (parts[1] === 'assets') return assetsApi(req, res, parts);
  if (parts[1] === 'tiles') return tilesApi(req, res, parts);
  if (parts[1] === 'levels') return levelsApi(req, res, parts);
  send(res, 404, { error: 'unknown api' });
}

// ---------- the server ----------

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) return await api(req, res, path);
    // pages: without a game directory first the setup; the viewer-only start opens the viewer
    const page = path === '/' || path === '/index.html' || path === '/viewer/' || path === '/viewer/index.html';
    if (page && !(await gameInfo()).dir) return redirect(res, '/setup.html?next=' + encodeURIComponent(VIEWER_ONLY ? '/viewer/' : path));
    if (VIEWER_ONLY && (path === '/' || path === '/index.html')) return redirect(res, '/viewer/');
    if (path.startsWith('/viewer/levels/')) return await viewerApi(res, path);
    await serveStatic(res, path);
  } catch (e) {
    send(res, e.status || 500, { error: String(e.message || e) });
  }
});

const url = `http://localhost:${PORT}/${VIEWER_ONLY ? 'viewer/' : ''}`;
function openBrowser() {
  if (args.includes('--no-open')) return;
  const [cmd, cargs] = process.platform === 'win32' ? ['cmd', ['/c', `start "" "${url}"`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, cargs, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  // already running (a second double-click): just open the browser
  try {
    const r = await (await fetch(`http://127.0.0.1:${PORT}/api/ping`)).json();
    if (r.app === APP) { console.log(`Already running: ${url}`); openBrowser(); setTimeout(() => process.exit(0), 500); return; }
  } catch { /* another program */ }
  console.error(`Port ${PORT} is used by another program. Start with --port <number>.`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', async () => {
  const g = await gameInfo();
  console.log(`Ignition Level Tool (${VIEWER_ONLY ? 'viewer' : 'editor'}): ${url}`);
  console.log(g.dir ? `Game directory: ${g.dir}${g.source === 'steam' ? ' (found in Steam)' : ''}` : 'Game directory not set yet: the browser opens the setup.');
  console.log('Close this window to stop.');
  openBrowser();
});
