'use strict';

/**
 * Генератор иконки ГиряGLM без внешних зависимостей.
 * Рисует упрощённую гирю (тело + ручка) акцентным цветом на прозрачном фоне
 * в нескольких размерах и собирает многослойный .ico (ICO + BMP + PNG-like).
 *
 * Использование: node build/icon-gen.js  -> build/icon.ico
 *
 * Реализован минимальный rasterizer: заливка эллипса/прямоугольника попиксельно,
 * запись в формат BMP (для ICO-записи) и PNG (через zlib).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

// ----- Простой RGBA-буфер -----
class Canvas {
  constructor(size) {
    this.size = size;
    this.data = Buffer.alloc(size * size * 4); // RGBA, 0
  }
  setPx(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    // alpha over простое (фон прозрачный)
    const sa = a / 255;
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    this.data[i] = Math.round((r * sa + this.data[i] * da * (1 - sa)) / oa);
    this.data[i + 1] = Math.round((g * sa + this.data[i + 1] * da * (1 - sa)) / oa);
    this.data[i + 2] = Math.round((b * sa + this.data[i + 2] * da * (1 - sa)) / oa);
    this.data[i + 3] = Math.round(oa * 255);
  }
  // Заливка прямоугольника со скруглением.
  fillRoundRect(x0, y0, x1, y1, radius, r, g, b, a = 255) {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        // расстояние до ближайшего края со скруглением
        const dx = Math.max(radius - (x - x0), (x - x1) + radius, 0);
        const dy = Math.max(radius - (y - y0), (y - y1) + radius, 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        let aa = a;
        if (dx > 0 && dy > 0) {
          // сглаживание угла
          aa = dist <= radius ? a : (dist < radius + 1 ? a * (radius + 1 - dist) : 0);
        }
        if (aa > 0) this.setPx(x, y, r, g, b, aa);
      }
    }
  }
  // Заливка эллипса (центр + радиусы).
  fillEllipse(cx, cy, rx, ry, r, g, b, a = 255) {
    const x0 = Math.floor(cx - rx - 1), x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1), y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d = nx * nx + ny * ny;
        if (d <= 1) this.setPx(x, y, r, g, b, a);
        else if (d < 1.15) this.setPx(x, y, r, g, b, a * (1.15 - d) / 0.15);
      }
    }
  }
  // Жирная линия (как загнутая ручка).
  strokeThick(x0, y0, x1, y1, thick, r, g, b, a = 255) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      this.fillEllipse(cx, cy, thick, thick, r, g, b, a);
    }
  }
}

/** Нарисовать гирю заданного размера. */
function drawKettlebell(size) {
  const c = new Canvas(size);
  const s = size;
  // Цвета — акцент индиго из приложения + мягкий блик.
  const main = [99, 102, 241];
  const dark = [76, 79, 184];
  const hi = [165, 180, 252];

  // Тело гири — скруглённый прямоугольник в нижней части.
  const bodyX0 = s * 0.20, bodyX1 = s * 0.80;
  const bodyY0 = s * 0.42, bodyY1 = s * 0.84;
  c.fillRoundRect(bodyX0, bodyY0, bodyX1, bodyY1, s * 0.14, main[0], main[1], main[2]);

  // Нижняя тень (чуть темнее) для объёма.
  c.fillRoundRect(bodyX0, s * 0.66, bodyX1, bodyY1, s * 0.12, dark[0], dark[1], dark[2], 120);

  // Ручка: дуга над телом. Рисуем двумя дугами через толстую обводку по точкам дуги.
  const hCx = s * 0.5, hCy = s * 0.36, hRx = s * 0.16, hRy = s * 0.16;
  const seg = 48;
  for (let i = 0; i <= seg; i++) {
    const ang = Math.PI + (Math.PI * i) / seg; // верхняя полуокружность
    const x = hCx + Math.cos(ang) * hRx;
    const y = hCy + Math.sin(ang) * hRy;
    c.fillEllipse(x, y, s * 0.045, s * 0.045, main[0], main[1], main[2]);
  }
  // Концы ручки «втыкаются» в тело — небольшие утолщения.
  c.fillEllipse(hCx - hRx, hCy, s * 0.06, s * 0.06, main[0], main[1], main[2]);
  c.fillEllipse(hCx + hRx, hCy, s * 0.06, s * 0.06, main[0], main[1], main[2]);

  // Блик на теле.
  c.fillRoundRect(s * 0.26, s * 0.46, s * 0.40, s * 0.52, s * 0.08, hi[0], hi[1], hi[2], 70);

  return c;
}

// ----- Кодирование PNG (для ICO чаще используют PNG, а не BMP) -----
function encodePNG(canvas) {
  const size = canvas.size;
  // Сигнатура
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT: каждая строка начинается с фильтра 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    canvas.data.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// CRC32 для PNG
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ----- Сборка .ico -----
function buildICO(sizes) {
  const images = sizes.map((s) => {
    const canvas = drawKettlebell(s);
    const png = encodePNG(canvas);
    return { size: s, png };
  });

  // Заголовок: 6 байт
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(images.length, 4); // count

  // Каждая директория — 16 байт
  const dirSize = 16 * images.length;
  let offset = 6 + dirSize;
  const dirs = [];
  for (const img of images) {
    const d = Buffer.alloc(16);
    const s = img.size;
    d[0] = s >= 256 ? 0 : s; // width
    d[1] = s >= 256 ? 0 : s; // height
    d[2] = 0; // palette
    d[3] = 0; // reserved
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(img.png.length, 8); // size
    d.writeUInt32LE(offset, 12); // offset
    dirs.push(d);
    offset += img.png.length;
  }

  return Buffer.concat([header, ...dirs, ...images.map((i) => i.png)]);
}

// ----- main -----
const outDir = path.join(__dirname);
const outFile = path.join(outDir, 'icon.ico');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const ico = buildICO(SIZES);
fs.writeFileSync(outFile, ico);
console.log(`✓ icon.ico создан (${ico.length} байт), размеры: ${SIZES.join(', ')}`);

// Заодно PNG для README/превью.
const pngPreview = encodePNG(drawKettlebell(256));
fs.writeFileSync(path.join(outDir, 'icon.png'), pngPreview);
console.log(`✓ icon.png создан (${pngPreview.length} байт)`);
