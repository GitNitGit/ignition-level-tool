// Small helpers shared by the editor core (browser and Node).

// Python's round(): halves go to the even neighbour. The level writers were
// ported from Python; using the same rounding keeps the output byte-identical.
export function pyRound(x) {
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return Math.round(x);
}

export const dist2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

// Growable little-endian byte writer.
export class Writer {
  constructor(size = 4096) {
    this.buf = new ArrayBuffer(size);
    this.dv = new DataView(this.buf);
    this.pos = 0;
  }
  ensure(n) {
    if (this.pos + n <= this.buf.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.pos + n));
    new Uint8Array(nb).set(new Uint8Array(this.buf));
    this.buf = nb;
    this.dv = new DataView(nb);
  }
  i32(v) { this.ensure(4); this.dv.setInt32(this.pos, v, true); this.pos += 4; }
  u32(v) { this.ensure(4); this.dv.setUint32(this.pos, v, true); this.pos += 4; }
  i16(v) { this.ensure(2); this.dv.setInt16(this.pos, v, true); this.pos += 2; }
  u16(v) { this.ensure(2); this.dv.setUint16(this.pos, v, true); this.pos += 2; }
  u8(v) { this.ensure(1); this.dv.setUint8(this.pos, v); this.pos += 1; }
  f64(v) { this.ensure(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; }
  bytes(a) { this.ensure(a.length); new Uint8Array(this.buf, this.pos, a.length).set(a); this.pos += a.length; }
  result() { return new Uint8Array(this.buf, 0, this.pos).slice(); }
}
