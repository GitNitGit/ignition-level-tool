// screenshots (top and oblique) at both ends of every branch of LEVEL (default MyThird): t25_<n>.png in $SCR
export const url = 'http://localhost:8767/?level=' + (process.env.LEVEL || 'MyThird');
const ev = (page, e) => page.eval(e);
export default async page => {
  await page.wait(Number(process.env.WAIT || 3500));
  await ev(page, `document.querySelectorAll('.vphead button')[1].click()`);
  const pts = await ev(page, `(() => { const E = window.editor, L = E.level.track, n = id => L.nodes.find(x => x.id === id); return L.branches.map(b => [n(b.from), n(b.to)].map(q => [q.x, q.y ?? 0, q.z])); })()`);
  console.log(JSON.stringify(pts));
  let k = 0;
  for (const p of pts.flat()) {
    for (const [yaw, pitch, dist] of [[0, 1.5, 2600], [0.8, 0.5, 2200]]) {
      await ev(page, `(() => { const v = window.editor.views[1]; v.target.set(${p[0]}, ${p[1]}, ${-p[2]}); v.dist = ${dist}; v.pitch = ${pitch}; v.yaw = ${yaw}; })()`);
      await page.wait(700);
      await page.shot(process.env.SCR + `/t25_${k++}.png`);
    }
  }
};
