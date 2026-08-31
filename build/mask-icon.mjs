// qlmanage 가 흰색으로 채운 배경을 라운드 스쿼클(88,88,848x848,r=190) 바깥만 투명 처리한다.
// 사용: node build/mask-icon.mjs  (build/icon.png 를 제자리 수정)
import fs from 'node:fs';
import zlib from 'node:zlib';

const SRC = new URL('./icon.png', import.meta.url).pathname;
const f = fs.readFileSync(SRC);
let pos = 8;
const idat = [];
let w, h;
while (pos < f.length) {
  const len = f.readUInt32BE(pos);
  const type = f.toString('ascii', pos + 4, pos + 8);
  const data = f.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
  if (type === 'IDAT') idat.push(data);
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = 4, stride = w * bpp + 1;
const out = Buffer.alloc(w * h * bpp);
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
for (let y = 0; y < h; y++) {
  const ft = raw[y * stride];
  for (let x = 0; x < w * bpp; x++) {
    const i = y * stride + 1 + x, o = y * w * bpp + x;
    const L = x >= bpp ? out[o - bpp] : 0, U = y > 0 ? out[o - w * bpp] : 0, UL = x >= bpp && y > 0 ? out[o - w * bpp - bpp] : 0;
    let v = raw[i];
    if (ft === 1) v += L; else if (ft === 2) v += U; else if (ft === 3) v += (L + U) >> 1; else if (ft === 4) v += paeth(L, U, UL);
    out[o] = v & 0xff;
  }
}
const X = 88, Y = 88, W = 848, H = 848, R = 190;
function sd(px, py) {
  if (px >= X + R && px <= X + W - R) return Math.max(Y - py, py - (Y + H));
  if (py >= Y + R && py <= Y + H - R) return Math.max(X - px, px - (X + W));
  const cx = Math.max(X + R, Math.min(px, X + W - R));
  const cy = Math.max(Y + R, Math.min(py, Y + H - R));
  return Math.hypot(px - cx, py - cy) - R;
}
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const d = sd(x + 0.5, y + 0.5);
    const o = (y * w + x) * 4;
    if (d > 1) out[o + 3] = 0;
    else if (d > -1) out[o + 3] = Math.round(out[o + 3] * (1 - (d + 1) / 2));
  }
const rows = Buffer.alloc(h * stride);
for (let y = 0; y < h; y++) { rows[y * stride] = 0; out.copy(rows, y * stride + 1, y * w * bpp, (y + 1) * w * bpp); }
const comp = zlib.deflateSync(rows, { level: 9 });
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8);
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  let crc = 0xffffffff; for (const byte of b.subarray(4, 8 + data.length)) crc = T[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length); return b;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(SRC, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', comp), chunk('IEND', Buffer.alloc(0))]));
console.log('마스크 적용 완료');
