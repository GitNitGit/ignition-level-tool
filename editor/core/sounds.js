// Sounds (the Sounds tab): the level's own sounds and where they play. level.sounds = [{id, name, gain (%), info}]
// (the WAV lives beside the level, levels/<name>/sound/<id>.wav, converted to the game's format by the server);
// level.soundSources = [{id, sound: <sound id>, x, y, z} | {id, sound, object: <object id>, off: [dx, dy, dz]}] - a
// source stands at a point or rides on a placed object (and on its animation path). The game plays a sound as an
// ambient loop from a marker placement of type 144 + slot (LEVELFORMAT.md ch. 13, 15): the slot is the number the
// file in the level's Sound folder starts with. Own sounds take the slots from SLOT_FIRST on in the order of
// level.sounds (the originals' files of the copied folder use lower ones; a colliding original is left out).
import { animEntryOf, poseAt } from './anim.js';

// The game plays sound markers only up to type 157 = slot 13 (a slot-20 marker, type 164, crashed the game, tested
// in the game). Slots 0-2 stay free for the slot's weather sounds (Canada: rain, thunder, lightning are 00-02).
export const SLOT_FIRST = 3, SLOT_MAX = 13;
export const MARKER_TYPE = 144;
export const soundOf = (level, id) => (level.sounds || []).find(s => s.id === id) || null;
export const soundSlots = level => new Map((level.sounds || []).map((s, i) => [s.id, SLOT_FIRST + i]));
export const safeName = name => String(name || 'sound').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 24) || 'sound';
export const soundFileName = (sound, slot) => `${String(slot).padStart(2, '0')}_${safeName(sound.name)}.wav`;
export function newId(list, prefix) {
  const used = new Set((list || []).map(x => x.id));
  let id;
  do id = prefix + Math.random().toString(36).slice(2, 8); while (used.has(id));
  return id;
}
// where a source stands (game coordinates): its own point, or its object's placement (the pose at t = 0 when it
// is animated) plus the offset
export function sourcePosition(level, src) {
  if (!src.object) return [src.x, src.y, src.z];
  const o = (level.objects || []).find(x => x.id === src.object);
  if (!o) return [src.x ?? 0, src.y ?? 0, src.z ?? 0];
  const ae = animEntryOf(level, o.id), p = ae && poseAt(ae.entry, 0), base = p ? p.pos : [o.x, o.y, o.z], off = src.off || [0, 0, 0];
  return [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
}
// the markers the compiler places: [{src, sound, slot, pos, object (the placed object it rides on, or null)}]
export function soundMarkers(level) {
  const slots = soundSlots(level), out = [];
  for (const src of level.soundSources || []) {
    const sound = soundOf(level, src.sound);
    if (!sound) continue;
    const o = src.object ? (level.objects || []).find(x => x.id === src.object) || null : null;
    out.push({ src, sound, slot: slots.get(sound.id), pos: sourcePosition(level, src), object: o });
  }
  return out;
}
