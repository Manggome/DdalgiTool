// macOS 표준 아이콘 그리드에 맞춰 여백을 넣는다.
// 1024 캔버스에서 아이콘 본체는 824x824(약 80%)만 차지해야 이웃 앱들과 크기가 같아 보인다.
// 사용: node build/pad-icon.mjs  (build/icon-fullbleed.png → build/icon.png)
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// 한글 경로가 URL 인코딩되지 않게 fileURLToPath 를 쓴다.
const SRC = fileURLToPath(new URL('./icon-fullbleed.png', import.meta.url));
const DST = fileURLToPath(new URL('./icon.png', import.meta.url));

function decode(file) {
  const f = fs.readFileSync(file);
  let pos = 8;
  const idat = [];
  let w, h, colorType, bitDepth;
  while (pos < f.length) {
    const len = f.readUInt32BE(pos);
    const type = f.toString('ascii', pos + 4, pos + 8);
    const data = f.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`RGBA8 PNG 만 지원 (bitDepth=${bitDepth}, colorType=${colorType})`);
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
  return { w, h, px: out };
}

function encode(file, w, h, px) {
  const bpp = 4, stride = w * bpp + 1;
  const rows = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { rows[y * stride] = 0; px.copy(rows, y * stride + 1, y * w * bpp, (y + 1) * w * bpp); }
  const comp = zlib.deflateSync(rows, { level: 9 });
  function chunk(type, data) {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8);
    const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
    let crc = 0xffffffff; for (const byte of b.subarray(4, 8 + data.length)) crc = T[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length); return b;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', comp), chunk('IEND', Buffer.alloc(0))]));
}

const { w, h, px } = decode(SRC);
const CANVAS = 1024, BODY = 824; // Apple 아이콘 그리드: 1024 중 824

// 원본의 불투명 본체 영역(bbox)을 찾아, 캔버스 여백이 아니라 본체 기준으로 824에 맞춘다
let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
  if (px[(y * w + x) * 4 + 3] > 40) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
const scale = BODY / Math.max(bw, bh); // 본체 긴 변을 824로
const tw = Math.round(bw * scale), th = Math.round(bh * scale);
const offX = Math.round((CANVAS - tw) / 2), offY = Math.round((CANVAS - th) / 2);
const dst = Buffer.alloc(CANVAS * CANVAS * 4); // 전부 투명

// 프리멀티플라이 후 이중선형 축소 — 반투명 가장자리에서 색 번짐 방지
for (let dy = 0; dy < th; dy++) {
  const sy = by0 + ((dy + 0.5) * bh) / th - 0.5;
  const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
  for (let dx = 0; dx < tw; dx++) {
    const sx = bx0 + ((dx + 0.5) * bw) / tw - 0.5;
    const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [yy, wy] of [[y0, 1 - fy], [y1, fy]]) {
      for (const [xx, wx] of [[x0, 1 - fx], [x1, fx]]) {
        const o = (yy * w + xx) * 4, wgt = wy * wx, al = px[o + 3] / 255;
        r += px[o] * al * wgt; g += px[o + 1] * al * wgt; b += px[o + 2] * al * wgt; a += px[o + 3] * wgt;
      }
    }
    const o = ((dy + offY) * CANVAS + (dx + offX)) * 4;
    const al = a / 255;
    dst[o] = al > 0 ? Math.min(255, Math.round(r / al)) : 0;
    dst[o + 1] = al > 0 ? Math.min(255, Math.round(g / al)) : 0;
    dst[o + 2] = al > 0 ? Math.min(255, Math.round(b / al)) : 0;
    dst[o + 3] = Math.min(255, Math.round(a));
  }
}
encode(DST, CANVAS, CANVAS, dst);
console.log(`여백 적용 완료: 본체 ${bw}x${bh} → ${tw}x${th} (${CANVAS} 캔버스, 그리드 ${BODY})`);
