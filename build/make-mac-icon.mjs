// macOS 용 아이콘 생성: 모서리까지 채운 정사각형 아트를 만들면
// macOS 26 이 직접 규격 스쿼클로 잘라 준다 (회색 판 없음 — 파인더·독·DMG 전부).
// 사용: node build/make-mac-icon.mjs  (build/icon-fullbleed.png → build/icon-mac.png)
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('./icon-fullbleed.png', import.meta.url));
const DST = fileURLToPath(new URL('./icon-mac.png', import.meta.url));
const GLYPH_SCALE = 0.80; // 원본 전체를 이 배율로 축소해 중앙 배치 (독에서 승인된 비율과 동일)

function decode(file) {
  const f = fs.readFileSync(file);
  let pos = 8; const idat = []; let w, h, colorType, bitDepth;
  while (pos < f.length) {
    const len = f.readUInt32BE(pos);
    const type = f.toString('ascii', pos + 4, pos + 8);
    const data = f.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
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
const C = 1024;

// 배경 빨강 샘플 (본체 안 왼쪽 중앙)
const so = (Math.floor(h / 2) * w + 200) * 4;
const R = px[so], G = px[so + 1], B = px[so + 2];

// 글리프(크림색 딸기+커서) 레이어 추출 — 빨강(G,B 낮음)과 크림(G,B 높음)을 채도로 분리
const glyph = Buffer.alloc(w * h * 4);
for (let i = 0; i < w * h; i++) {
  const o = i * 4;
  if (px[o + 3] < 40) continue;
  const a = Math.max(0, Math.min(1, ((px[o + 1] + px[o + 2]) / 2 - 100) / 100));
  if (a > 0) {
    glyph[o] = px[o]; glyph[o + 1] = px[o + 1]; glyph[o + 2] = px[o + 2];
    glyph[o + 3] = Math.round(a * 255 * (px[o + 3] / 255));
  }
}

// 전체 빨강 캔버스 + 글리프 중앙 합성
const dst = Buffer.alloc(C * C * 4);
for (let i = 0; i < C * C; i++) { const o = i * 4; dst[o] = R; dst[o + 1] = G; dst[o + 2] = B; dst[o + 3] = 255; }
const t = Math.round(w * GLYPH_SCALE), off = Math.round((C - t) / 2);
for (let dy = 0; dy < t; dy++) {
  const sy = Math.min(h - 1, Math.max(0, Math.round((dy + 0.5) / GLYPH_SCALE - 0.5)));
  for (let dx = 0; dx < t; dx++) {
    const sx = Math.min(w - 1, Math.max(0, Math.round((dx + 0.5) / GLYPH_SCALE - 0.5)));
    const s = (sy * w + sx) * 4, a = glyph[s + 3] / 255;
    if (a === 0) continue;
    const d = ((dy + off) * C + (dx + off)) * 4;
    dst[d] = Math.round(glyph[s] * a + dst[d] * (1 - a));
    dst[d + 1] = Math.round(glyph[s + 1] * a + dst[d + 1] * (1 - a));
    dst[d + 2] = Math.round(glyph[s + 2] * a + dst[d + 2] * (1 - a));
  }
}
encode(DST, C, C, dst);
console.log(`icon-mac.png 생성: 정사각 풀블리드, 배경 rgb(${R},${G},${B}), 글리프 ${GLYPH_SCALE * 100}%`);
