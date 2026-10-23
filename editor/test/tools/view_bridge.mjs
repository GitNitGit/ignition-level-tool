// screenshots around the first bridge ceiling of LEVEL: t24_<n>.png in $SCR; VIEWS='[[yaw,pitch,dist],...]'
export const url = 'http://localhost:8767/?level=' + (process.env.LEVEL || 'MySecond');
const ev = (page, e) => page.eval(e);
export default async page => {
  await page.wait(3500);
  await ev(page, `document.querySelectorAll('.vphead button')[1].click()`);
  const c = await ev(page, `(() => { const E = window.editor, t = E.compiled.base.tris.filter(t => t.strip === 'ceiling'); if (!t.length) return null; const p = t[0].p[0]; return [p[0], p[1], p[2], E.compiled.terrainInfo?.holes.length, E.compiled.base.bridges]; })()`);
  console.log('ceiling at', c);
  if (!c) return;
  const views = JSON.parse(process.env.VIEWS || '[[0.6,0.5,3500],[3.6,0.35,2500],[2.0,0.12,1600]]');
  let k = 0;
  for (const [yaw, pitch, dist] of views) {
    await ev(page, `(() => { const v = window.editor.views[1]; v.target.set(${c[0]}, ${c[1]}, ${-c[2]}); v.dist = ${dist}; v.pitch = ${pitch}; v.yaw = ${yaw}; })()`);
    await page.wait(700);
    await page.shot(process.env.SCR + `/t24_${k++}.png`);
  }
};
