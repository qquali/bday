// Детские рисунки карандашом внизу страниц блокнота.
// Каждая линия дрожит и проскакивает концы — как рисует ребёнок.
// Рисунок собирается в трёх чуть разных вариантах (слои .boil-0/1/2): если быстро их
// перещёлкивать, линии «кипят» и дёргаются. Красным — кровь и красный карандаш.
// page — номер страницы с нуля; align — где прижать рисунок по ширине.
(() => {
  'use strict';

  let seed = 1013;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const r01 = () => (rnd() + 1) / 2;

  const INK = '#3a3430';
  const RED = '#8e0c0c';

  // Простой «рисовальщик»: копит пути и отдаёт их строкой
  function sketch() {
    const out = [];
    let order = 0; // порядок прорисовки линий

    // Дрожащая линия через точки; overshoot — линия чуть проскакивает конец
    function line(pts, { width = 1.9, opacity = 0.85, jitter = 0.8, overshoot = 2.5, color = INK } = {}) {
      const P = pts.map(([x, y]) => [x, y]);
      if (overshoot && P.length > 1) {
        const [a, b] = [P[P.length - 2], P[P.length - 1]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const k = (overshoot * (0.6 + r01() * 0.8)) / len;
        P.push([b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k]);
      }
      let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
      let drift = 0;
      for (let i = 1; i < P.length; i++) {
        const [x0, y0] = P[i - 1];
        const [x1, y1] = P[i];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(len / 5));
        const nx = -(y1 - y0) / (len || 1);
        const ny = (x1 - x0) / (len || 1);
        for (let s = 1; s <= n; s++) {
          const t = s / n;
          drift = drift * 0.6 + rnd() * jitter;
          d += ` L${(x0 + (x1 - x0) * t + nx * drift).toFixed(1)} ${(y0 + (y1 - y0) * t + ny * drift).toFixed(1)}`;
        }
      }
      out.push(`<path class="ln" d="${d}" pathLength="1" style="--d:${order++}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`);
    }

    // Кривой овал, который не замыкается ровно — конец заходит за начало
    function ellipse(cx, cy, rx, ry, opts = {}) {
      const pts = [];
      const start = rnd() * Math.PI;
      const steps = 22;
      for (let i = 0; i <= steps + 3; i++) {
        const a = start + (i / steps) * Math.PI * 2;
        const wob = 1 + rnd() * 0.07;
        pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
      }
      line(pts, { overshoot: 0, ...opts });
    }
    const circle = (cx, cy, r, opts) => ellipse(cx, cy, r, r, opts);

    // Злая штриховка карандашом: зигзаг туда-обратно
    function scribble(x, y, w2, h2, { step = 2.2, width = 1.3, opacity = 0.85, passes = 2, color = INK } = {}) {
      for (let p = 0; p < passes; p++) {
        const pts = [];
        let up = p % 2 === 0;
        for (let xx = x; xx <= x + w2; xx += step * (0.7 + r01() * 0.6)) {
          pts.push([xx + rnd() * 1.5, up ? y + rnd() * 2 : y + h2 + rnd() * 2]);
          up = !up;
        }
        line(pts, { width, opacity, jitter: 0.5, overshoot: 0, color });
      }
    }

    // Пальцы: несколько длинных тонких линий из одной точки
    function fingers(x, y, tips, opts = {}) {
      tips.forEach(([tx, ty]) => {
        const mx = (x + tx) / 2 + rnd() * 2;
        const my = (y + ty) / 2 + rnd() * 2;
        line([[x, y], [mx, my], [tx, ty]], { width: 1.35, overshoot: 1.5, ...opts });
      });
    }

    // Капля-слеза
    function tear(x, y, s = 1, color = INK) {
      out.push(`<path d="M${x} ${y} q${3 * s} ${6 * s} 0 ${8.5 * s} q${-3 * s} ${-2.5 * s} 0 ${-8.5 * s}" class="ln" pathLength="1" style="--d:${order++}"
        stroke="${color}" fill="${color === RED ? RED : 'none'}" fill-opacity=".6" stroke-width="1.1" opacity=".85"/>`);
    }

    // Потёк крови: линия вниз с каплей на конце
    function drip(x, y, len, w = 2.2) {
      const wob = rnd() * 3;
      out.push(`<path d="M${x} ${y} q${wob.toFixed(1)} ${(len * 0.5).toFixed(1)} ${(rnd() * 2).toFixed(1)} ${len}" class="ln" pathLength="1" style="--d:${order++}"
        stroke="${RED}" stroke-width="${w}" opacity=".85"/>`);
      out.push(`<circle class="blob" style="--d:${order}" cx="${(x + rnd() * 1.5).toFixed(1)}" cy="${(y + len + w * 0.6).toFixed(1)}" r="${(w * 1.15).toFixed(1)}" fill="${RED}" stroke="none" opacity=".85"/>`);
    }

    // Размазанное красное пятно
    function smear(x, y, w2, h2, rot = 0) {
      out.push(`<ellipse class="blob" style="--d:${order++}" cx="${x}" cy="${y}" rx="${w2}" ry="${h2}" fill="${RED}" stroke="none"
        opacity=".55" transform="rotate(${rot} ${x} ${y})"/>`);
    }

    // Буквы, выцарапанные как получится
    function scratch(text, x, y, size, rot, opacity = 0.8) {
      out.push(`<text class="blob" style="--d:${order++}" x="${x}" y="${y}" font-size="${size}" transform="rotate(${rot} ${x} ${y})" opacity="${opacity}"
        fill="none" stroke="${INK}" stroke-width="${(size / 16).toFixed(2)}" font-family="Caveat, cursive" font-weight="700"
        letter-spacing="1">${text}</text>`);
    }

    function dot(x, y, r, fill = INK) {
      out.push(`<circle class="blob" style="--d:${order++}" cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="none"/>`);
    }

    return { line, ellipse, circle, scribble, fingers, tear, drip, smear, scratch, dot, inner: () => out.join('') };
  }

  // Собрать рисунок из трёх вариантов (разное дрожание линий)
  function doodle(w, h, draw, { under = '' } = {}) {
    const base = seed;
    const layers = [0, 1, 2].map((k) => {
      seed = base + k * 977 + 1;
      const s = sketch();
      draw(s);
      return `<g class="boil boil-${k}">${s.inner()}</g>`;
    });
    seed = base + 5003;
    return `<svg viewBox="0 0 ${w} ${h}" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${under}${layers.join('')}</svg>`;
  }

  const doodles = [];

  // Стр. 1: коридор отделения, в конце дверь 107, из темноты — красные глаза и руки к девочке с ключами
  doodles.push({
    page: 0,
    align: 'center',
    svg: doodle(300, 190, (s) => {
      s.line([[22, 4], [124, 58]], { opacity: 0.55 });
      s.line([[278, 4], [176, 58]], { opacity: 0.55 });
      s.line([[22, 186], [124, 118]], { opacity: 0.55 });
      s.line([[278, 186], [176, 118]], { opacity: 0.55 });
      s.line([[124, 58], [176, 58], [176, 118], [124, 118], [124, 58]], { opacity: 0.6 });
      s.line([[94, 186], [137, 118]], { opacity: 0.3, width: 1 });
      s.line([[206, 186], [163, 118]], { opacity: 0.3, width: 1 });
      s.line([[136, 118], [136, 72], [164, 72], [164, 118]], { width: 1.7 });
      s.scratch('107', 141, 68, 9, -4, 0.7);
      s.scribble(137, 74, 26, 43, { passes: 3 });
      s.dot(146, 86, 2, RED);
      s.dot(154, 85, 2, RED);
      // руки ползут по полу
      s.line([[140, 96], [131, 112], [118, 130], [102, 147], [88, 160]], { width: 1.6 });
      s.fingers(88, 160, [[70, 164], [72, 170], [78, 175], [86, 178]]);
      s.line([[160, 96], [170, 113], [184, 131], [198, 148], [212, 160]], { width: 1.6 });
      s.fingers(212, 160, [[230, 163], [229, 169], [224, 174], [216, 178]]);
      s.scribble(66, 162, 12, 6, { color: RED, width: 1, passes: 1, opacity: 0.7 });
      // девочка с ключами
      s.circle(46, 122, 8);
      s.line([[52, 116], [60, 121], [58, 131]], { width: 1.2 });
      s.dot(43, 121, 0.9);
      s.dot(49, 121, 0.9);
      s.line([[43, 126], [49, 126]], { width: 1, overshoot: 0 });
      s.line([[46, 130], [36, 158], [56, 158], [46, 130]]);
      s.line([[42, 158], [41, 172]]);
      s.line([[50, 158], [51, 172]]);
      s.line([[43, 138], [33, 148]]);
      s.line([[49, 138], [60, 145]]);
      s.circle(63, 148, 3, { width: 1.1 });
      s.line([[64, 151], [66, 157]], { width: 1, overshoot: 0 });
    }),
  });

  // Стр. 2: он сидит в углу лицом к стене и плачет — красными слезами
  doodles.push({
    page: 1,
    align: 'right',
    svg: doodle(300, 150, (s) => {
      s.line([[150, 6], [150, 104]], { opacity: 0.55 });
      s.line([[150, 104], [36, 148]], { opacity: 0.55 });
      s.line([[150, 104], [270, 146]], { opacity: 0.55 });
      s.ellipse(152, 82, 21, 27, { width: 1.6 });
      s.circle(150, 48, 11, { width: 1.6 });
      for (let i = 0; i < 7; i++) s.line([[141 + i * 3, 40], [139 + i * 3.4, 60]], { width: 1, opacity: 0.7, overshoot: 0 });
      s.line([[136, 62], [124, 90], [110, 116], [98, 132]], { width: 1.5 });
      s.fingers(98, 132, [[82, 134], [83, 140], [88, 144], [95, 146]]);
      s.line([[168, 62], [182, 90], [196, 116], [208, 130]], { width: 1.5 });
      s.fingers(208, 130, [[224, 131], [223, 137], [218, 142], [211, 144]]);
      s.tear(122, 34, 1, RED);
      s.tear(178, 30, 1, RED);
      s.tear(126, 52, 0.8, RED);
      s.tear(182, 50, 0.8, RED);
      s.tear(116, 70, 0.7, RED);
      s.smear(150, 100, 14, 3, -4);
      s.line([[110, 22], [104, 14]], { width: 1 });
      s.line([[190, 20], [197, 12]], { width: 1 });
      s.line([[150, 22], [150, 12]], { width: 1 });
    }),
  });

  // Стр. 3: она читает ему у двери, а из-под двери тянутся окровавленные пальцы
  doodles.push({
    page: 2,
    align: 'center',
    svg: doodle(300, 190, (s) => {
      s.line([[6, 172], [294, 172]], { opacity: 0.6 });
      s.line([[152, 171], [152, 10], [250, 10], [250, 171]], { width: 1.7 });
      s.scribble(176, 29, 50, 33, { passes: 2, opacity: 0.6 });
      s.line([[175, 28], [227, 28], [227, 63], [175, 63], [175, 28]], { width: 1.4 });
      [186, 196, 206, 216].forEach((x) => s.line([[x, 28], [x, 63]], { width: 1.6, overshoot: 0 }));
      s.dot(196, 44, 1.8, RED);
      s.dot(206, 45, 1.8, RED);
      s.scratch('107', 186, 84, 13, 3, 0.75);
      s.circle(162, 104, 3, { width: 1.2 });
      // пальцы из-под двери и красный след за ними
      s.smear(150, 180, 30, 4, 4);
      s.fingers(170, 171, [[112, 175], [116, 180], [125, 185], [140, 188], [155, 189]], { width: 1.2 });
      [[112, 175], [116, 180], [125, 185]].forEach(([x, y]) => s.dot(x, y, 1.6, RED));
      // девочка с книжкой
      s.circle(96, 110, 9);
      s.line([[90, 104], [86, 122]], { width: 1, opacity: 0.7 });
      s.line([[102, 104], [106, 122]], { width: 1, opacity: 0.7 });
      s.dot(93, 112, 0.9);
      s.dot(99, 112, 0.9);
      s.line([[96, 119], [82, 150], [110, 150], [96, 119]]);
      s.line([[86, 150], [62, 166], [50, 166]]);
      s.line([[104, 150], [82, 168], [68, 168]]);
      s.line([[84, 140], [98, 134], [112, 140], [98, 146], [84, 140]], { width: 1.3 });
      s.line([[98, 134], [98, 146]], { width: 1, overshoot: 0 });
      s.line([[92, 128], [86, 139]], { width: 1.2 });
      s.line([[100, 128], [110, 139]], { width: 1.2 });
    }),
  });

  // Стр. 4: стена палаты 107 — имя, процарапанное ногтями (картинка из scripts/scratches.mjs),
  // поверх — кровь, стекающая с главного слова, и свежие царапины
  doodles.push({
    page: 3,
    align: 'center',
    svg: doodle(640, 420, (s) => {
      [[140, 268, 60], [196, 272, 110], [262, 266, 44], [318, 276, 130], [384, 268, 70], [452, 272, 96], [508, 262, 52]]
        .forEach(([x, y, len]) => s.drip(x, y, len, 2.6));
      for (let i = 0; i < 4; i++) s.line([[548 + i * 9, 96], [572 + i * 9, 170]], { color: RED, width: 2.4, opacity: 0.8, overshoot: 4 });
      s.smear(330, 214, 70, 9, -6);
      s.smear(560, 182, 18, 5, 70);
    }, { under: '<image class="nb__scratch" href="assets/web/scratch.webp" width="640" height="420"/>' }),
  });

  // Стр. 5: маленькое лицо, заштрихованное до черноты; сквозь штриховку — красные глаза
  doodles.push({
    page: 4,
    align: 'right',
    maxW: 0.42,
    svg: doodle(140, 160, (s) => {
      s.circle(74, 44, 26, { width: 1.6 });
      for (let i = 0; i < 9; i++) s.line([[52 + i * 5.5, 22], [46 + i * 6.5, 74 + (i % 3) * 4]], { width: 1, opacity: 0.6, overshoot: 0 });
      s.scribble(54, 28, 40, 34, { passes: 4, opacity: 0.95, step: 1.6 });
      s.dot(66, 42, 2.2, RED);
      s.dot(82, 41, 2.2, RED);
      s.drip(74, 60, 26, 1.8);
      s.line([[60, 70], [52, 100], [40, 130], [30, 146]], { width: 1.5 });
      s.fingers(30, 146, [[14, 148], [15, 154], [20, 158], [27, 159]]);
      s.line([[88, 70], [96, 100], [104, 130], [110, 146]], { width: 1.5 });
      s.fingers(110, 146, [[126, 148], [125, 154], [120, 158], [113, 159]]);
    }),
  });

  // Кровавые следы на картоне, когда он вырывает последнюю страницу:
  // смазанные полосы от пальцев тянутся влево — туда, куда он утащил лист
  seed = 777;
  const hand = sketch();
  // каждый палец — цепочка мазков: у края густо, дальше тает и рвётся
  [[44, 168, 7], [57, 186, 8], [70, 150, 7], [86, 120, 6]].forEach(([y, len, w], f) => {
    const x0 = 196;
    for (let k = 0; k < 26; k++) {
      const t = k / 25;
      if (t > 0.35 && rnd() > 0.55 + t * 0.3) continue; // разрывы следа
      const x = x0 - t * len;
      const yy = y + Math.sin(t * 3 + f) * 3 + rnd() * 1.5;
      hand.smear(+x.toFixed(1), +yy.toFixed(1), +(w * (1.6 - t) * (0.7 + r01() * 0.5)).toFixed(1), +(w * 0.45 * (1.2 - t * 0.6)).toFixed(1), +(rnd() * 8).toFixed(0));
    }
  });
  hand.smear(190, 66, 13, 24, 8);
  [[186, 88, 38], [198, 84, 64]].forEach(([x, y, len]) => hand.drip(x, y, len, 2.6));
  window.BLOOD_HAND = `<svg viewBox="0 0 220 180" fill="none" stroke-linecap="round" aria-hidden="true">${hand.inner()}</svg>`;

  window.DOODLES = doodles;
})();
