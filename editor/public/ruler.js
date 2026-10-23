// The ruler (R, the view bar box): drag anywhere to measure in world units; the measurement stays until the next.
import * as THREE from './vendor/three.module.js';
import { $, T3 } from './state.js';
import { rayAt, camOf, trackGroup, rulerGroup, canvas } from './views.js';

export const rulerOn = () => $('ruler').checked;
// the point of the drawn surfaces under the cursor (game coordinates); beside them a point on the plane through the
// view's centre facing the camera
export function worldAt(v, px, py) {
  const ray = rayAt(v, px, py);
  const hit = ray.intersectObjects(trackGroup.children, true).find(h => h.object.visible);
  let p = hit?.point;
  if (!p) {
    const dir = camOf(v).getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, v.type === '3d' ? v.target : v.center);
    p = ray.ray.intersectPlane(plane, new THREE.Vector3()) || v.center.clone();
  }
  return [p.x, p.y, -p.z];
}
export function showRuler(a, b, px, py) {
  rulerGroup.clear();
  if (!a) { $('rulerLabel').hidden = true; return; }
  const mat = new THREE.LineBasicMaterial({ color: 0xffcc33, depthTest: false });
  rulerGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([T3(a), T3(b)]), mat));
  const ends = new THREE.Points(new THREE.BufferGeometry().setFromPoints([T3(a), T3(b)]),
    new THREE.PointsMaterial({ color: 0xffcc33, size: 9, sizeAttenuation: false, depthTest: false }));
  rulerGroup.add(ends);
  for (const o of rulerGroup.children) o.renderOrder = 10;
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), flat = Math.hypot(b[0] - a[0], b[2] - a[2]), dy = b[1] - a[1];
  const text = `${Math.round(d)}  (flat ${Math.round(flat)}, height ${dy >= 0 ? '+' : ''}${Math.round(dy)})`;
  const el = $('rulerLabel');
  el.hidden = false; el.textContent = text;
  el.style.left = px + 14 + 'px'; el.style.top = py - 10 + 'px';
}
$('ruler').onchange = () => { if (!rulerOn()) showRuler(null); canvas.style.cursor = rulerOn() ? 'crosshair' : ''; };
