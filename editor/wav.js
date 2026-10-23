// WAV for the level's sounds (Node): any PCM WAV (8 / 16 / 24 / 32 bit integer or 32 bit float, any channels, any
// rate) is read, mixed to mono and resampled; written is what the game wants (LEVELFORMAT.md ch. 13): RIFF PCM, mono,
// 8 bit unsigned, 11025 Hz, no extra chunks. A gain (per cent) scales the samples about the centre, clipped.
export const GAME_RATE = 11025;

// {rate, channels, bits, float, samples: Float32Array (-1..1, mono)} or an Error
export function decodeWAV(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF WAVE file');
  let fmt = null, data = null, o = 12;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4), start = o + 8;
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(start), channels: b.readUInt16LE(start + 2), rate: b.readUInt32LE(start + 4), bits: b.readUInt16LE(start + 14), sub: len >= 26 ? b.readUInt16LE(start + 24) : null };
    if (id === 'data') data = b.subarray(start, Math.min(b.length, start + len));
    o = start + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('no fmt / data chunk');
  let tag = fmt.tag;
  if (tag === 0xfffe) tag = fmt.sub;                            // WAVE_FORMAT_EXTENSIBLE: the real format follows
  const float = tag === 3;
  if (tag !== 1 && !float) throw new Error(`unsupported WAV format ${fmt.tag} (PCM or float only)`);
  const { channels, rate, bits } = fmt, bytes = bits / 8, frames = Math.floor(data.length / (bytes * channels));
  if (![8, 16, 24, 32].includes(bits) || !channels || !rate) throw new Error(`unsupported WAV: ${bits} bit, ${channels} channels, ${rate} Hz`);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * bytes;
      if (float) s += data.readFloatLE(p);
      else if (bits === 8) s += (data[p] - 128) / 128;
      else if (bits === 16) s += data.readInt16LE(p) / 32768;
      else if (bits === 24) s += ((data[p] | (data[p + 1] << 8) | (data[p + 2] << 16)) << 8 >> 8) / 8388608;
      else s += data.readInt32LE(p) / 2147483648;
    }
    samples[i] = s / channels;
  }
  return { rate, channels, bits, float, samples };
}
// linear resampling to `rate`
export function resample(samples, from, to) {
  if (from === to) return samples;
  const n = Math.max(1, Math.round(samples.length * to / from)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * from / to, k = Math.floor(x), t = x - k, a = samples[Math.min(k, samples.length - 1)], b = samples[Math.min(k + 1, samples.length - 1)];
    out[i] = a + (b - a) * t;
  }
  return out;
}
// the game's WAV: 8 bit unsigned mono at `rate`; gain in per cent
export function encodeWAV8(samples, rate = GAME_RATE, gain = 100) {
  const g = gain / 100, n = samples.length, out = Buffer.alloc(44 + n);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate, 28); out.writeUInt16LE(1, 32); out.writeUInt16LE(8, 34);
  out.write('data', 36); out.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) out[44 + i] = Math.max(0, Math.min(255, Math.round(128 + samples[i] * g * 127)));
  return out;
}
// any WAV -> the game's WAV, with what it was: {wav, info: {seconds, rate, channels, bits, float}}
export function convertWAV(buf, gain = 100) {
  const d = decodeWAV(buf), samples = resample(d.samples, d.rate, GAME_RATE);
  return { wav: encodeWAV8(samples, GAME_RATE, gain), info: { seconds: Math.round(samples.length / GAME_RATE * 100) / 100, rate: d.rate, channels: d.channels, bits: d.bits, float: d.float } };
}
