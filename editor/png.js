// A minimal PNG encoder and decoder (Node): the encoder writes 8-bit RGBA (the texture tiles the editor shows), the
// decoder reads 8-bit greyscale, grey + alpha, RGB, RGBA and palette images without interlacing (the user's own
// textures in data/textures/).
import { deflateSync, inflateSync } from 'node:zlib';

export function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 8, type = 6, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), name = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'PLTE') plte = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth}: only 8 is read`);
  if (interlace) throw new Error('interlaced PNG: not read');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * channels, rgba = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), q = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[q++], line = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const x = raw[q + i], a = i >= channels ? line[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      line[i] = v & 255;
    }
    q += stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, i = x * channels;
      if (type === 6) { rgba[o] = line[i]; rgba[o + 1] = line[i + 1]; rgba[o + 2] = line[i + 2]; rgba[o + 3] = line[i + 3]; }
      else if (type === 2) { rgba[o] = line[i]; rgba[o + 1] = line[i + 1]; rgba[o + 2] = line[i + 2]; rgba[o + 3] = 255; }
      else if (type === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i]; rgba[o + 3] = 255; }
      else if (type === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i]; rgba[o + 3] = line[i + 1]; }
      else { const k = line[i]; rgba[o] = plte ? plte[k * 3] : 0; rgba[o + 1] = plte ? plte[k * 3 + 1] : 0; rgba[o + 2] = plte ? plte[k * 3 + 2] : 0; rgba[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    }
    prev = line;
  }
  return { w, h, rgba };
}

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

export function encodePNG(width, height, rgba) {
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;                         // 8 bits, RGBA
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
