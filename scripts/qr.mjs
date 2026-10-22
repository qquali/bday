// QR-код для принта на футболке.
// Запуск: npm run qr -- https://ник.github.io/репо/
// Делает qr/qr.svg (для печати) и qr/qr.png 3000×3000, затем декодирует PNG
// и проверяет, что код ведёт ровно на эту ссылку.
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('Укажи ссылку: npm run qr -- https://ник.github.io/репо/');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'qr');
await mkdir(OUT, { recursive: true });

// коррекция H, тихая зона 4 модуля, чёрный на белом
const opts = { errorCorrectionLevel: 'H', margin: 4, color: { dark: '#000000', light: '#ffffff' } };
await writeFile(path.join(OUT, 'qr.svg'), await QRCode.toString(url, { ...opts, type: 'svg' }));
const png = path.join(OUT, 'qr.png');
await QRCode.toFile(png, url, { ...opts, width: 3000 });

// проверка: декодировать то, что получилось
const { data, info } = await sharp(png).resize(1000).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
const meta = await sharp(png).metadata();
console.log(`qr/qr.svg, qr/qr.png ${meta.width}×${meta.height}`);
console.log(`декодировано: ${decoded?.data ?? '— не читается —'}`);
if (decoded?.data !== url) {
  console.error('ОШИБКА: QR не ведёт на нужную ссылку');
  process.exit(1);
}
console.log('OK: ссылка совпадает');
