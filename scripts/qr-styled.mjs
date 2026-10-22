// Стилизованный QR для футболки: неровные «рукописные» точки и скруглённые глазки.
// Запуск: node scripts/qr-styled.mjs https://ник.github.io/репо/
// Делает qr/qr-styled.svg и qr/qr-styled.png 3000×3000, проверяет декодированием
// (в том числе после уменьшения и размытия — как с камеры телефона).
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('Укажи ссылку: node scripts/qr-styled.mjs https://ник.github.io/репо/');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'qr');
await mkdir(OUT, { recursive: true });

const INK = '#0b0b0b';
const PAPER = '#ffffff';
const MARGIN = 4;

const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
const n = qr.modules.size;
const dark = (x, y) => x >= 0 && y >= 0 && x < n && y < n && qr.modules.get(y, x);
const inFinder = (x, y) =>
  (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

// детерминированный «шум», чтобы файл не менялся от запуска к запуску
let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const size = n + MARGIN * 2;
const parts = [];

// точки данных: круги почти во всю клетку, соседние сливаются в «капли».
// Одиночные точки сканер теряет, поэтому без зазоров между соседями.
const data = (x, y) => dark(x, y) && !inFinder(x, y);
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    if (!data(x, y)) continue;
    const cx = MARGIN + x + 0.5, cy = MARGIN + y + 0.5;
    const r = 0.47 + rnd() * 0.03;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(3)}"/>`);
    if (data(x + 1, y)) parts.push(`<rect x="${cx}" y="${cy - 0.47}" width="1" height="0.94"/>`);
    if (data(x, y + 1)) parts.push(`<rect x="${cx - 0.47}" y="${cy}" width="0.94" height="1"/>`);
    // сплошной блок 2×2 — заливаем середину, иначе там просвет
    if (data(x + 1, y) && data(x, y + 1) && data(x + 1, y + 1)) parts.push(`<rect x="${cx}" y="${cy}" width="1" height="1"/>`);
  }
}

// глазки: скруглённая рамка 7×7 + скруглённый квадрат 3×3
for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
  const ox = MARGIN + fx, oy = MARGIN + fy;
  parts.push(
    `<path fill-rule="evenodd" d="${roundRect(ox, oy, 7, 7, 2.2)} ${roundRect(ox + 1, oy + 1, 5, 5, 1.4)}"/>`,
    `<path d="${roundRect(ox + 2, oy + 2, 3, 3, 0.9)}"/>`,
  );
}

function roundRect(x, y, w, h, r) {
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}` +
    `A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}` +
    `V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision">
<rect width="${size}" height="${size}" fill="${PAPER}"/>
<g fill="${INK}">${parts.join('')}</g>
</svg>
`;

const svgPath = path.join(OUT, 'qr-styled.svg');
const pngPath = path.join(OUT, 'qr-styled.png');
await writeFile(svgPath, svg);
await sharp(Buffer.from(svg), { density: 3000 / size * 72 }).resize(3000, 3000).png().toFile(pngPath);

// проверка в нескольких условиях
let ok = true;
for (const [w, blur] of [[1000, 0], [400, 0], [300, 1.2], [220, 0.8]]) {
  let img = sharp(pngPath).resize(w);
  if (blur) img = img.blur(blur);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const got = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
  const pass = got === url;
  ok &&= pass;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${w}px${blur ? ` blur ${blur}` : ''}: ${got ?? '— не читается —'}`);
}
console.log(`qr/qr-styled.svg, qr/qr-styled.png 3000×3000, ${n}×${n} модулей`);
if (!ok) process.exit(1);
