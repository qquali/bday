// Рисунок для 4-й страницы блокнота: стена палаты 107, на которой ногтями
// много раз процарапано одно слово. Генерируется как SVG, рендерится sharp и
// пережимается в грязный JPEG (белый фон — на странице кладётся через multiply).
import sharp from 'sharp';

let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const r01 = () => (rnd() + 1) / 2;

// Буквы в коробке 10×14, каждая — набор штрихов
const ellipse = (cx, cy, rx, ry, n = 16) =>
  [...Array(n + 2)].map((_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
const GLYPHS = {
  С: [[[9, 2.5], [7, 0.5], [4, 0.3], [1.5, 2], [0.3, 6], [0.6, 10], [2.5, 13.2], [6, 13.8], [9, 12]]],
  О: [ellipse(5, 7, 4.6, 6.8)],
  Ф: [[[5, -1.5], [5, 15.5]], ellipse(5, 6.5, 4.8, 3.6)],
  А: [[[0.2, 14], [5, 0], [9.8, 14]], [[2.2, 9], [7.8, 9]]],
};

// Царапина: дрожащая ломаная, повторённая несколько раз рядом, со светлым «задиром» бумаги
function scratchPath(pts, jitter) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / 3));
    for (let s = i === 0 ? 0 : 1; s <= n; s++) {
      const t = s / n;
      const x = x0 + (x1 - x0) * t + rnd() * jitter;
      const y = y0 + (y1 - y0) * t + rnd() * jitter;
      d += `${d ? ' L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  return d;
}

function word(out, text, cx, cy, size, rot, { press = 1, passes = 3, messy = 0 } = {}) {
  const s = size / 14;
  const a = (rot * Math.PI) / 180;
  const width = (text.length * 13 - 3) * s;
  // у каждой буквы свой размер, наклон и прыжок по высоте — рука не держит строку
  const letters = [...text].map(() => ({ k: 1 + rnd() * 0.22 * (1 + messy), dy: rnd() * 2.2 * messy, tilt: rnd() * 0.25 * (0.5 + messy) }));
  const tf = ([gx, gy], i) => {
    const L = letters[i];
    const qx = (gx - 5) * L.k;
    const qy = (gy - 7) * L.k;
    const rx = qx * Math.cos(L.tilt) - qy * Math.sin(L.tilt) + 5;
    const ry = qx * Math.sin(L.tilt) + qy * Math.cos(L.tilt) + 7 + L.dy;
    const lx = i * 13 * s + rx * s - width / 2 + rnd() * messy * 0.5 * s;
    const ly = ry * s - size / 2 + rnd() * messy * 0.5 * s;
    return [cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a)];
  };
  [...text].forEach((ch, i) => {
    (GLYPHS[ch] || []).forEach((stroke) => {
      const pts = stroke.map((p) => tf(p, i));
      // перебор на конце — ноготь срывается
      const [p0, p1] = [pts[pts.length - 2], pts[pts.length - 1]];
      const k = (0.15 + r01() * 0.35) * (1 + messy);
      pts.push([p1[0] + (p1[0] - p0[0]) * k, p1[1] + (p1[1] - p0[1]) * k]);
      for (let p = 0; p < passes; p++) {
        // ноготь проходит почти по тому же месту — сдвиг в пикселях, не в размере буквы
        const spread = 0.8 + s * 0.16;
        const ox = rnd() * spread;
        const oy = rnd() * spread;
        const moved = pts.map(([x, y]) => [x + ox, y + oy]);
        const w = (0.5 + r01() * 0.9) * press;
        const op = 0.5 + r01() * 0.45;
        out.push(`<path d="${scratchPath(moved, 0.45 + s * 0.06)}" stroke="#14110e" stroke-width="${w.toFixed(2)}" opacity="${op.toFixed(2)}"/>`);
        if (p % 2 === 0) out.push(`<path d="${scratchPath(moved.map(([x, y]) => [x + 0.8, y + 0.6]), 0.4)}" stroke="#fffaf0" stroke-width="${(w * 0.35).toFixed(2)}" opacity=".45"/>`);
      }
    });
  });
}

export function scratchesSVG(W = 640, H = 420) {
  const out = [];
  // Грязь: размазанные пятна графита, следы пальцев, потёки вниз
  const grime = [];
  for (let i = 0; i < 22; i++) {
    const x = r01() * W;
    const y = r01() * H;
    grime.push(`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(6 + r01() * 22).toFixed(0)}" ry="${(4 + r01() * 12).toFixed(0)}"
      fill="#1f1a14" opacity="${(0.18 + r01() * 0.3).toFixed(2)}" transform="rotate(${(rnd() * 40).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`);
  }
  for (let i = 0; i < 9; i++) {
    const x = 40 + r01() * (W - 80);
    const y = 40 + r01() * (H * 0.5);
    grime.push(`<path d="M${x} ${y} q${rnd() * 10} ${60 + r01() * 80} ${rnd() * 14} ${120 + r01() * 160}" stroke="#1e1a15"
      stroke-width="${(6 + r01() * 12).toFixed(0)}" opacity="${(0.12 + r01() * 0.18).toFixed(2)}" fill="none"/>`);
  }
  // Слово: от мелкого аккуратного к крупному и бешеному
  const words = [];
  // навязчиво, мелко, по всей стене — чем ниже, тем грязнее
  for (let i = 0; i < 34; i++) {
    const y = 18 + r01() * (H - 36);
    const k = y / H;
    words.push([20 + r01() * (W - 40), y, 9 + r01() * 14 + k * 8, rnd() * (10 + k * 30), { press: 0.8 + k * 0.5, passes: 3 + Math.round(k * 3), messy: 0.2 + k * 0.9 }]);
  }
  words.push([320, 215, 118, -5, { press: 1.9, passes: 9, messy: 0.9 }]); // главное — огромное, продавленное
  words.forEach(([x, y, sz, r, o]) => word(out, 'СОФА', x, y, sz, r, o));
  // одно слово зачиркано до черноты
  {
    const zx = 470;
    const zy = 70;
    word(out, 'СОФА', zx, zy, 30, 6, { press: 1, passes: 3, messy: 0.5 });
    let d = '';
    for (let i = 0; i < 46; i++) d += `${i ? ' L' : 'M'}${(zx - 62 + i * 2.8 + rnd() * 2).toFixed(1)} ${(zy + (i % 2 ? -18 : 18) + rnd() * 4).toFixed(1)}`;
    out.push(`<path d="${d}" stroke="#0d0b09" stroke-width="2.6" opacity=".9"/>`);
  }
  // Счёт ночей зарубками
  for (let g = 0; g < 4; g++) {
    const gx = 520 + g * 26;
    const gy = 395;
    for (let i = 0; i < 4; i++) out.push(`<path d="${scratchPath([[gx + i * 4, gy - 22], [gx + i * 4 + 1, gy]], 0.6)}" stroke="#14110e" stroke-width="1.4" opacity=".8"/>`);
    out.push(`<path d="${scratchPath([[gx - 3, gy - 4], [gx + 17, gy - 18]], 0.6)}" stroke="#14110e" stroke-width="1.4" opacity=".8"/>`);
  }
  // Следы ногтей — по четыре
  for (let k = 0; k < 7; k++) {
    const x = r01() * W;
    const y = r01() * H;
    const len = 30 + r01() * 70;
    const ang = (60 + rnd() * 30) * (Math.PI / 180);
    for (let i = 0; i < 4; i++) {
      const sx = x + i * 6;
      out.push(`<path d="${scratchPath([[sx, y], [sx + Math.cos(ang) * len * 0.3, y + Math.sin(ang) * len]], 0.9)}" stroke="#14110e" stroke-width="${(1 + r01()).toFixed(1)}" opacity="${(0.5 + r01() * 0.4).toFixed(2)}"/>`);
    }
  }
  // Мелкий мусор
  for (let i = 0; i < 260; i++) {
    out.push(`<circle cx="${(r01() * W).toFixed(1)}" cy="${(r01() * H).toFixed(1)}" r="${(0.3 + r01() * 1.4).toFixed(1)}" fill="#1a1612" opacity="${(0.2 + r01() * 0.6).toFixed(2)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><filter id="smear" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#fff"/>
    <g filter="url(#smear)">${grime.join('')}</g>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">${out.join('')}</g>
  </svg>`;
}

// Рендер + шум + двойное пережатие
export async function renderScratches(outFile) {
  const W = 640;
  const H = 420;
  const png = await sharp(Buffer.from(scratchesSVG(W, H))).png().toBuffer();
  const noise = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    noise[i * 4] = noise[i * 4 + 1] = noise[i * 4 + 2] = v;
    noise[i * 4 + 3] = Math.random() < 0.06 ? 40 : 0;
  }
  const dirty = await sharp(png)
    .composite([{ input: noise, raw: { width: W, height: H, channels: 4 } }])
    .greyscale()
    .jpeg({ quality: 30 })
    .toBuffer();
  const crushed = await sharp(dirty).resize({ width: 420 }).jpeg({ quality: 16, chromaSubsampling: '4:2:0' }).toBuffer();
  // тёмное → непрозрачное: рисунок ложится на бумагу без blend-режима (дешевле на телефоне)
  const { data, info } = await sharp(crushed).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    rgba[i * 4] = 21;
    rgba[i * 4 + 1] = 17;
    rgba[i * 4 + 2] = 13;
    rgba[i * 4 + 3] = Math.min(255, Math.max(0, (255 - data[i]) * 1.15));
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 60, alphaQuality: 70 }).toFile(outFile);
}

