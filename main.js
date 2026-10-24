(() => {
  'use strict';

  const C = window.CONTENT;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vibrate = (p) => { try { navigator.vibrate?.(p); } catch {} };
  // Покадровый таймлайн на requestAnimationFrame: в отличие от setTimeout, iOS не
  // откладывает его, пока страница едет по инерции после свайпа.
  const timeline = (fn) => new Promise((done) => {
    const t0 = performance.now();
    const step = (now) => (fn(now - t0) === false ? done() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);

  // ======================================================================
  // Звук: всё синтезируется Web Audio API, файлов нет. Это наброски —
  // любой звук можно потом заменить файлом, интерфейс sound.* останется тем же.
  // Низы продублированы гармониками: динамик телефона 40–60 Гц почти не играет.
  // ======================================================================
  const sound = (() => {
    let ctx = null;
    let master, bus, verb, humLevel;
    let enabled = true;
    let humTarget = 1;

    const now = () => ctx.currentTime;
    const noiseBuffer = (sec, brown = false) => {
      const len = Math.max(1, Math.floor(ctx.sampleRate * sec));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else d[i] = w;
      }
      return buf;
    };
    const noiseSrc = (sec, brown) => {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(sec, brown);
      return n;
    };
    const filter = (type, freq, q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const gain = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const panner = (v) => {
      if (!ctx.createStereoPanner) return gain(1);
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      return p;
    };
    const drive = (k) => {
      const s = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 512 - 1) * k);
      s.curve = curve;
      return s;
    };
    const osc = (type, freq) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      return o;
    };
    // огибающая: атака → спад до тишины
    const env = (vol, attack, decay, t = now()) => {
      const g = gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
      return g;
    };
    // выход звука: в общую шину + немного в реверберацию
    const out = (node, wet = 0) => {
      node.connect(bus);
      if (wet) node.connect(gain(wet)).connect(verb);
    };
    // шумовой «пшик» через полосовой фильтр
    const burst = (dur, freq, q, vol, { t = now(), pan = 0, wet = 0, attack = 0.004 } = {}) => {
      const n = noiseSrc(dur + 0.02);
      const g = env(vol, attack, dur, t);
      n.connect(filter('bandpass', freq, q)).connect(g);
      out(g.connect(panner(pan)), wet);
      n.start(t);
    };

    function buildGraph() {
      master = gain(enabled ? 1 : 0);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 8;
      comp.ratio.value = 8;
      comp.attack.value = 0.002;
      comp.release.value = 0.2;
      bus = gain(0.9);
      bus.connect(comp).connect(master).connect(ctx.destination);
      // реверберация «пустой квартиры»: затухающий шум
      verb = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 2.4);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
      }
      verb.buffer = ir;
      verb.connect(gain(0.55)).connect(bus);
    }

    // Гул комнаты: коричневый шум → lowpass, громкость медленно дрожит
    function startHum() {
      const src = noiseSrc(6, true);
      src.loop = true;
      const tremble = gain(0.3);
      for (const [f, depth] of [[0.11, 0.08], [0.37, 0.04]]) {
        const lfo = osc('sine', f);
        lfo.connect(gain(depth)).connect(tremble.gain);
        lfo.start();
      }
      humLevel = gain(0);
      humLevel.gain.setTargetAtTime(humTarget, now(), 1.2);
      // 200 Гц + чуть-чуть 300–500, чтобы гул был слышен и в динамике телефона
      src.connect(filter('lowpass', 200, 0.7)).connect(tremble);
      src.connect(filter('bandpass', 380, 1.2)).connect(gain(0.35)).connect(tremble);
      tremble.connect(humLevel);
      out(humLevel);
      src.start();
    }

    // Скрип половицы: «прилипание-срыв» — щелчки с плавающим шагом через резонансы дерева
    function creak(vol = 0.2, long = 1, pan = rand(-0.6, 0.6)) {
      if (!ctx) return;
      const dur = rand(0.35, 0.85) * long;
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const d = buf.getChannelData(0);
      const startStep = rand(0.005, 0.009);
      const endStep = rand(0.011, 0.02);
      for (let t = 0; t < dur;) {
        const k = t / dur;
        const e = Math.sin(Math.PI * k) ** 0.7;
        const i0 = Math.floor(t * sr);
        const amp = e * rand(0.6, 1) * (Math.random() < 0.5 ? -1 : 1);
        for (let j = 0; j < sr * 0.003 && i0 + j < d.length; j++) d[i0 + j] += amp * Math.exp(-j / (sr * 0.0006));
        t += lerp(startStep, endStep, k) * rand(0.8, 1.25);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const o = gain(vol);
      for (const [f, q, g] of [[rand(480, 800), 7, 1], [rand(1300, 2100), 10, 0.55]]) {
        src.connect(filter('bandpass', f, q)).connect(gain(g * 3)).connect(o);
      }
      out(o.connect(panner(pan)), 0.25);
      src.start();
    }

    // Шорох бумаги
    function rustle(vol = 0.26) {
      if (!ctx) return;
      const dur = rand(0.22, 0.34);
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const d = buf.getChannelData(0);
      let crinkle = 1;
      for (let i = 0; i < d.length; i++) {
        if (Math.random() < 0.004) crinkle = rand(0.3, 1.6);
        crinkle += (1 - crinkle) * 0.002;
        d[i] = (Math.random() * 2 - 1) * crinkle;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = env(vol, 0.012, dur);
      src.connect(filter('bandpass', rand(2600, 3400), 0.8)).connect(g);
      out(g);
      src.start();
    }

    // Комкание: частый хруст бумаги
    function crumple(vol = 0.32) {
      if (!ctx) return;
      const t = now();
      for (let i = 0; i < 9; i++) burst(rand(0.02, 0.06), rand(2200, 5200), 1.4, vol * rand(0.4, 1), { t: t + i * rand(0.025, 0.05) });
      rustle(vol * 0.6);
    }

    // Рвущаяся бумага: длинный «трррр» из коротких надрывов
    function rip(vol = 0.42) {
      if (!ctx) return;
      const t = now();
      const dur = 0.42;
      for (let s = 0; s < dur; s += rand(0.008, 0.02)) {
        burst(0.018, lerp(1800, 3600, s / dur) * rand(0.85, 1.15), 2.2, vol * rand(0.4, 1) * (1 - s / dur * 0.4), { t: t + s, attack: 0.001 });
      }
    }

    // Взмах
    function whoosh(vol = 0.3, dur = 0.38) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(dur);
      const bp = filter('bandpass', 400, 1.1);
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(2200, t + dur * 0.45);
      bp.frequency.exponentialRampToValueAtTime(300, t + dur);
      const g = gain(0);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      n.connect(bp).connect(g);
      out(g);
      n.start(t);
    }

    // Низкий удар: синус с падением высоты + гармоники для телефона + хлопок
    function thud(vol = 0.9) {
      if (!ctx) return;
      const t = now();
      [[1, 1], [2, 0.45], [3.1, 0.22]].forEach(([mul, k]) => {
        const o = osc('sine', 70 * mul);
        o.frequency.exponentialRampToValueAtTime(40 * mul, t + 0.35);
        const g = env(vol * k, 0.005, 0.5, t);
        o.connect(g);
        out(g, 0.25);
        o.start(t);
        o.stop(t + 0.6);
      });
      const n = noiseSrc(0.15);
      const ng = env(vol * 0.5, 0.002, 0.14, t);
      n.connect(drive(8)).connect(filter('lowpass', 900)).connect(ng);
      out(ng);
      n.start(t);
    }

    // Удар скримера: диссонансный аккорд через перегруз + шумовой «взрыв» + низ
    function stinger(vol = 0.85) {
      if (!ctx) return;
      const t = now();
      const mix = gain(1);
      const g = gain(0);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.setValueAtTime(vol, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      mix.connect(drive(2.6)).connect(filter('lowpass', 4200)).connect(g);
      out(g, 0.55);
      [[110, 'sawtooth'], [116.5, 'sawtooth'], [164.8, 'square'], [233, 'sawtooth'], [329.6, 'sawtooth'], [698.5, 'square'], [740, 'sawtooth']]
        .forEach(([f, type]) => {
          const o = osc(type, f);
          o.detune.value = rand(-20, 20);
          o.frequency.exponentialRampToValueAtTime(f * 0.94, t + 1.6);
          o.connect(gain(0.12)).connect(mix);
          o.start(t);
          o.stop(t + 1.85);
        });
      burst(0.5, 2500, 0.6, vol * 0.6, { t, wet: 0.4 });
      thud(vol);
    }

    // Крик: пила с формантами «а», рвущийся по высоте
    function scream(vol = 0.4) {
      if (!ctx) return;
      const t = now();
      const dur = 1.3;
      const e = gain(0);
      e.gain.linearRampToValueAtTime(vol, t + 0.02);
      e.gain.setValueAtTime(vol, t + 0.7);
      e.gain.exponentialRampToValueAtTime(0.001, t + dur);
      const pre = gain(0.5);
      const dist = drive(3);
      pre.connect(dist);
      for (const [f, q, k] of [[850, 5, 1], [1250, 6, 0.8], [2900, 8, 0.55]]) {
        dist.connect(filter('bandpass', f, q)).connect(gain(k * 2.2)).connect(e);
      }
      const vib = osc('sine', 11);
      const vibG = gain(30);
      vib.connect(vibG);
      const oscs = [-18, 0, 23].map((cents) => {
        const o = osc('sawtooth', 470);
        o.detune.value = cents;
        o.frequency.exponentialRampToValueAtTime(830, t + 0.12);
        for (let s = 0.16; s < 0.95; s += 0.045) o.frequency.setValueAtTime(rand(720, 930), t + s);
        o.frequency.exponentialRampToValueAtTime(430, t + dur);
        vibG.connect(o.frequency);
        o.connect(pre);
        return o;
      });
      out(e, 0.5);
      [...oscs, vib].forEach((s) => { s.start(t); s.stop(t + dur + 0.05); });
    }

    // Визг: высокий металлический FM-визг, едет вниз
    function screech(vol = 0.22, dur = 1.1) {
      if (!ctx) return;
      const t = now();
      const e = gain(0);
      e.gain.linearRampToValueAtTime(vol, t + 0.015);
      e.gain.setValueAtTime(vol * 0.8, t + dur * 0.5);
      e.gain.exponentialRampToValueAtTime(0.001, t + dur);
      [[3200, 2100, 310], [3950, 2600, 427]].forEach(([f0, f1, mf]) => {
        const car = osc('sine', f0);
        car.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const mod = osc('sine', mf);
        mod.connect(gain(1600)).connect(car.frequency);
        car.connect(filter('bandpass', 3000, 1.6)).connect(e);
        [car, mod].forEach((s) => { s.start(t); s.stop(t + dur + 0.05); });
      });
      out(e, 0.4);
    }

    // Рык: низкая пила с «дрожью» голосовых связок + шум через форманты
    function growl(vol = 0.4, dur = 0.9) {
      if (!ctx) return;
      const t = now();
      const e = gain(0);
      e.gain.linearRampToValueAtTime(vol, t + 0.06);
      e.gain.setValueAtTime(vol, t + dur * 0.7);
      e.gain.linearRampToValueAtTime(0, t + dur);
      const o = osc('sawtooth', 68);
      o.frequency.linearRampToValueAtTime(52, t + dur);
      const am = osc('square', 23);
      const amG = gain(0.5);
      const v = gain(0.5);
      am.connect(amG).connect(v.gain);
      o.connect(v);
      const n = noiseSrc(dur);
      n.connect(filter('bandpass', 420, 3)).connect(gain(0.9)).connect(v);
      v.connect(drive(4)).connect(filter('lowpass', 1400)).connect(e);
      out(e.connect(panner(-0.2)), 0.35);
      [o, am, n].forEach((s) => { s.start(t); s.stop(t + dur + 0.05); });
    }

    // Дыхание прямо у уха: вдох-выдох через форманты
    function breath(vol = 0.1, pan = 0) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(1.5);
      const g = gain(0);
      g.gain.linearRampToValueAtTime(vol, t + 0.5);
      g.gain.linearRampToValueAtTime(vol * 0.2, t + 0.75);
      g.gain.linearRampToValueAtTime(vol * 0.8, t + 1.05);
      g.gain.linearRampToValueAtTime(0, t + 1.45);
      const mix = gain(1);
      [[480, 4], [1100, 6], [2500, 3]].forEach(([f, q]) => n.connect(filter('bandpass', f, q)).connect(mix));
      mix.connect(g);
      out(g.connect(panner(pan)), 0.15);
      n.start(t);
    }

    // Всхлип: шум через форманты голоса, три «вздрагивания» и выдох
    function sob(vol = 0.08) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(1.4);
      const g = gain(0);
      [0, 0.2, 0.38].forEach((s) => {
        g.gain.linearRampToValueAtTime(vol, t + s + 0.03);
        g.gain.linearRampToValueAtTime(vol * 0.1, t + s + 0.13);
      });
      g.gain.linearRampToValueAtTime(vol * 0.8, t + 0.62);
      g.gain.linearRampToValueAtTime(0, t + 1.25);
      const mix = gain(1);
      for (const [f, q] of [[620, 6], [1150, 8], [2600, 5]]) n.connect(filter('bandpass', f, q)).connect(mix);
      const voice = osc('triangle', 340);
      voice.frequency.linearRampToValueAtTime(285, t + 1.2);
      const vib = osc('sine', 7);
      vib.connect(gain(9)).connect(voice.frequency);
      voice.connect(filter('bandpass', 700, 3)).connect(gain(0.25)).connect(mix);
      mix.connect(g);
      out(g.connect(panner(-0.3)), 0.6);
      [n, voice, vib].forEach((s) => { s.start(t); s.stop(t + 1.3); });
    }

    // Шёпот: шум через «плывущие» форманты, слогами, сбоку
    function whisper(vol = 0.08, pan = rand(-0.85, 0.85), dur = rand(0.9, 1.6)) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(dur);
      const syll = gain(0);
      for (let s = 0; s < dur; s += rand(0.11, 0.22)) {
        syll.gain.linearRampToValueAtTime(vol * rand(0.4, 1), t + s + 0.04);
        syll.gain.linearRampToValueAtTime(vol * 0.15, t + s + 0.1);
      }
      syll.gain.linearRampToValueAtTime(0, t + dur);
      const mix = gain(1);
      [[rand(500, 900), 9], [rand(1400, 2000), 10], [rand(2600, 3400), 7]].forEach(([f, q]) => {
        const bp = filter('bandpass', f, q);
        bp.frequency.linearRampToValueAtTime(f * rand(0.75, 1.3), t + dur);
        n.connect(bp).connect(gain(2)).connect(mix);
      });
      mix.connect(filter('highpass', 700)).connect(syll);
      out(syll.connect(panner(pan)), 0.35);
      n.start(t);
    }

    // Стук в дверь где-то в квартире: три глухих удара
    function knock(vol = 0.3) {
      if (!ctx) return;
      const t = now();
      [0, 0.34, 0.62].forEach((s, i) => {
        const o = osc('sine', 150);
        o.frequency.setValueAtTime(150, t + s);
        o.frequency.exponentialRampToValueAtTime(90, t + s + 0.09);
        const g = env(vol * (i === 2 ? 1.2 : 1), 0.004, 0.14, t + s);
        o.connect(g);
        const far = filter('lowpass', 1000);
        g.connect(far);
        out(far.connect(panner(0.5)), 0.7);
        burst(0.04, 320, 3, vol * 0.6, { t: t + s, pan: 0.5, wet: 0.5 });
        o.start(t + s);
        o.stop(t + s + 0.16);
      });
    }

    // Сердцебиение: «тук-тук» + щелчок, чтобы слышно и в телефоне
    function heartbeat(vol = 0.5) {
      if (!ctx) return;
      const t = now();
      [[0, 1], [0.22, 0.7]].forEach(([s, k]) => {
        [[62, 1], [124, 0.35]].forEach(([f, m]) => {
          const o = osc('sine', f);
          o.frequency.setValueAtTime(f, t + s);
          o.frequency.exponentialRampToValueAtTime(f * 0.6, t + s + 0.16);
          const g = env(vol * k * m, 0.012, 0.19, t + s);
          o.connect(g);
          out(g);
          o.start(t + s);
          o.stop(t + s + 0.23);
        });
      });
    }

    // Лампа: щелчок и электрическое «бзз»
    function flicker(vol = 0.16) {
      if (!ctx) return;
      const t = now();
      burst(0.012, 3000, 0.8, vol * 1.4, { t, attack: 0.001 });
      const o = osc('square', 100);
      const g = env(vol * 0.5, 0.004, 0.08, t);
      o.connect(filter('bandpass', 600, 2)).connect(g);
      out(g);
      o.start(t);
      o.stop(t + 0.1);
    }

    // Хруст суставов
    function crack(vol = 0.35) {
      if (!ctx) return;
      const t = now();
      [0, 0.06, 0.15].forEach((s) => burst(0.012, rand(1500, 3200), 3, vol * rand(0.6, 1), { t: t + s, attack: 0.001, pan: -0.3 }));
    }

    // Глитч улики: цифровое заикание + искажённый низ (+ иногда шёпот)
    function glitchScare(vol = 0.16) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(0.32);
      const gate = gain(0);
      for (let s = 0; s < 0.3; s += 0.03) gate.gain.setValueAtTime(Math.random() < 0.6 ? vol : 0, t + s);
      gate.gain.setValueAtTime(0, t + 0.32);
      n.connect(filter('bandpass', rand(1200, 2600), 1.2)).connect(drive(5)).connect(gate);
      out(gate);
      const low = osc('square', 104);
      low.frequency.setValueAtTime(82, t + 0.12);
      const lg = env(vol * 0.8, 0.01, 0.32, t);
      low.connect(drive(4)).connect(filter('lowpass', 700)).connect(lg);
      out(lg);
      low.start(t);
      low.stop(t + 0.36);
      if (Math.random() < 0.4) whisper(vol * 0.5, rand(-0.5, 0.5), 0.35);
    }

    // Скрежет: рука тащит
    function drag(vol = 0.3) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(0.75);
      const bp = filter('bandpass', 2600, 2);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.7);
      const g = env(vol, 0.03, 0.72, t);
      n.connect(bp).connect(drive(2)).connect(g);
      out(g.connect(panner(-0.6)), 0.3);
      n.start(t);
    }

    // Затвор фотоаппарата: два коротких щелчка
    function shutter(vol = 0.5) {
      if (!ctx) return;
      const t = now();
      [0, 0.075].forEach((s, i) => burst(0.03, 4000, 0.5, vol * (i ? 0.7 : 1), { t: t + s, attack: 0.001 }));
    }

    // Жужжание выезжающей карточки полароида
    function whirr(vol = 0.08) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(0.9);
      const am = osc('sine', 46);
      const mod = gain(0.5);
      am.connect(gain(0.5)).connect(mod.gain);
      const g = gain(0);
      g.gain.linearRampToValueAtTime(vol, t + 0.06);
      g.gain.setValueAtTime(vol, t + 0.65);
      g.gain.linearRampToValueAtTime(0, t + 0.85);
      n.connect(filter('bandpass', 1100, 2)).connect(mod).connect(g);
      out(g);
      n.start(t);
      am.start(t);
      am.stop(t + 0.9);
    }

    // Карандаш/перо по бумаге: короткие штрихи
    function pencil(dur = 0.3, vol = 0.03) {
      if (!ctx) return;
      const t = now();
      const n = noiseSrc(dur);
      const g = gain(0);
      for (let s = 0; s < dur; s += rand(0.05, 0.11)) {
        g.gain.linearRampToValueAtTime(vol * rand(0.5, 1), t + s + 0.02);
        g.gain.linearRampToValueAtTime(vol * 0.1, t + s + 0.045);
      }
      g.gain.linearRampToValueAtTime(0, t + dur);
      n.connect(filter('bandpass', 4800, 1.4)).connect(g);
      out(g);
      n.start(t);
    }

    // Музыкальная шкатулка: Happy Birthday, синус + треугольник, расстроенная, с эхом.
    // Каждый круг чуть медленнее и кривее — завод кончается.
    const MELODY = [
      [67, 0.75], [67, 0.25], [69, 1], [67, 1], [72, 1], [71, 2],
      [67, 0.75], [67, 0.25], [69, 1], [67, 1], [74, 1], [72, 2],
      [67, 0.75], [67, 0.25], [79, 1], [76, 1], [72, 1], [71, 1], [69, 2],
      [77, 0.75], [77, 0.25], [76, 1], [72, 1], [74, 1], [72, 3],
    ];
    let box = null;
    function musicBox() {
      if (!ctx || box) return;
      const bg = gain(0);
      bg.gain.setTargetAtTime(0.42, now(), 0.6);
      const echo = ctx.createDelay(1);
      echo.delayTime.value = 0.36;
      const fb = gain(0.33);
      echo.connect(filter('lowpass', 2400)).connect(fb).connect(echo);
      bg.connect(echo);
      echo.connect(gain(0.55)).connect(bus);
      out(bg, 0.4);
      box = { out: bg, timer: 0, round: 0 };
      const me = box;

      const playRound = () => {
        if (box !== me) return;
        const r = me.round++;
        const beat = 0.62 * (1 + r * 0.07);
        let t = now() + 0.15;
        MELODY.forEach(([midi, beats], i) => {
          const tail = i - (MELODY.length - 6);
          const b = beat * (tail > 0 ? 1 + tail * 0.06 : 1); // в конце замедляется
          const f = 440 * 2 ** ((midi + 12 - 69) / 12);
          const cents = rand(15, 25 + r * 6) * (Math.random() < 0.5 ? -1 : 1);
          [['sine', f, 0.32], ['triangle', f * 2, 0.07]].forEach(([type, freq, v]) => {
            const o = osc(type, freq);
            o.detune.value = cents;
            const g = env(v, 0.004, 1.7, t);
            o.connect(g).connect(bg);
            o.start(t);
            o.stop(t + 1.75);
          });
          // щелчок механизма
          const n = noiseSrc(0.01);
          n.connect(filter('highpass', 3000)).connect(gain(0.03)).connect(bg);
          n.start(t);
          t += beats * b;
        });
        me.timer = setTimeout(playRound, (t - now() + 2.6) * 1000);
      };
      playRound();
    }
    function stopMusicBox() {
      if (!box) return;
      clearTimeout(box.timer);
      box.out.gain.setTargetAtTime(0, now(), 0.4);
      box = null;
    }

    // Фон: редкие скрипы (раз в 8–20 с), при скролле чаще, иногда шёпот; в тишине — молчат
    let due = rand(6, 12);
    let whisperDue = rand(14, 24);
    let lastScroll = 0;
    function ambience() {
      setInterval(() => {
        if (!ctx || document.hidden || humTarget < 0.4 || box) return;
        const active = performance.now() - lastScroll < 1200;
        due -= active ? 2.5 : 1;
        whisperDue -= 1;
        if (due <= 0) {
          creak(rand(0.1, 0.2));
          due = rand(8, 20);
        }
        if (whisperDue <= 0) {
          whisper(rand(0.04, 0.07));
          whisperDue = rand(18, 34);
        }
      }, 1000);
    }

    return {
      get enabled() { return enabled; },
      start() {
        if (ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        // iOS 16.4+: играть даже при выключенном звонке
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
        ctx = new AC();
        buildGraph();
        ctx.resume();
        startHum();
        ambience();
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) ctx.suspend(); else ctx.resume();
        });
      },
      setEnabled(on) {
        enabled = on;
        if (ctx) master.gain.setTargetAtTime(on ? 1 : 0, now(), 0.08);
      },
      // громкость гула 0…1; tc — постоянная времени в секундах
      hum(level, tc = 0.4) {
        if (Math.abs(level - humTarget) < 0.01) return;
        humTarget = level;
        if (ctx && humLevel) humLevel.gain.setTargetAtTime(level, now(), tc);
      },
      noteScroll() { lastScroll = performance.now(); },
      creak, rustle, crumple, rip, whoosh, thud, stinger, scream, screech, growl, breath, sob, whisper, knock,
      heartbeat, flicker, crack, glitchScare, drag, shutter, whirr, pencil, musicBox, stopMusicBox,
    };
  })();

  // ======================================================================
  // Тексты из content.js
  // ======================================================================
  const get = (path) => path.split('.').reduce((o, k) => o?.[k], C);
  document.title = C.title;
  $$('[data-text]').forEach((el) => { el.textContent = get(el.dataset.text) ?? ''; });
  // ушла на другую вкладку — он ждёт
  document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? (C.titleAway || C.title) : C.title;
  });

  // ---------- Блокнот ----------
  // Геометрия кропа бумаги (см. scripts/optimize.mjs): доли от высоты/ширины страницы
  const PAPER = {
    marginX: 0.1177, // вертикальная линия поля
    pitch: 0.029377, // шаг линейки
    firstRule: { a: 0.09485, b: 0.02385 }, // первая линия на paper_a и перевёрнутой paper_b
  };
  // Почерк от ровного к пляшущему: амплитуда сдвига слов по страницам
  const WOBBLE = [0, 0.18, 0.4, 0.75, 1.35];

  // Детерминированный «случай», чтобы почерк и комки не менялись при каждой загрузке
  let seed = 7;
  const srand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  // Контур листа: 32 точки по периметру (в % страницы) — из них морфится рваный край и комок
  const RECT = [];
  for (let i = 0; i <= 8; i++) RECT.push([i * 12.5, 0]);
  for (let i = 1; i <= 7; i++) RECT.push([100, i * 12.5]);
  for (let i = 8; i >= 0; i--) RECT.push([i * 12.5, 100]);
  for (let i = 7; i >= 1; i--) RECT.push([0, i * 12.5]);
  const ASPECT = 1240 / 1845;
  function makeShapes() {
    // верхний край вырван из пружины неровно
    const torn = RECT.map(([x, y]) => [x, y === 0 ? 1 + Math.abs(srand()) * 3.2 : y]);
    // комок: колючий неровный шар вокруг центра
    const ball = RECT.map(([x, y], k) => {
      const a = Math.atan2((y - 55) * (1 / ASPECT), x - 50);
      const r = 27 * (1 + srand() * 0.12 + (k % 2 ? 0.04 : -0.03));
      return [50 + Math.cos(a) * r, 55 + Math.sin(a) * r * ASPECT];
    });
    return { torn, ball };
  }
  const poly = (pts) => `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(',')})`;

  const pagesEl = $('.nb__pages');
  const D = C.diary;
  const pages = D.pages.map((entryIdx, pi) => {
    const page = document.createElement('div');
    page.className = `nb__page${pi % 2 ? ' is-b' : ''}`;
    page.style.zIndex = String(D.pages.length - pi);
    page.innerHTML = `
      <div class="nb__face"><div class="nb__text"></div><div class="nb__cast"></div></div>
      <div class="nb__creases"></div><div class="nb__ball"></div>`;
    const text = $('.nb__text', page);
    const amp = WOBBLE[pi] ?? 1;
    if (amp) text.style.transform = `rotate(${(-0.45 * amp).toFixed(2)}deg)`;

    if (pi === 0) {
      const h = document.createElement('p');
      h.className = 'nb__title';
      h.textContent = D.title;
      text.append(h);
    }
    entryIdx.forEach((ei, k) => {
      const entry = D.entries[ei];
      const p = document.createElement('p');
      p.className = 'nb__entry';
      if (entry.date) {
        const d = document.createElement('span');
        d.className = 'nb__date';
        d.textContent = entry.date;
        p.append(d);
      }
      // ~~слово~~ → зачёркнуто; каждое слово — отдельный кусочек для «пляшущего» почерка
      entry.text.split(/(~~.+?~~)/).filter(Boolean).forEach((chunk) => {
        const struck = chunk.startsWith('~~');
        const words = (struck ? chunk.slice(2, -2) : chunk).split(/(\s+)/);
        words.forEach((w) => {
          if (!w) return;
          if (/^\s+$/.test(w)) { p.append(' '); return; }
          const span = document.createElement(struck ? 's' : 'span');
          span.className = 'nb__w';
          span.textContent = w;
          if (amp) {
            span.style.setProperty('--dy', `${(srand() * 2.2 * amp).toFixed(2)}px`);
            span.style.setProperty('--r', `${(srand() * 1.8 * amp).toFixed(2)}deg`);
          }
          p.append(span);
        });
      });
      // Последняя запись дневника обрывается: ручка соскальзывает вниз
      if (pi === D.pages.length - 1 && k === entryIdx.length - 1) {
        p.insertAdjacentHTML('beforeend', `
          <span class="nb__pen"><svg class="nb__stroke" width="90" height="260" viewBox="0 0 90 260">
            <path d="M0 0 c5 2 9 9 9 20 c0 22 -7 46 -4 82 c3 40 18 78 30 110 c4 11 7 20 8 34"
              fill="none" stroke="#1c2550" stroke-width="1.7" stroke-linecap="round" opacity=".85"/>
          </svg></span>`);
      }
      text.append(p);
    });

    // Детский рисунок внизу страницы (drawings.js) — сначала его нет
    const doodleDef = (window.DOODLES || []).find((dd) => dd.page === pi);
    let doodle = null;
    if (doodleDef) {
      doodle = document.createElement('div');
      doodle.className = `nb__doodle is-${doodleDef.align || 'center'} is-blank`;
      doodle.innerHTML = doodleDef.svg;
      $('.nb__face', page).insertBefore(doodle, $('.nb__cast', page));
    }

    pagesEl.append(page);
    return {
      el: page,
      text,
      doodle,
      doodleMaxW: doodleDef?.maxW,
      creases: $('.nb__creases', page),
      ball: $('.nb__ball', page),
      cast: $('.nb__cast', page),
      shape: makeShapes(),
      dir: pi % 2 ? -1 : 1, // куда выбросить комок
      t: -1,
      drawn: false,
    };
  });
  $('.nb__under').innerHTML = window.BLOOD_HAND || '';

  const nb = $('.nb');
  // Шаг линейки, поле, размер почерка и вертикальная привязка к линиям
  function layoutNotebook() {
    const w = nb.offsetWidth;
    const h = nb.offsetHeight;
    const pitch = h * PAPER.pitch;
    nb.style.setProperty('--pitch', `${pitch}px`);
    nb.style.setProperty('--hand-lh', `${pitch * 2}px`);
    nb.style.setProperty('--margin-x', `${w * PAPER.marginX}px`);

    pages.forEach((pg, i) => {
      let size = pitch * 1.42;
      const first = PAPER.firstRule[i % 2 ? 'b' : 'a'] * h;
      // первая линия не выше ~8.5% листа (там дырки под пружину)
      const rule = first + Math.ceil(Math.max(0, h * 0.085 - first) / pitch) * pitch;
      for (let tries = 0; tries < 8; tries++) {
        pg.text.style.setProperty('--hand-size', `${size}px`);
        // где у строки базовая линия
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        pg.text.prepend(probe);
        const base = probe.offsetTop;
        probe.remove();
        // нижние петли букв чуть заходят под линию — так пишут от руки
        pg.text.style.top = `${rule - base + size * 0.06}px`;
        if (pg.text.offsetTop + pg.text.offsetHeight < h * 0.95) break;
        size *= 0.95; // не влезло — пишем мельче
      }

      // рисунок занимает свободное место под текстом
      if (pg.doodle) {
        const top = pg.text.offsetTop + pg.text.offsetHeight + pitch;
        const bottom = h * 0.035;
        const free = h - top - bottom;
        pg.doodle.hidden = free < h * 0.13;
        pg.doodle.style.top = `${top}px`;
        pg.doodle.style.bottom = `${bottom}px`;
        if (pg.doodleMaxW) pg.doodle.style.left = `${w * (1 - pg.doodleMaxW)}px`;
      }
    });
  }

  // Рисунок появляется линия за линией, когда страница впервые открылась
  function drawDoodle(pg) {
    if (pg.drawn || !pg.doodle) return;
    pg.drawn = true;
    pg.doodle.classList.remove('is-blank');
    if (reduced) return;
    pg.doodle.classList.add('is-drawing');
    sound.pencil(1.2, 0.035);
    setTimeout(() => pg.doodle.classList.remove('is-drawing'), 3200);
  }

  // ---------- Улики ----------
  const list = $('.evidence__list');
  const ROT = [-3.5, 2.8, -1.6, 3.6];
  // где на страшной версии стоит он (доли кадра) и насколько на него наезжать
  const HAUNTED = {
    1: { src: 'polaroid_haunted_1', fx: '77%', fy: '37%', fz: 2.6 },
    3: { src: 'polaroid_haunted_3', fx: '53%', fy: '37%', fz: 3.1 },
  };
  const MARK = `<svg class="polaroid__mark" viewBox="0 0 100 80" fill="none" aria-hidden="true">
    <path d="M18 30 C10 8 62 -4 86 16 C102 30 92 66 56 72 C24 77 2 58 10 38 C14 28 30 18 44 16"
      stroke="#c41212" stroke-width="3.2" stroke-linecap="round"/></svg>`;
  const polaroids = C.evidence.items.map((item, i) => {
    const n = i + 1;
    const h = HAUNTED[n];
    const fig = document.createElement('figure');
    fig.className = 'polaroid reveal';
    fig.style.setProperty('--rot', `${ROT[i % ROT.length]}deg`);
    const normal = `assets/web/polaroid_${n}.jpg`;
    const haunted = h ? `assets/web/${h.src}.jpg` : '';
    fig.innerHTML = `
      <div class="polaroid__card">
        <div class="polaroid__photo">
          <img class="polaroid__main" src="${normal}" alt="" loading="lazy" decoding="async" width="480" height="600">
          ${h ? `<img class="polaroid__alt" src="${haunted}" alt="" aria-hidden="true" loading="lazy" decoding="async">
                 <div class="polaroid__noise" aria-hidden="true"></div>${MARK}` : ''}
          <span class="polaroid__stamp"></span>
        </div>
        <div class="polaroid__back"><span></span></div>
      </div>
      <figcaption>
        <span class="polaroid__label"></span>
        <span class="polaroid__line"></span>
      </figcaption>`;
    $('.polaroid__label', fig).textContent = item.label;
    $('.polaroid__line', fig).textContent = item.line;
    $('.polaroid__stamp', fig).textContent = item.stamp || '';
    $('.polaroid__back span', fig).textContent = item.back || '';
    $('.polaroid__main', fig).alt = `${item.label}. ${item.line}`;
    const photo = $('.polaroid__photo', fig);
    if (h) {
      photo.style.setProperty('--fx', h.fx);
      photo.style.setProperty('--fy', h.fy);
      photo.style.setProperty('--fz', String(h.fz));
    }
    list.append(fig);
    return { fig, photo, main: $('.polaroid__main', fig), alt: $('.polaroid__alt', fig), normal, haunted };
  });

  // ---------- Рука: буквы строки — по отдельности, чтобы их можно было забрать ----------
  const warning = $('.arm__warning');
  const armChars = [];
  C.arm.warning.split(/(\s+)/).forEach((w) => {
    if (/^\s+$/.test(w)) { warning.append(' '); return; }
    const word = document.createElement('span');
    word.style.cssText = 'display:inline-block;white-space:nowrap';
    [...w].forEach((ch) => {
      const s = document.createElement('span');
      s.className = 'arm__ch';
      s.textContent = ch;
      word.append(s);
      // куда буква денется в его руке: случайная точка у пальцев и поворот
      armChars.push({ el: s, ox: srand() * 22 - 8, oy: srand() * 20, r: srand() * 80, cx: 0, cy: 0 });
    });
    warning.append(word);
  });
  warning.setAttribute('aria-label', C.arm.warning);

  // ---------- Ленивая загрузка ----------
  const loadDeferred = () => $$('img[data-src]').forEach((img) => {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  });
  addEventListener('load', () => setTimeout(loadDeferred, 300), { once: true });

  // ---------- Пыль и пережатый JPEG: проектор, прыжок каждые ~80 мс ----------
  const dust = $('.dust');
  const blocks = $('.blocks');
  const scareEl = $('.scare');
  if (!reduced) {
    setInterval(() => {
      dust.style.setProperty('--dx', `${(Math.random() * 40 - 20).toFixed(1)}%`);
      dust.style.setProperty('--dy', `${(Math.random() * 40 - 20).toFixed(1)}%`);
      // блоки прыгают кратно 8 px — сетка JPEG
      const bx = `${Math.round(rand(-8, 8)) * 8}px`;
      const by = `${Math.round(rand(-8, 8)) * 8}px`;
      blocks.style.setProperty('--bx', bx);
      blocks.style.setProperty('--by', by);
      scareEl.style.setProperty('--bx', bx);
      scareEl.style.setProperty('--by', by);
    }, 80);
    // Изредка полоса кадра «рассыпается» блоками
    const tear = () => {
      blocks.style.setProperty('--tear-y', `${rand(5, 90).toFixed(1)}%`);
      blocks.style.setProperty('--tear-h', `${rand(1.5, 7).toFixed(1)}%`);
      blocks.style.setProperty('--tear-x', `${Math.round(rand(-3, 3)) * 8}px`);
      blocks.classList.add('is-tear');
      setTimeout(() => blocks.classList.remove('is-tear'), rand(60, 140));
      setTimeout(tear, rand(4000, 11000));
    };
    setTimeout(tear, 5000);
  }

  // ======================================================================
  // Блокировка скролла (до входа и на время скримера)
  // ======================================================================
  let holdY = null;
  const stop = (e) => e.preventDefault();
  const stopKeys = (e) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) e.preventDefault();
  };
  function hold(y = scrollY) {
    holdY = y;
    document.documentElement.classList.add('is-held');
    addEventListener('touchmove', stop, { passive: false });
    addEventListener('wheel', stop, { passive: false });
    addEventListener('keydown', stopKeys);
    scrollTo(0, y); // гасит инерцию прокрутки
  }
  function release() {
    holdY = null;
    document.documentElement.classList.remove('is-held');
    removeEventListener('touchmove', stop);
    removeEventListener('wheel', stop);
    removeEventListener('keydown', stopKeys);
  }

  // ======================================================================
  // 1. Вход
  // ======================================================================
  const door = $('#door');
  const enterBtn = $('.door__enter');
  const fade = $('.fade');
  const soundBtn = $('.sound-toggle');
  const diary = $('#diary');
  addEventListener('touchmove', stop, { passive: false });

  let entered = false;
  // Пока она стоит перед дверью — он иногда выглядывает на один кадр
  if (!reduced) {
    const peek = () => {
      if (entered) return;
      door.classList.add('is-him');
      setTimeout(() => { if (!entered) door.classList.remove('is-him'); }, 55);
      setTimeout(peek, rand(6000, 11000));
    };
    setTimeout(peek, rand(4500, 7000));
  }

  enterBtn.addEventListener('click', async () => {
    if (entered) return;
    entered = true;
    loadDeferred();
    sound.start();

    if (reduced) {
      fade.classList.add('is-on');
      await wait(700);
    } else {
      // Он за дверью: кадр щёлкает туда-сюда и замирает на нём
      const FLICK = [[1, 130], [0, 70], [1, 90], [0, 50], [1, 60], [0, 40], [1, 520]];
      dust.classList.add('is-dense');
      sound.flicker(0.2);
      sound.thud(0.75);
      vibrate([40, 30, 70]);
      for (const [him, ms] of FLICK) {
        door.classList.toggle('is-him', !!him);
        if (him && ms > 400) {
          sound.growl(0.32, 0.8);
          sound.breath(0.12);
          vibrate([20, 40, 20, 40, 120]);
        }
        await wait(ms);
      }
      // Свет гаснет, камера выпадает из рук и падает на пол
      door.classList.remove('is-him');
      dust.classList.remove('is-dense');
      door.classList.add('is-fall');
      sound.whoosh(0.32, 0.5);
      await wait(470);
      fade.classList.add('is-cut');
      sound.thud(0.9);
      sound.creak(0.25, 0.6, 0);
      vibrate(70);
      await wait(260);
    }
    document.documentElement.classList.remove('locked');
    removeEventListener('touchmove', stop);
    scrollTo(0, diary.offsetTop);
    soundBtn.hidden = false;
    relayout();
    drawDoodle(pages[0]);
    await wait(60);
    // из темноты — пол и блокнот
    fade.classList.remove('is-cut', 'is-on');
  });

  // ---------- Кнопка звука ----------
  const renderSoundBtn = () => {
    soundBtn.textContent = sound.enabled ? C.sound.on : C.sound.off;
    soundBtn.setAttribute('aria-pressed', String(sound.enabled));
  };
  soundBtn.addEventListener('click', () => {
    sound.setEnabled(!sound.enabled);
    renderSoundBtn();
  });
  renderSoundBtn();

  // ---------- Проявление полароидов ----------
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      revealIO.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -18% 0px', threshold: 0.15 });
  polaroids.forEach((p) => revealIO.observe(p.fig));

  // ======================================================================
  // 6. Улики: глитч с наездом на него, тихая подмена при возврате, переворот по тапу
  // ======================================================================
  const glitchy = polaroids.filter((p) => p.haunted);
  const G_CLASSES = ['g-slice-a', 'g-slice-b', 'g-full', 'g-zoom', 'g-zoom2'];
  let scarePlayed = false;
  let scareRunning = false;

  async function glitch(p) {
    if (p.busy || p.fig.classList.contains('is-flipped')) return;
    p.busy = true;
    sound.glitchScare();
    const seq = [
      ['g-slice-a', 45], ['g-full', 40], ['g-slice-b', 35],
      ['g-zoom', rand(280, 460)], ['g-zoom2', 70], ['g-zoom', 110],
      ['g-slice-b', 45], ['g-full', 30], ['', 0],
    ];
    for (const [cls, ms] of seq) {
      p.photo.classList.remove(...G_CLASSES);
      if (cls) p.photo.classList.add(cls);
      if (ms) await wait(ms);
    }
    p.busy = false;
  }

  if (!reduced) {
    const visible = new Set();
    const glitchIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const p = glitchy.find((g) => g.photo === e.target);
        if (e.isIntersecting) visible.add(p); else visible.delete(p);
      });
    }, { threshold: 0.55 });
    glitchy.forEach((p) => glitchIO.observe(p.photo));
    const loop = () => {
      visible.forEach((p) => { if (!scareRunning) glitch(p); });
      setTimeout(loop, rand(1100, 2300));
    };
    setTimeout(loop, 1500);
  }

  // Ушло за верхний край — поменять версии местами (без анимации, тихо) и обвести его маркером
  const swapIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const p = glitchy.find((g) => g.main === e.target);
      if (!p || p.swapped || e.isIntersecting || e.boundingClientRect.bottom > 0) return;
      p.main.src = p.haunted;
      p.alt.src = p.normal;
      p.photo.style.setProperty('--fz', '1.6'); // теперь наезд — на пустое место, где он был
      p.photo.classList.add('is-marked');
      p.swapped = true;
      swapIO.unobserve(e.target);
    });
  });
  glitchy.forEach((p) => swapIO.observe(p.main));

  // Тап по фото — перевернуть и прочитать оборот
  polaroids.forEach((p) => {
    p.fig.addEventListener('click', () => {
      const flipped = p.fig.classList.toggle('is-flipped');
      sound.rustle(0.22);
      // перевернула обратно — а он уже там
      if (!flipped && p.haunted && !reduced) setTimeout(() => glitch(p), 420);
    });
  });

  // ======================================================================
  // 4. Скример
  // ======================================================================
  const flash = $('.flash');
  const ghost = $('.flash__ghost');
  const slicesEl = $('.scare__slices');
  const scareFrame = $('.scare__frame');
  const scareImg = $('.scare__img');

  // срезы кадра для «разрыва»: каждый — полоса той же картинки
  const SLICES = [[0, 9], [9, 6], [15, 12], [27, 5], [32, 14], [46, 8], [54, 15], [69, 7], [76, 13], [89, 11]];
  const sliceImgs = SLICES.map(([top, h]) => {
    const d = document.createElement('div');
    d.style.top = `${top}%`;
    d.style.height = `${h}%`;
    const img = document.createElement('img');
    img.dataset.src = 'assets/web/creature_2.jpg';
    img.alt = '';
    img.style.top = `${(-top / h) * 100}%`;
    img.style.height = `${(100 / h) * 100}%`;
    d.append(img);
    slicesEl.append(d);
    return img;
  });
  const tearSlices = (amp) => $$('div', slicesEl).forEach((d) => {
    d.style.setProperty('--sx', `${Math.round(rand(-amp, amp) / 8) * 8}px`);
  });
  const setZoom = (z) => {
    const t = `scale(${z.toFixed(3)})`;
    scareImg.style.transform = t;
    sliceImgs.forEach((i) => { i.style.transform = t; });
  };

  // По мотивам лучших скримеров (Lights Out, found footage): долгая темнота и тишина,
  // одна резкая склейка на лицо в луче фонаря, медленный наезд, дрожь камеры,
  // пара кадров порванной плёнки — и обрыв. Без цвета, без мультяшной тряски.
  async function scare() {
    scarePlayed = true;
    scareRunning = true;
    hold();
    sound.hum(0, 0.01);
    sound.flicker(0.22);
    scareEl.classList.add('is-on'); // лампа гаснет — сразу, в этом же кадре

    let hit2 = false;
    let shake = 0;
    await timeline((ms) => {
      if (holdY !== null && Math.abs(scrollY - holdY) > 1) scrollTo(0, holdY);
      if (ms < 480) return true; // темнота и тишина дольше, чем ждёшь
      if (!scareEl.classList.contains('is-him') && ms < 940) {
        // СКЛЕЙКА: лицо крупно
        scareEl.classList.add('is-him', 'is-dirty');
        dust.classList.add('is-dense3');
        sound.stinger(0.85);
        sound.scream(0.32);
        vibrate([90, 30, 160]);
        shake = 1;
      }
      if (ms < 940) {
        setZoom(lerp(2.25, 2.6, (ms - 480) / 460)); // медленно лезет в камеру
        scareEl.classList.toggle('is-tear', !reduced && ((ms > 640 && ms < 690) || (ms > 820 && ms < 850)));
        if (ms > 640 && ms < 650) tearSlices(48);
      } else if (ms < 1020) {
        scareEl.classList.remove('is-him', 'is-tear'); // обрыв в черноту
        shake = 0;
      } else if (ms < 1260) {
        if (!hit2) {
          hit2 = true;
          scareEl.classList.add('is-him');
          sound.screech(0.24, 0.7);
          sound.thud(0.8);
          vibrate(120);
          shake = 1.5;
        }
        setZoom(lerp(3.3, 3.6, (ms - 1020) / 240)); // глаза
      } else return false;
      // дрожь камеры: случайная, затухающая — как в руках
      if (!reduced && shake) {
        shake *= 0.94;
        scareFrame.style.transform = `translate(${(rand(-9, 9) * shake).toFixed(1)}px, ${(rand(-7, 7) * shake).toFixed(1)}px) rotate(${(rand(-0.8, 0.8) * shake).toFixed(2)}deg)`;
      }
      return true;
    });

    // Вспышка фотоаппарата — белое за 40 мс, затвор
    flash.style.transition = `opacity ${reduced ? 350 : 40}ms linear`;
    flash.classList.add('is-on');
    void flash.offsetWidth;
    flash.style.opacity = '1';
    ghost.style.transition = 'none';
    ghost.style.opacity = '0';
    sound.shutter();
    await wait(reduced ? 380 : 60);

    // Под белым: убрать существо, перенестись к первому полароиду, «засветить» его
    scareEl.classList.remove('is-on', 'is-him', 'is-dirty', 'is-tear');
    scareFrame.style.transform = '';
    dust.classList.remove('is-dense3');
    const first = polaroids[0];
    first.fig.classList.add('is-in', 'is-developing');
    const r = first.fig.getBoundingClientRect();
    const y = Math.max(0, scrollY + r.top - (innerHeight - r.height) / 2);
    holdY = y;
    scrollTo(0, y);

    // белое гаснет, сквозь него — негатив его лица, как пятно в глазах
    void ghost.offsetWidth;
    ghost.style.transition = 'opacity 250ms ease-out';
    ghost.style.opacity = reduced ? '0' : '.3';
    flash.style.transition = 'opacity 900ms ease-in';
    flash.style.opacity = '0';
    await wait(250);
    ghost.style.transition = 'opacity 650ms ease-in';
    ghost.style.opacity = '0';
    await wait(650);

    // полароид проявляется из белого за ~2.5 с, карточка жужжит
    flash.classList.remove('is-on');
    first.fig.classList.remove('is-developing');
    sound.whirr();
    sound.hum(0.55, 2.5);
    release();
    scareRunning = false;
    onScroll();
  }

  // ======================================================================
  // 8. Финал: рукопись на линейке листа — буквы появляются по одной, как будто пишут
  // ======================================================================
  const finale = $('#finale');
  const finaleText = $('.finale__text');
  const finaleDim = $('.finale__dim');
  // геометрия note.png (исходник 1536×2752): линейка, поле, край листа
  const NOTE = { w: 1536, h: 2752, firstRule: 630, pitch: 54.2, rules: 31, left: 345, right: 1395 };
  let hwLines = [];
  let finaleStarted = false;
  let writtenCount = 0;

  const measureCtx = document.createElement('canvas').getContext('2d');
  function wrap(text, font, maxW) {
    measureCtx.font = font;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const t = line ? `${line} ${w}` : w;
      if (measureCtx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  let hwSeed = 99;
  const hrand = () => ((hwSeed = (hwSeed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  function layoutFinale() {
    const W = finale.clientWidth;
    const H = finale.clientHeight;
    const s = Math.max(W / NOTE.w, H / NOTE.h);
    const ox = (W - NOTE.w * s) / 2;
    const oy = (H - NOTE.h * s) / 2;
    const pitch = NOTE.pitch * s;
    const left = ox + NOTE.left * s;
    // правый край — край листа или экрана, что ближе (лист шире экрана при cover)
    const maxW = Math.min(ox + NOTE.right * s, W - 22) - left;
    const size = Math.round(pitch * 1.34 * 10) / 10;
    const font = `${size}px "Bad Script"`;

    // разбить строки по ширине листа; пустая строка между абзацами, если влезает
    const paras = C.finale.lines.map((l) => wrap(l, font, maxW));
    const ps = C.finale.ps ? wrap(C.finale.ps, font, maxW) : [];
    const total = paras.reduce((n, p) => n + p.length, 0) + 1 + (ps.length ? ps.length + 1 : 0);
    const slots = Math.floor((NOTE.rules - 2) / 2);
    const gaps = total + paras.length - 1 <= slots;
    const rows = [];
    paras.forEach((p, i) => {
      if (i && gaps) rows.push(null);
      p.forEach((t) => rows.push({ t }));
    });
    rows.push(null);
    rows.push({ t: C.finale.sign, sign: true });
    if (ps.length) {
      rows.push(null);
      ps.forEach((t) => rows.push({ t, ps: true }));
    }

    finaleText.textContent = '';
    hwSeed = 99;
    hwLines = [];
    // базовая линия шрифта внутри строки
    const probeLine = document.createElement('div');
    probeLine.className = 'hw';
    probeLine.style.setProperty('--size', `${size}px`);
    probeLine.innerHTML = 'Ж<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
    finaleText.append(probeLine);
    const base = probeLine.lastChild.offsetTop;
    probeLine.remove();
    measureCtx.font = font;

    let ruleIdx = 2;
    rows.forEach((row) => {
      const ruleY = oy + (NOTE.firstRule + ruleIdx * NOTE.pitch) * s;
      ruleIdx += 2; // пишем через линию
      if (!row) return;
      const el = document.createElement('div');
      el.className = `hw${row.ps ? ' is-ps' : ''}`;
      el.style.setProperty('--size', `${size}px`);
      el.style.setProperty('--rot', `${(hrand() * (row.ps ? 1.6 : 0.5)).toFixed(2)}deg`);
      el.style.top = `${ruleY - base + size * 0.08}px`;
      // темп письма: буква за буквой, пауза после знаков препинания
      let t = 0;
      const words = [];
      [...row.t].forEach((ch, i) => {
        if (ch === ' ') {
          el.append(' ');
          t += 0.07;
          return;
        }
        if (i === 0 || row.t[i - 1] === ' ') words.push({ at: t, len: 0 });
        words[words.length - 1].len += 1;
        const l = document.createElement('span');
        l.className = 'hw__l';
        l.textContent = ch;
        const jit = row.ps ? 2.4 : 1;
        l.style.setProperty('--ly', `${(hrand() * 0.9 * jit).toFixed(2)}px`);
        l.style.setProperty('--lr', `${(hrand() * 2.4 * jit).toFixed(2)}deg`);
        l.style.setProperty('--t', `${t.toFixed(3)}s`);
        if (Math.abs(hrand()) > 0.82) l.style.setProperty('--o', '.7');
        el.append(l);
        t += (row.ps ? 0.11 : 0.065) + Math.abs(hrand()) * 0.035 + (/[.,!?…—]/.test(ch) ? 0.32 : 0);
      });
      finaleText.append(el);
      const wpx = measureCtx.measureText(row.t).width;
      el.style.left = `${row.sign ? left + maxW - wpx : left + (hrand() + 1) * 2}px`;
      hwLines.push({ el, dur: t, words });
    });
    // после пересчёта раскладки уже написанное остаётся на месте
    hwLines.slice(0, writtenCount).forEach((l) => {
      $$('.hw__l', l.el).forEach((s) => s.style.setProperty('--t', '0s'));
      l.el.classList.add('is-writing');
    });
  }

  async function startFinale() {
    if (finaleStarted) return;
    finaleStarted = true;
    sound.hum(0, 2);
    // темно — лампа над запиской загорается с запинкой
    const LAMP = [[0.35, 70], [0.96, 110], [0.2, 90], [0.85, 60], [0, 0]];
    sound.flicker(0.14);
    for (const [o, ms] of LAMP) {
      finaleDim.style.transition = ms ? 'none' : 'opacity .8s ease-out';
      finaleDim.style.opacity = String(o);
      if (ms) await wait(reduced ? 0 : ms);
    }
    await wait(700);
    sound.musicBox();
    await wait(900);
    for (let i = writtenCount; i < hwLines.length; i++) {
      const line = hwLines[i];
      line.el.classList.add('is-writing');
      writtenCount = i + 1;
      // перо шуршит на каждом слове
      line.words.forEach((w) => setTimeout(() => sound.pencil(w.len * 0.06, 0.022), w.at * 1000));
      await wait(line.dur * 1000 + 420);
    }
  }

  // финал в кадре — шкатулка играет; ушли наверх — затихает, вернулись — снова
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) {
      if (finaleStarted) sound.musicBox(); else startFinale();
    } else if (finaleStarted) sound.stopMusicBox();
  }, { threshold: 0.55 }).observe(finale);

  // подпись внизу: кровь начинает стекать, когда её видно
  const credit = $('.credit');
  new IntersectionObserver(([e], io) => {
    if (!e.isIntersecting) return;
    credit.classList.add('is-bleeding');
    io.disconnect();
  }, { threshold: 0.4 }).observe(credit);

  // ======================================================================
  // Скролл-сцены
  // ======================================================================
  // Участки секции #diary в экранах
  const FLIP_LEN = 0.85; // 2. на каждую страницу: оторвать, смять, выбросить
  const DWELL = 0.55; // последняя страница: дочитать — и её вырывают
  const RISE = 1.2; // 3. подъём камеры с пола в коридор
  const STILL = 1.2; // коридор стоит, гул стихает, лампа мигает, затем скример
  const flips = pages.length - 1;
  const T_RIP = flips * FLIP_LEN + DWELL * 0.55;
  const T_RISE = flips * FLIP_LEN + DWELL;
  const T_STILL = T_RISE + RISE;
  const T_END = T_STILL + STILL;
  // Моменты внутри участка «коридор стоит» (0…1): скример раньше, чем его ждёшь
  const BEAT = { knock: 0.05, blink1: 0.17, blink2: 0.34, sob: 0.46, scare: 0.58 };
  // Фазы одной страницы (доли её участка)
  const PH = { rip: 0.16, crumple: 0.3, throw: 0.66 };

  // Страница i: t — прогресс её участка 0…1 (оторвать → смять → выбросить)
  function setPage(i, t) {
    const pg = pages[i];
    if (Math.abs(pg.t - t) < 0.0005) return;
    const prev = pg.t;
    pg.t = t;
    const r = clamp((t - PH.rip) / (PH.crumple - PH.rip));
    const c = smooth(clamp((t - PH.crumple) / (PH.throw - PH.crumple)));
    const w = clamp((t - PH.throw) / (1 - PH.throw));
    const turning = t > PH.rip && w < 1;
    pg.el.classList.toggle('is-turning', turning);
    if (r <= 0) {
      pg.el.style.transform = '';
      pg.el.style.clipPath = '';
      pg.creases.style.opacity = '0';
      pg.ball.style.opacity = '0';
    } else {
      // рваный край → комок
      const pts = RECT.map(([x, y], k) => {
        const tx = lerp(x, pg.shape.torn[k][0], r);
        const ty = lerp(y, pg.shape.torn[k][1], r);
        return [lerp(tx, pg.shape.ball[k][0], c), lerp(ty, pg.shape.ball[k][1], c)];
      });
      pg.el.style.clipPath = poly(pts);
      const ww = w * w;
      pg.el.style.transform =
        `translate(${(pg.dir * ww * 150).toFixed(1)}%, ${(r * 1.2 - Math.sin(Math.PI * w) * 22 + w * 40).toFixed(1)}%) ` +
        `rotate(${(-r * 1.5 - c * 28 * pg.dir + pg.dir * w * 340).toFixed(1)}deg) scale(${(1 + c * 0.1).toFixed(3)})`;
      pg.creases.style.opacity = c.toFixed(3);
      pg.ball.style.opacity = (c * 0.95).toFixed(3);
    }
    const next = pages[i + 1];
    if (next) next.cast.style.opacity = ((r * 0.35 + c * 0.25) * (1 - w)).toFixed(3);
    // следующая страница открылась — её рисунок прорисовывается
    if (next && t >= PH.throw && prev < PH.throw && entered) drawDoodle(next);

    if (prev < 0 || !entered) return; // первый вызов при загрузке — без звуков
    if (prev < PH.rip + 0.02 && t >= PH.rip + 0.02) { sound.rip(0.3); nb.classList.add('has-torn'); }
    [0.36, 0.46, 0.56].forEach((k) => { if (prev < k && t >= k) sound.crumple(0.28); });
    if (prev < PH.throw + 0.04 && t >= PH.throw + 0.04) sound.whoosh(0.28);
    if (prev > 0.4 && t <= 0.4) sound.rustle(0.2); // разгладили обратно
    if (prev < 1 && t >= 1) {
      // открылась 3-я страница: «читала ему через дверь» — где-то стучат
      if (i === 1) setTimeout(() => sound.knock(0.22), 700);
      // открылась 4-я: стена с именем — шёпот рядом
      if (i === 2) setTimeout(() => sound.whisper(0.11, -0.8), 500);
      // открылась последняя: половица прямо за спиной
      if (i === 3) setTimeout(() => sound.creak(0.36, 1.4), 400);
    }
  }

  // Последнюю страницу вырывает его рука: свет мигает — и рука уже на листе
  const nbArm = $('.nb-arm');
  let ripped = false; // начали вырывать
  let ripDone = false; // лист унесли
  async function ripLast() {
    if (ripped) return;
    ripped = true;
    const pg = pages[flips];
    const view = $('.diary__view').getBoundingClientRect();
    const page = pg.el.getBoundingClientRect();
    const armW = nbArm.offsetWidth;
    const armX = page.left - view.left + page.width * 0.4 - armW * 0.885;
    sound.flicker(0.2);
    darkEl.classList.add('is-blink');
    await wait(reduced ? 0 : 90);
    darkEl.classList.remove('is-blink');
    nbArm.classList.add('is-on');
    nbArm.style.transform = `translateX(${armX}px)`;
    pg.el.classList.add('is-turning');
    pg.el.style.transformOrigin = '30% 50%';
    pg.el.style.clipPath = poly(pg.shape.torn);
    sound.growl(0.42, 1);
    sound.breath(0.12, -0.2);
    vibrate([50, 30, 90]);
    nb.classList.add('has-torn');
    // держит лист, рука дрожит, лист мнётся в кулаке
    await timeline((ms) => {
      if (ms > 340) return false;
      const k = ms / 340;
      const j = reduced ? 0 : 3;
      nbArm.style.transform = `translate(${(armX + rand(-j, j)).toFixed(1)}px, ${rand(-j, j).toFixed(1)}px)`;
      pg.el.style.transform = `translate(${(-k * 3).toFixed(1)}%, ${rand(-0.4, 0.4).toFixed(2)}%) rotate(${(-k * 3).toFixed(2)}deg)`;
      pg.creases.style.opacity = (k * 0.5).toFixed(2);
      return true;
    });
    // рывок — и лист с рукой исчезают влево
    sound.rip(0.48);
    sound.whoosh(0.34, 0.3);
    await timeline((ms) => {
      const k = clamp(ms / 260);
      const dx = -(k ** 2) * (view.width * 1.5);
      nbArm.style.transform = `translateX(${(armX + dx).toFixed(1)}px)`;
      pg.el.style.transform = `translateX(${dx.toFixed(1)}px) rotate(${(-3 - k * 26).toFixed(1)}deg)`;
      return k < 1;
    });
    darkEl.classList.add('is-blink');
    nbArm.classList.remove('is-on');
    ripDone = true;
    pg.gone = true;
    pg.el.classList.add('is-gone');
    pg.el.classList.remove('is-turning');
    await wait(70);
    darkEl.classList.remove('is-blink');
  }

  // Лампа мигает: яркость падает на 80–120 мс
  const darkEl = $('.diary__dark');
  const lurker = $('.diary__lurker');
  function blink(seen = false) {
    if (reduced) return;
    darkEl.classList.add('is-blink');
    if (seen) lurker.classList.add('is-seen');
    sound.flicker(0.12);
    setTimeout(() => {
      darkEl.classList.remove('is-blink');
      lurker.classList.remove('is-seen');
    }, rand(80, 120));
  }

  // Дёргаются рисунки на текущей странице: несколько кадров «кипения»
  function twitchLoop() {
    setTimeout(twitchLoop, rand(2200, 4800));
    if (!entered || reduced || document.hidden) return;
    const s = (scrollY - G.diaryTop) / G.vh;
    if (s < -0.2 || s > T_RIP) return;
    const cur = clamp(Math.round(s / FLIP_LEN), 0, flips);
    const d = pages[cur]?.doodle;
    if (!d || !pages[cur].drawn || d.classList.contains('is-drawing')) return;
    d.style.setProperty('--tx', `${rand(-2, 2).toFixed(1)}px`);
    d.style.setProperty('--ty', `${rand(-2, 2).toFixed(1)}px`);
    d.style.setProperty('--tr', `${rand(-1.2, 1.2).toFixed(2)}deg`);
    d.classList.add('is-twitch');
    sound.pencil(0.18, 0.02);
    setTimeout(() => d.classList.remove('is-twitch'), rand(300, 700));
  }
  setTimeout(twitchLoop, 3000);

  const cam = $('.diary__cam');
  const blurImg = $('.diary__blur');
  const dimEl = $('.diary__dim');
  const recEl = $('.rec');
  const recTime = $('.rec__time');
  $('.rec__label').textContent = C.rec || 'REC';
  setInterval(() => {
    const d = new Date();
    recTime.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }, 1000);
  const beats = {};

  // Геометрия — читается только при ресайзе, чтобы скролл не дёргал раскладку
  const armEl = $('#arm');
  const armImg = $('.arm__img');
  const armBlink = $('.arm__blink');
  const G = {};
  function measure() {
    G.vh = innerHeight;
    G.vw = armEl.offsetWidth;
    G.diaryTop = diary.offsetTop;
    G.armTop = armEl.offsetTop;
    G.armH = armEl.offsetHeight;
    G.imgW = armImg.offsetWidth;
    G.warnLeft = warning.offsetLeft;
    // где каждая буква стоит без смещений
    armChars.forEach((c) => {
      c.cx = warning.offsetLeft + c.el.offsetLeft + c.el.offsetWidth / 2;
      c.cy = warning.offsetTop - warning.offsetHeight / 2 + c.el.offsetTop + c.el.offsetHeight / 2;
    });
  }

  // Плавное следование за пальцем: показанное значение догоняет реальный скролл.
  // Это не доводка — просто сглаживание рывков iOS-скролла.
  let shown = 0;
  let lastT = 0;
  let ticking = false;
  function onScroll() {
    if (holdY !== null && Math.abs(scrollY - holdY) > 1) scrollTo(0, holdY);
    sound.noteScroll();
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }

  function frame(t) {
    ticking = false;
    const dt = Math.min(64, t - (lastT || t));
    lastT = t;
    const real = (scrollY - G.diaryTop) / G.vh; // экранов внутри #diary
    const k = reduced ? 1 : 1 - 0.72 ** (dt / 16.7 || 1);
    shown += (real - shown) * k;
    if (Math.abs(real - shown) < 0.0008) shown = real;
    renderDiary(shown, real);
    renderArm();
    if (shown !== real) {
      ticking = true;
      requestAnimationFrame(frame);
    } else lastT = 0;
  }

  function renderDiary(s, real) {
    // 2. Блокнот: прогресс → оторвать, смять, выбросить; за пальцем
    const cur = clamp(Math.floor(s / FLIP_LEN), 0, flips);
    for (let i = 0; i < flips; i++) setPage(i, clamp((s - i * FLIP_LEN) / FLIP_LEN));
    // выброшенные, вырванные и лежащие глубже следующего листа не рисуем вовсе
    pages.forEach((pg, i) => {
      const gone = (i === flips && ripDone) || i > cur + 1 || (i < flips && pg.t >= 1);
      if (pg.gone !== gone) {
        pg.gone = gone;
        pg.el.classList.toggle('is-gone', gone);
      }
    });
    if (entered && real >= T_RIP) ripLast();

    // 3. Подъём камеры: блокнот уходит вниз с наклоном, коридор выравнивается
    const rise = clamp((s - T_RISE) / RISE);
    const e = smooth(rise);
    const still = clamp((s - T_STILL) / STILL);
    if (rise > 0 || nb.dataset.rise !== '0') {
      nb.dataset.rise = rise > 0 ? '1' : '0';
      nb.style.transform = `translate(-50%, -50%) translateY(${(rise ** 1.4 * 80).toFixed(2)}vh) rotateX(${(e * 58).toFixed(2)}deg) scale(${(1 - 0.42 * e).toFixed(4)})`;
      nb.style.visibility = rise >= 1 ? 'hidden' : '';
    }
    const zoom = lerp(1, 1.06, still);
    cam.style.transform = `translateY(${lerp(22, 0, e).toFixed(2)}%) scale(${(lerp(1.75, 1, e) * zoom).toFixed(4)}) rotateX(${lerp(26, 0, e).toFixed(2)}deg)`;
    blurImg.style.opacity = (Math.sin(Math.PI * rise) * 0.95).toFixed(3);
    dimEl.style.opacity = lerp(1, 0.55, e).toFixed(3);
    darkEl.style.opacity = (Math.sin(Math.PI * rise) * 0.65).toFixed(3);
    recEl.style.opacity = clamp((rise - 0.7) / 0.3).toFixed(2);

    // Гул стихает до тишины, стук, лампа мигает дважды (во второй раз — он в конце коридора),
    // всхлип — и скример раньше, чем его ждёшь
    if (!entered || scarePlayed) return;
    const st = clamp((real - T_STILL) / STILL);
    sound.hum(real < T_STILL ? 1 : 1 - smooth(clamp(st / 0.4)), 0.3);
    if (st < 0.02) Object.keys(BEAT).forEach((b) => { beats[b] = false; });
    const hit = (b) => st >= BEAT[b] && !beats[b] && (beats[b] = true);
    if (hit('knock')) sound.knock(0.12);
    if (hit('blink1')) blink();
    if (hit('blink2')) { blink(true); setTimeout(() => blink(true), 170); }
    if (hit('sob')) sound.sob();
    if (hit('scare')) scare();
  }

  // 7. Рука: стоп-моушн. Свет мигает — и каждый раз рука ближе.
  // На последнем мигании строки уже нет: она у него в пальцах, потом пропадает вместе с ним.
  const ARM_STEPS = [0.08, 0.22, 0.36, 0.5, 0.66, 0.84];
  const armState = { step: -1, beatOn: false, busy: false };
  function armLayout(step) {
    const tipK = 0.885; // кончики пальцев в кадре arm
    const contact = G.warnLeft - G.imgW * tipK + 6;
    const tipAt = (fx) => fx * G.vw - G.imgW * tipK;
    const X = [-G.imgW * 1.05, tipAt(0.1), tipAt(0.28), tipAt(0.46), contact, tipAt(0.3), -G.imgW * 1.05];
    const x = X[step];
    armImg.style.transform = `translateX(${x.toFixed(1)}px)`;
    // буквы: на месте → у него в пальцах → исчезли
    const tipX = x + G.imgW * tipK;
    const tipY = G.vh / 2;
    armChars.forEach((c) => {
      const held = step === 5;
      const gone = step === 6;
      c.el.style.setProperty('--x', held ? `${(tipX + c.ox - c.cx).toFixed(1)}px` : '0px');
      c.el.style.setProperty('--y', held ? `${(tipY + c.oy - 10 - c.cy).toFixed(1)}px` : '0px');
      c.el.style.setProperty('--r', held ? `${c.r.toFixed(0)}deg` : '0deg');
      c.el.style.setProperty('--s', held ? '.8' : '1');
      c.el.style.setProperty('--o', gone ? '0' : '1');
    });
  }
  const ARM_SOUNDS = [
    null,
    () => sound.breath(0.12, -0.4),
    () => sound.creak(0.22, 0.8, -0.5),
    () => sound.crack(0.3),
    () => sound.whisper(0.14, -0.3, 0.8),
    () => { sound.growl(0.4, 0.8); sound.drag(0.28); vibrate([40, 30, 80]); },
    () => sound.whoosh(0.3, 0.32),
  ];
  async function setArmStep(step) {
    if (armState.busy) return;
    armState.busy = true;
    const from = armState.step;
    armState.step = step;
    if (!reduced && from >= 0) {
      armBlink.classList.add('is-on');
      sound.flicker(0.12);
      await wait(step === 5 ? 160 : rand(90, 130));
    }
    armLayout(step);
    if (step > from && entered) ARM_SOUNDS[step]?.();
    if (!reduced && from >= 0) {
      await wait(30);
      armBlink.classList.remove('is-on');
    }
    armState.busy = false;
    // пока мигали, скролл мог уйти дальше — догнать
    const want = targetStep();
    if (want !== armState.step) setArmStep(want);
  }
  function targetStep() {
    const p = clamp((scrollY - G.armTop) / (G.armH - G.vh));
    return ARM_STEPS.filter((k) => p >= k).length;
  }
  function renderArm() {
    if (!G.vw) return;
    const step = targetStep();
    if (step !== armState.step) setArmStep(step);
    // сердце колотится всё чаще, пока рука ближе
    const beating = entered && step >= 1 && step <= 4;
    if (beating && !armState.beatOn) {
      armState.beatOn = true;
      const beat = () => {
        if (!armState.beatOn) return;
        sound.heartbeat(lerp(0.4, 0.75, armState.step / 4));
        setTimeout(beat, 60000 / lerp(64, 150, armState.step / 4));
      };
      beat();
    } else if (!beating) armState.beatOn = false;
  }

  function sizeDiary() {
    diary.style.setProperty('--diary-h', `${(1 + T_END) * 100}svh`);
  }
  function relayout() {
    sizeDiary();
    layoutNotebook();
    measure();
    armState.step = -1; // переставить руку по новой геометрии
    layoutFinale();
    onScroll();
  }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', relayout);
  sizeDiary();
  layoutNotebook();
  measure();
  layoutFinale();
  shown = (scrollY - G.diaryTop) / G.vh;
  onScroll();
  // шрифты с почерком могли догрузиться позже — пересчитать привязку к линейке
  Promise.all([document.fonts?.load('20px "Bad Script"'), document.fonts?.ready]).then(relayout);
  addEventListener('load', relayout);

  // для проверки в Playwright
  window.__debug = { scare, ripLast, skipScare: () => { scarePlayed = true; }, glitch: () => glitchy.forEach(glitch), T_END, T_STILL, T_RIP, T_RISE, BEAT, FLIP_LEN };
})();
