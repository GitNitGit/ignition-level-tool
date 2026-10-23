// DevTools-protocol driver for UI tests (Chrome headless, needs the editor server on :8767):
//   SCR=<dir for screenshots> LEVEL=<level> node cdp.mjs view_junctions.mjs
// The script module exports url and default async (page) => {...}; page.eval, page.shot, page.mouse, page.wait.
// window.editor in the page exposes level, compiled, views, sel, setMode.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

// Node before 22 has no WebSocket: a minimal client (text frames, as the DevTools protocol uses them)
class MiniSocket {
  constructor(url) {
    this.handlers = { open: [], message: [] };
    const req = request(url.replace(/^ws/, 'http'), { headers: { Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') } });
    req.on('upgrade', (res, sock) => {
      this.sock = sock;
      let buf = Buffer.alloc(0), parts = [];
      sock.on('data', d => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          let len = buf[1] & 127, p = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); p = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); p = 10; }
          if (buf.length < p + len) return;
          const fin = buf[0] & 128, op = buf[0] & 15;
          parts.push(buf.subarray(p, p + len)); buf = buf.subarray(p + len);
          if (op === 8) return sock.end();
          if (fin && op !== 9 && op !== 10) { const data = Buffer.concat(parts).toString('utf8'); parts = []; this.handlers.message.forEach(h => h({ data })); }
          else if (fin) parts = [];
        }
      });
      this.handlers.open.forEach(h => h());
    });
    req.end();
  }
  addEventListener(type, h) { this.handlers[type]?.push(h); }
  send(text) {
    const data = Buffer.from(text), mask = randomBytes(4), n = data.length;
    const head = n < 126 ? Buffer.from([0x81, 0x80 | n]) : n < 65536 ? Buffer.from([0x81, 0x80 | 126, n >> 8, n & 255])
      : Buffer.concat([Buffer.from([0x81, 0x80 | 127]), (b => (b.writeBigUInt64BE(BigInt(n)), b))(Buffer.alloc(8))]);
    for (let i = 0; i < n; i++) data[i] ^= mask[i & 3];
    this.sock.write(Buffer.concat([head, mask, data]));
  }
}
const WebSocket = globalThis.WebSocket || MiniSocket;
export async function launch(url) {
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1500,1000', '--user-data-dir=' + process.env.TEMP + '/cdp-profile', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  for (let i = 0; i < 50 && !ws; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json(); ws = t.webSocketDebuggerUrl; } catch {}
  }
  const sock = new WebSocket(ws);
  await new Promise(r => sock.addEventListener('open', r));
  let id = 0; const pending = new Map(); const logs = [];
  sock.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const page = {
    logs, send,
    eval: async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails)); return r.result.result.value; },
    shot: async file => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    wait: ms => new Promise(r => setTimeout(r, ms)),
    mouse: async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra }),
    close: async () => { try { await send('Browser.close'); } catch {} proc.kill(); },
  };
  return page;
}
if (process.argv[2]) {
  const { pathToFileURL } = await import('node:url');
  const script = await import(pathToFileURL(process.argv[2]).href);
  const page = await launch(script.url || 'http://localhost:8767/');
  try { await script.default(page); } catch (e) { console.log('SCRIPT ERROR', e.message); }
  console.log('console problems:', JSON.stringify(page.logs, null, 1));
  await page.close();
  process.exit(0);
}