// Заломы смятой бумаги: грани светлые/тёмные + линии сгибов, на прозрачном.
// Кладётся поверх страницы блокнота, пока её комкают.
export async function renderCreases(outFile) {
  const W = 600;
  const H = 900;
  const out = [];
  for (let i = 0; i < 70; i++) {
    const cx = r01() * W;
    const cy = r01() * H;
    const n = 3 + Math.floor(r01() * 2);
    const pts = [...Array(n)].map(() => `${(cx + rnd() * 160).toFixed(0)},${(cy + rnd() * 160).toFixed(0)}`).join(' ');
    const light = r01() < 0.45;
    out.push(`<polygon points="${pts}" fill="${light ? '#fff' : '#000'}" opacity="${(0.05 + r01() * (light ? 0.18 : 0.26)).toFixed(2)}"/>`);
  }
  for (let i = 0; i < 46; i++) {
    const x = r01() * W;
    const y = r01() * H;
    const a = r01() * Math.PI;
    const len = 120 + r01() * 520;
    const pts = [[x - Math.cos(a) * len / 2, y - Math.sin(a) * len / 2]];
    for (let k = 1; k <= 4; k++) pts.push([pts[0][0] + Math.cos(a) * len * k / 4 + rnd() * 18, pts[0][1] + Math.sin(a) * len * k / 4 + rnd() * 18]);
    const d = pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(0)} ${py.toFixed(0)}`).join(' ');
    out.push(`<path d="${d}" stroke="#000" stroke-width="${(1 + r01() * 2).toFixed(1)}" opacity="${(0.25 + r01() * 0.3).toFixed(2)}" fill="none"/>`);
    out.push(`<path d="${d}" transform="translate(1.5 1)" stroke="#fff" stroke-width="1" opacity="${(0.3 + r01() * 0.35).toFixed(2)}" fill="none"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${out.join('')}</svg>`;
  await sharp(Buffer.from(svg)).webp({ quality: 55, alphaQuality: 55 }).toFile(outFile);
}
