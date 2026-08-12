/**
 * Génère les icônes PNG de l'application (pas de dépendance externe, zlib natif).
 * Usage : node outils/generer-icones.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');

// ---------- encodeur PNG minimal (RGBA, non entrelacé) ----------
const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- dessin ----------
function canvas(size, bg) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255;
  }
  return buf;
}

function px(buf, size, x, y, c) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
}

function rect(buf, size, x0, y0, w, h, c, r = 0) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (r > 0) {
        const cx = x < x0 + r ? x0 + r : x > x0 + w - 1 - r ? x0 + w - 1 - r : x;
        const cy = y < y0 + r ? y0 + r : y > y0 + h - 1 - r ? y0 + h - 1 - r : y;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      }
      px(buf, size, x, y, c);
    }
  }
}

/** Ticket de caisse blanc, bord bas en dents de scie, lignes de texte. */
function drawIcon(size, opts = {}) {
  const bg = opts.bg || [25, 158, 112];     // vert Initiative-neutre
  const ink = [13, 13, 13];
  const paper = [252, 252, 251];
  const buf = canvas(size, bg);
  const u = size / 512;                      // unité de dessin

  const tw = Math.round(232 * u);            // largeur ticket
  const th = Math.round(300 * u);            // hauteur ticket
  const tx = Math.round((size - tw) / 2);
  const ty = Math.round((size - th) / 2 - 6 * u);
  const zig = Math.round(20 * u);            // amplitude dents de scie
  const period = Math.round(38 * u);

  // corps du ticket, bord bas dentelé
  for (let x = tx; x < tx + tw; x++) {
    const t = ((x - tx) % period) / period;
    const d = Math.round(zig * (t < 0.5 ? t * 2 : (1 - t) * 2));
    for (let y = ty; y < ty + th - zig + d; y++) {
      // coins arrondis en haut
      const r = Math.round(16 * u);
      if (y < ty + r) {
        const cx = x < tx + r ? tx + r : x > tx + tw - 1 - r ? tx + tw - 1 - r : x;
        if ((x - cx) ** 2 + (y - (ty + r)) ** 2 > r * r) continue;
      }
      px(buf, size, x, y, paper);
    }
  }

  // lignes de texte
  const lx = tx + Math.round(30 * u);
  const lw = tw - Math.round(60 * u);
  const lh = Math.round(16 * u);
  const widths = [1, 0.78, 0.62, 0.85];
  widths.forEach((f, i) => {
    rect(buf, size, lx, ty + Math.round((52 + i * 40) * u), Math.round(lw * f), lh, ink, Math.round(lh / 2));
  });

  // bloc « total » en évidence
  rect(buf, size, lx, ty + Math.round(218 * u), Math.round(lw * 0.55), Math.round(30 * u), ink, Math.round(8 * u));

  return buf;
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), encodePNG(size, size, drawIcon(size)));
  console.log('icons/icon-' + size + '.png');
}
// variante « maskable » : même dessin, marges plus larges (zone de sécurité Android)
{
  const size = 512;
  const buf = canvas(size, [25, 158, 112]);
  const inner = drawIcon(Math.round(size * 0.72));
  const s2 = Math.round(size * 0.72);
  const off = Math.round((size - s2) / 2);
  for (let y = 0; y < s2; y++) {
    for (let x = 0; x < s2; x++) {
      const i = (y * s2 + x) * 4;
      px(buf, size, x + off, y + off, [inner[i], inner[i + 1], inner[i + 2]]);
    }
  }
  fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), encodePNG(size, size, buf));
  console.log('icons/icon-maskable-512.png');
}
