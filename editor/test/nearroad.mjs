// Triangle extent along the road by distance class from the road centre line (originals vs editor levels):
// node editor/test/nearroad.mjs [level ...]   - all originals (game directory of data/config.json), plus
// data/out/<level> for the editor's levels listed
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const q = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN;
function run(label, dir, name) {
  const f = n => readdirSync(dir).find(x => x.toLowerCase() === name.toLowerCase() + n);
  const M = readFileSync(`${dir}/${f('.msh')}`), C = readFileSync(`${dir}/${f('.plc')}`), N = C.readInt32LE(0);
  const cls = { 'road |lat|<190': [], 'beside 190-500': [], 'beside 500-1000': [] }, secLen = [];
  for (let k = 0; k < N - 1; k++) {
    const o = 4 + 20 * k, o2 = o + 20; if (C[o + 4] > 8 || C[o2 + 4] > 8) continue;
    let d = [C.readInt32LE(o2 + 8) - C.readInt32LE(o + 8), C.readInt32LE(o2 + 16) - C.readInt32LE(o + 16)]; const l = Math.hypot(...d); if (l < 50 || l > 600) continue; secLen.push(l);
    d = d.map(v => v / l); const left = [-d[1], d[0]];
    const off = C.readInt32LE(o) * 4, nv = M.readInt32LE(off), nf = M.readInt32LE(off + 4), vb = off + 8, fb = vb + 12 * nv;
    for (let i = 0; i < nf; i++) { const b = fb + 44 * i, ix = [4, 8, 12].map(s => M.readInt32LE(b + s)); if (new Set(ix).size < 3) continue;
      const p = ix.map(j => { const x = M.readInt32LE(vb + 12 * j), z = M.readInt32LE(vb + 12 * j + 8); return [x * d[0] + z * d[1], x * left[0] + z * left[1]]; });
      const lat = Math.abs(p.reduce((s, v) => s + v[1], 0) / 3), along = Math.max(...p.map(v => v[0])) - Math.min(...p.map(v => v[0]));
      const key = lat < 190 ? 'road |lat|<190' : lat < 500 ? 'beside 190-500' : lat < 1000 ? 'beside 500-1000' : null;
      if (key) cls[key].push(along); }
  }
  console.log(`${label}: section spacing median ${q(secLen, .5).toFixed(0)}`);
  for (const [k, a] of Object.entries(cls)) if (a.length) console.log('   ', k.padEnd(16), String(a.length).padStart(5), 'tris | along extent median', q(a, .5).toFixed(0), 'p90', q(a, .9).toFixed(0), 'max', q(a, 1).toFixed(0), '| share > 200:', (100 * a.filter(v => v > 200).length / a.length).toFixed(0) + ' %', '> 250:', (100 * a.filter(v => v > 250).length / a.length).toFixed(0) + ' %', '> 300:', (100 * a.filter(v => v > 300).length / a.length).toFixed(0) + ' %');
}
const G = JSON.parse(readFileSync(new URL('../../data/config.json', import.meta.url), 'utf8')).gameDir + '/LEVELS/';
for (const [d, n] of [[existsSync(G + 'Canada.org') ? 'Canada.org' : 'Canada', 'CANADA'], ['Carib', 'CARIB'], ['Austria', 'AUSTRIA'], ['Brazil', 'BRAZIL'], ['Iceland', 'ICELAND'], ['Japan', 'JAPAN'], ['USA', 'USA']]) if (existsSync(G + d)) run(d, G + d, n);
for (const l of process.argv.slice(2)) run('OURS ' + l, `data/out/${l}/CANADA`, 'CANADA');
