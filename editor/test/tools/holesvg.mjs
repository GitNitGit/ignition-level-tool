// node holesvg.mjs level.json out.html [radius]: plan view (SVG in HTML) around the first open edge: base grey, covered
// blue, terrain green, holes red; screenshot it with HTML=<abs path> OUT=<png> node cdp.mjs shotfile.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const E = new URL('../../core/', import.meta.url).href;
const { compileLevel } = await import(E + 'compile.js');
const lv = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const r = compileLevel({ ...lv, compileOptions: { avoidLightning: false } }), pos = r.terrainInfo.pos, holes = r.terrainInfo.holes;
const c = holes.length ? holes[0][0] : [0, 0, 0], R = Number(process.argv[4] || 700);
const S = 900 / (2 * R), X = x => (x - c[0] + R) * S, Z = z => (c[2] + R - z) * S;
const near = p => Math.abs(p[0] - c[0]) < R * 1.3 && Math.abs(p[2] - c[2]) < R * 1.3;
let svg = '';
for (const t of r.base.tris) if (t.p.some(near)) svg += `<polygon points="${t.p.map(p => X(p[0]) + ',' + Z(p[2])).join(' ')}" fill="${t.covered || t.deck ? '#88f' : '#bbb'}" stroke="#666" stroke-width="0.5" opacity="0.8"/>`;
lv.terrain.tris.forEach((t, id) => { const P = t.slice(0, 3).map(i => pos[i]); if (P.every(Boolean) && P.some(near)) svg += `<polygon points="${P.map(p => X(p[0]) + ',' + Z(p[2])).join(' ')}" fill="${t[3] === 'dead' ? '#f88' : '#9d9'}" fill-opacity="0.4" stroke="#060" stroke-width="0.7"/>`; });
for (const [a, b] of holes) if (near(a) || near(b)) svg += `<line x1="${X(a[0])}" y1="${Z(a[2])}" x2="${X(b[0])}" y2="${Z(b[2])}" stroke="red" stroke-width="3"/>`;
lv.terrain.points.forEach((P, i) => { const p = pos[i]; if (p && near(p)) svg += `<circle cx="${X(p[0])}" cy="${Z(p[2])}" r="2.5" fill="${P.lock ? '#00f' : '#000'}"/><text x="${X(p[0]) + 3}" y="${Z(p[2]) - 3}" font-size="9">${i}</text>`; });
writeFileSync(process.argv[3], `<html><body style="margin:0;background:#fff"><svg width="900" height="900">${svg}</svg></body></html>`);
console.log('holes', holes.length, 'centre', c.map(Math.round));
