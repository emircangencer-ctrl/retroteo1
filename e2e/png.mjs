// Minimal PNG decoder for Playwright screenshots (8-bit RGB/RGBA, non-interlaced) — used to measure
// how game pixels land on screen without extra dependencies.
import { inflateSync } from 'node:zlib';

export function decodePng(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('not a PNG');
  let offset = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('unsupported PNG colour type');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return {
    width, height,
    luminance: (x, y) => { const i = y * stride + x * channels; return (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000; },
    rgb: (x, y) => { const i = y * stride + x * channels; return [pixels[i], pixels[i + 1], pixels[i + 2]]; }
  };
}

/** Widths of the runs of light/dark pixels along one screen row (first and last run dropped). */
export function rowRuns(image, y) {
  const runs = [];
  let current = null, length = 0;
  for (let x = 0; x < image.width; x++) {
    const light = image.luminance(x, y) > 128;
    if (light === current) length++;
    else { if (current !== null) runs.push(length); current = light; length = 1; }
  }
  runs.push(length);
  return runs.slice(1, -1);
}
