export const url = 'file:///' + process.env.HTML.split('\\').join('/');
export default async page => { await page.wait(800); await page.shot(process.env.OUT); };
