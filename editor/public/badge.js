// Short messages as small badges at the action they belong to (a button, a field, the spot clicked in a view), instead
// of a status line nobody watches: ok = green (done), hint = grey, warn = orange, err = red, busy = grey until replaced.
// Without an explicit anchor the badge sits at the control last clicked, else at the mouse.

let lastEl = null, mouse = [innerWidth / 2, innerHeight / 2];
const CONTROL = 'button, label, select, input, a, .card, .orow, .tlkey, #levelName';
addEventListener('pointerdown', e => { mouse = [e.clientX, e.clientY]; lastEl = e.target.closest?.(CONTROL) || null; }, true);
addEventListener('pointermove', e => { mouse = [e.clientX, e.clientY]; }, true);
addEventListener('keydown', () => { lastEl = null; }, true);

const visible = el => el && el.isConnected && el.getClientRects().length > 0;
// where a message about the action going on now belongs: the control last clicked, a focused field, or the mouse
export function anchorNow() {
  if (visible(lastEl)) return lastEl;
  const f = document.activeElement;
  if (f && f !== document.body && visible(f) && f.closest('#left, #header, #viewbar, #timeline, .popover')) return f;
  return { x: mouse[0], y: mouse[1] };
}

const LIFE = { ok: 2500, hint: 3500, warn: 5500, err: 9000 };
const shown = new Map();                           // anchor (element, or 'mouse') -> its badge
export function badge(text, kind = 'hint', at = anchorNow()) {
  if (!text) return;
  if (kind === 'muted') kind = 'hint';
  const key = at instanceof Element ? at : 'mouse';
  shown.get(key)?.remove();
  const el = document.createElement('div');
  el.className = 'badge-msg ' + kind;
  el.textContent = text;
  el.title = 'click to close';
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  shown.set(key, el);
  const w = el.offsetWidth, h = el.offsetHeight;
  let x, y;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = r.right + 6; y = r.top + r.height / 2 - h / 2;
    if (x + w > innerWidth - 6) { x = Math.max(6, r.right - w); y = r.bottom + 4; }      // no room on the right: below
  } else { x = at.x + 14; y = at.y + 14; }
  el.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + 'px';
  el.style.top = Math.max(6, Math.min(y, innerHeight - h - 6)) + 'px';
  if (kind !== 'busy') setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, LIFE[kind] || LIFE.hint);
  return el;
}
