// screenshots of LEVEL around AT=x,y,z (game coordinates) with VIEWS='[[yaw,pitch,dist],...]': at_<n>.png in $SCR
export const url = 'http://localhost:8767/?level=' + (process.env.LEVEL || 'MyThird');
export default async page => {
  await page.wait(Number(process.env.WAIT || 5000));
  await page.eval(`document.querySelectorAll('.vphead button')[1].click()`);
  if (process.env.MODE) { await page.eval(`window.editor.setMode(${JSON.stringify(process.env.MODE)})`); await page.wait(1500); }
  const [x, y, z] = process.env.AT.split(',').map(Number), views = JSON.parse(process.env.VIEWS || '[[0,1.5,1200],[0.8,0.6,1000]]');
  let k = 0;
  for (const [yaw, pitch, dist] of views) {
    await page.eval(`(() => { const v = window.editor.views[1]; v.target.set(${x}, ${y}, ${-z}); v.dist = ${dist}; v.pitch = ${pitch}; v.yaw = ${yaw}; })()`);
    await page.wait(700);
    await page.shot(process.env.SCR + `/at_${k++}.png`);
  }
};
