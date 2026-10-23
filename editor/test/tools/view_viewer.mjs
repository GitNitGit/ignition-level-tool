// screenshot of the viewer at URL (env), after WAIT ms: $SCR/$NAME.png
export const url = process.env.URL;
export default async page => { await page.wait(Number(process.env.WAIT || 10000)); await page.shot(process.env.SCR + '/' + (process.env.NAME || 'viewer') + '.png'); };
