// Пережимает assets/raw/*.png → assets/web/ и проверяет общий вес.
// Картинки специально «шакалим»: маленькое разрешение + двойное пережатие JPEG,
// чтобы были настоящие блоки 8×8, звон по краям и грязь, как у найденного в интернете кадра.
// Запуск: npm run optimize
import sharp from 'sharp';
import { readdir, mkdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScratches, renderCreases } from './scratches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(root, 'assets/raw');
const WEB = path.join(root, 'assets/web');
const LIMIT = 5 * 1024 * 1024;

// Общая «шакальность»: 1 — как задумано, больше — чище, меньше — грязнее
const CRUSH = 1;

// ширина и качество JPEG по типу кадра
const rules = [
  { test: /^polaroid/, width: 480, quality: 15 },
  { test: /^arm$/, width: 720, quality: 14 },
  { test: /^note$/, width: 480, quality: 18 },
  { test: /.*/, width: 432, quality: 12 }, // door, door_him, corridor, creature_2 (9:16)
];

// Двойное пережатие: сначала почище и крупнее, потом уменьшить и пережать ещё раз
async function crush(input, out, { width, quality }, prep = (s) => s) {
  const q = Math.min(90, Math.round(quality * CRUSH));
  const first = await prep(sharp(input))
    .resize({ width: Math.round(width * 1.4) })
    .jpeg({ quality: Math.min(90, q * 2), chromaSubsampling: '4:2:0' })
    .toBuffer();
  await sharp(first)
    .resize({ width })
    .jpeg({ quality: q, chromaSubsampling: '4:2:0', mozjpeg: false })
    .toFile(out);
  return (await stat(out)).size;
}

const report = (name, w, size) =>
  console.log(`${name.padEnd(24)} ${String(w).padStart(5)}px  ${(size / 1024).toFixed(0).padStart(5)} KB`);

await mkdir(WEB, { recursive: true });
// убрать прошлую сборку (webp-версии и т.п.)
for (const f of await readdir(WEB)) await rm(path.join(WEB, f));

// creature.png больше не используется — скример на creature_2; wall ушёл вместе с плашками текста
const SKIP = new Set(['creature.png', 'wall.png', 'dust.png']);
const files = (await readdir(RAW)).filter((f) => f.endsWith('.png') && !SKIP.has(f)).sort();
let total = 0;

for (const file of files) {
  const name = path.basename(file, '.png');
  const rule = rules.find((r) => r.test.test(name));
  const size = await crush(path.join(RAW, file), path.join(WEB, `${name}.jpg`), rule);
  total += size;
  report(name, rule.width, size);
}

// Пыль: белые пятна на прозрачном (альфа = яркость) — на телефоне дешевле, чем blend screen
{
  const { data, info } = await sharp(path.join(RAW, 'dust.png')).resize({ width: 1024 }).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.min(255, data[i] * 1.3);
  }
  const out = path.join(WEB, 'dust.webp');
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 70, alphaQuality: 60 }).toFile(out);
  const { size } = await stat(out);
  total += size;
  report('dust (webp, alpha)', 1024, size);
}

// Рука и маленький «наблюдатель» сняты на чёрном: чёрное → прозрачное (без blend-режимов)
async function lumAlpha(input, out, width, { gamma = 1.4, quality = 40 } = {}) {
  const jpg = await sharp(input).resize({ width }).jpeg({ quality, chromaSubsampling: '4:2:0' }).toBuffer();
  const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const r = data[i * info.channels];
    const a = Math.min(255, 255 * Math.pow(r / 255, 1 / gamma) * 1.25);
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = Math.min(255, r * 1.1);
    rgba[i * 4 + 3] = a;
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 55, alphaQuality: 60 }).toFile(out);
  return (await stat(out)).size;
}
for (const [src, name, w, q] of [['arm.png', 'arm_a', 720, 22], ['creature_2.png', 'lurker', 220, 30]]) {
  const size = await lumAlpha(path.join(RAW, src), path.join(WEB, `${name}.webp`), w, { quality: q });
  total += size;
  report(`${name} (webp, alpha)`, w, size);
}

// Размытая копия коридора для «глаза привыкают» — вместо дорогого blur на лету
{
  const out = path.join(WEB, 'corridor_blur.jpg');
  const size = await crush(path.join(RAW, 'corridor.png'), out, { width: 270, quality: 30 }, (s) => s.blur(14));
  total += size;
  report('corridor_blur', 270, size);
}

// Заломы для смятой страницы блокнота
{
  const out = path.join(WEB, 'creases.webp');
  await renderCreases(out);
  const { size } = await stat(out);
  total += size;
  report('creases (webp, alpha)', 600, size);
}

// Стена палаты с нацарапанным именем (scripts/scratches.mjs)
{
  const out = path.join(WEB, 'scratch.webp');
  await renderScratches(out);
  const { size } = await stat(out);
  total += size;
  report('scratch', 420, size);
}

// Блокнот: бумага из листа note.png (без рваного края), вариант B перевёрнут по вертикали.
// Геометрия кропа совпадает с константами PAPER в main.js — меняй вместе.
const paper = { left: 178, top: 455, width: 1240, height: 1845 };
for (const [name, flip] of [['paper_a', false], ['paper_b', true]]) {
  const size = await crush(path.join(RAW, 'note.png'), path.join(WEB, `${name}.jpg`), { width: 560, quality: 26 },
    (s) => (flip ? s.extract(paper).flip() : s.extract(paper)));
  total += size;
  report(name, 620, size);
}

// Текстура JPEG-блоков: шум, убитый до качества 3, в прозрачный PNG
// (тёмные блоки — чёрным, светлые — белым, сила = отклонение от серого)
{
  const W = 192;
  const noise = Buffer.alloc(W * W);
  for (let i = 0; i < noise.length; i++) noise[i] = 128 + Math.round((Math.random() - 0.5) * 140);
  const jpg = await sharp(noise, { raw: { width: W, height: W, channels: 1 } }).jpeg({ quality: 3 }).toBuffer();
  const { data } = await sharp(jpg).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(W * W * 4);
  for (let i = 0; i < W * W; i++) {
    const d = data[i] - 128;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = d < 0 ? 0 : 255;
    rgba[i * 4 + 3] = Math.min(255, Math.abs(d) * 2.2);
  }
  const out = path.join(WEB, 'blocks.png');
  await sharp(rgba, { raw: { width: W, height: W, channels: 4 } }).png({ palette: true }).toFile(out);
  const { size } = await stat(out);
  total += size;
  report('blocks (png, alpha)', W, size);
}

// og-превью 1200×630 из corridor
await sharp(path.join(RAW, 'corridor.png'))
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .jpeg({ quality: 45 })
  .toFile(path.join(WEB, 'og.jpg'));

// favicon: кисть с пальцами из arm (квадратный кроп справа)
const hand = { left: 1600, top: 300, width: 1000, height: 1000 };
for (const [size, file] of [[64, 'favicon.png'], [180, 'apple-touch-icon.png']]) {
  await sharp(path.join(RAW, 'arm.png')).extract(hand).resize(size, size).png().toFile(path.join(WEB, file));
}

const mb = (total / 1024 / 1024).toFixed(2);
console.log(`\nИтого картинки сайта: ${mb} MB (лимит 5 MB) — ${total <= LIMIT ? 'OK' : 'ПРЕВЫШЕН'}`);
if (total > LIMIT) process.exit(1);
