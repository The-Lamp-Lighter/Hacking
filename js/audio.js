/* ============================================================================
   audio.js (copiado do protótipo) — áudio 100% procedural (Web Audio API), sem arquivos externos.
   Trilha: motor generativo de ambiente (pad + notas esparsas com reverberação),
   com "climas" que variam por contexto (SC.audio.mood) e tensão dinâmica na missão.
   PRODUÇÃO: substituir os climas por faixas compostas (ver Diretrizes §4) e os
   efeitos sintetizados por amostras gravadas. A API (mood / sfx / tension) pode ser mantida.
   ========================================================================== */
(function (SC) {
  'use strict';
  let ctx = null, master, music, sfxBus, rev, noiseBuf, muted = false;
  let cur = null, pad = [], timer = null, step = 0, tension = 0, padFilter = null;

  const MOODS = {
    title:   { root: 38, scale: [0, 2, 3, 7, 8, 10, 12], bpm: 50, dens: 0.38, pad: [0, 7, 15], cut: 700, pulse: 0 },
    entry:   { root: 40, scale: [0, 3, 5, 7, 10, 12], bpm: 56, dens: 0.25, pad: [0, 7], cut: 600, pulse: 0 },
    lobby:   { root: 41, scale: [0, 2, 4, 7, 9, 12, 14], bpm: 64, dens: 0.42, pad: [0, 7, 16], cut: 1100, pulse: 0 },
    command: { root: 36, scale: [0, 2, 3, 7, 8, 12, 14], bpm: 70, dens: 0.3, pad: [0, 7, 14], cut: 800, pulse: 0.4 },
    stealth: { root: 33, scale: [0, 1, 3, 7, 8, 12], bpm: 60, dens: 0.2, pad: [0, 7], cut: 420, pulse: 0.7 },
    alarm:   { root: 33, scale: [0, 1, 6, 7, 12], bpm: 138, dens: 0.55, pad: [0, 6], cut: 1500, pulse: 1 },
    win:     { root: 38, scale: [0, 4, 7, 9, 12, 14, 16], bpm: 58, dens: 0.5, pad: [0, 7, 16], cut: 1300, pulse: 0 },
    lose:    { root: 35, scale: [0, 1, 3, 7, 8], bpm: 42, dens: 0.22, pad: [0, 3, 7], cut: 380, pulse: 0 }
  };
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.85; master.connect(ctx.destination);
    /* reverberação: resposta ao impulso gerada com ruído em decaimento */
    rev = ctx.createConvolver();
    const len = ctx.sampleRate * 3, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    rev.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.55; rev.connect(revGain); revGain.connect(master);
    music = ctx.createGain(); music.gain.value = 0.9; music.connect(master); music.connect(rev);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    const sRev = ctx.createGain(); sRev.gain.value = 0.25; sfxBus.connect(sRev); sRev.connect(rev);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return true;
  }

  /* envelope simples: oscilador com ataque e decaimento exponencial */
  function tone(type, f, t0, dur, vol, dest, f2) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfxBus); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, vol, fType, f, f2, dest) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    s.buffer = noiseBuf; s.loop = true; fl.type = fType; fl.frequency.setValueAtTime(f, t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(dest || sfxBus); s.start(t0); s.stop(t0 + dur + 0.05);
  }

  /* ---------- trilha generativa ---------- */
  function stopPad(fade) {
    const t = ctx.currentTime;
    pad.forEach(p => { p.g.gain.cancelScheduledValues(t); p.g.gain.setTargetAtTime(0, t, fade / 3); p.o.forEach(o => o.stop(t + fade + 0.2)); });
    pad = [];
  }
  function startPad(m) {
    const t = ctx.currentTime;
    padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = m.cut; padFilter.Q.value = 0.7;
    padFilter.connect(music);
    m.pad.forEach((iv, i) => {
      const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.05 / (1 + i * 0.3), t, 1.2); g.connect(padFilter);
      const os = [-6, 6].map(det => { const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'triangle'; o.frequency.value = hz(m.root + iv); o.detune.value = det; o.connect(g); o.start(); return o; });
      /* LFO lento no volume: respiração do pad */
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 0.05 + i * 0.03; lg.gain.value = 0.015; l.connect(lg); lg.connect(g.gain); l.start(); os.push(l);
      pad.push({ g, o: os });
    });
  }
  function tick() {
    if (!ctx || !cur) return;
    const m = MOODS[cur], t = ctx.currentTime + 0.03; step++;
    const dens = m.dens + tension * 0.25;
    if (Math.random() < dens) {
      const n = m.root + 24 + SC.pick(m.scale) + (Math.random() < 0.25 ? 12 : 0), v = 0.05 + Math.random() * 0.05;
      tone('triangle', hz(n), t, 2.6, v, music); tone('sine', hz(n + 12), t, 1.4, v * 0.35, music);
    }
    if (m.pulse && step % 4 === 0) tone('sine', hz(m.root), t, 0.5, 0.16 * m.pulse * (0.6 + tension), music, hz(m.root - 5));
    if (cur === 'stealth' && tension > 0.5 && step % 2 === 0) tone('square', hz(m.root + 24 + 1), t, 0.12, 0.02 * tension, music);
    if (padFilter) padFilter.frequency.setTargetAtTime(m.cut * (1 + tension * 1.5), t, 0.4);
  }
  function mood(name) {
    if (!ctx || name === cur) { cur = name; return; }
    cur = name; const m = MOODS[name];
    stopPad(1.4); startPad(m);
    clearInterval(timer); timer = setInterval(tick, 60000 / m.bpm / 2);
  }

  /* ---------- efeitos sonoros ---------- */
  const SFX = {
    click: t => { tone('square', 880, t, 0.06, 0.05); tone('sine', 1760, t + 0.02, 0.08, 0.04); },
    hover: t => tone('sine', 1320, t, 0.04, 0.02),
    type: t => tone('square', 1500 + Math.random() * 500, t, 0.02, 0.012),
    whoosh: t => noise(t, 0.45, 0.12, 'bandpass', 300, 2600),
    scan: t => { tone('sawtooth', 220, t, 1.6, 0.035, null, 1400); noise(t, 1.6, 0.03, 'highpass', 3000); },
    stamp: t => { noise(t, 0.18, 0.5, 'lowpass', 900, 120); tone('sine', 110, t, 0.22, 0.4, null, 45); },
    ok: t => [0, 4, 7, 12].forEach((n, i) => tone('triangle', hz(69 + n), t + i * 0.08, 0.5, 0.07)),
    bad: t => { tone('sawtooth', 196, t, 0.3, 0.08, null, 110); tone('sawtooth', 185, t + 0.02, 0.3, 0.06, null, 104); },
    notify: t => { tone('sine', hz(81), t, 0.18, 0.06); tone('sine', hz(88), t + 0.1, 0.3, 0.06); },
    alarm: t => { for (let i = 0; i < 4; i++) { tone('square', 740, t + i * 0.32, 0.16, 0.07); tone('square', 560, t + i * 0.32 + 0.16, 0.16, 0.07); } },
    spotted: t => tone('sawtooth', 300, t, 0.14, 0.035, null, 620),
    pickup: t => { tone('sine', hz(84), t, 0.12, 0.07); tone('sine', hz(91), t + 0.07, 0.25, 0.07); },
    dice: t => { for (let i = 0; i < 9; i++) tone('square', 300 + Math.random() * 900, t + i * 0.07, 0.04, 0.03); },
    turn: t => { tone('sine', hz(48), t, 0.9, 0.2, null, hz(41)); noise(t, 0.7, 0.05, 'lowpass', 1200, 200); },
    holo: t => tone('sine', 520, t, 0.5, 0.03, null, 1040),
    'switch': t => { noise(t, 0.05, 0.25, 'highpass', 1800); tone('square', 140, t, 0.08, 0.12); },
    crash: t => { noise(t, 1.4, 0.3, 'lowpass', 4000, 80); tone('sawtooth', 90, t, 1.4, 0.15, null, 30); },
    'static': t => noise(t, 0.9, 0.05, 'bandpass', 2400, 900),
    key: t => { tone('square', 1040, t, 0.05, 0.05); tone('sine', 2080, t + 0.01, 0.06, 0.03); },
    keybad: t => { tone('sawtooth', 150, t, 0.16, 0.08, null, 90); noise(t, 0.1, 0.05, 'bandpass', 900, 400); },
    hackstart: t => { [0, 3, 7].forEach((n, i) => tone('square', hz(72 + n), t + i * 0.05, 0.08, 0.035)); noise(t, 0.25, 0.04, 'highpass', 3500); },
    hackok: t => { [0, 4, 7, 11, 12].forEach((n, i) => tone('triangle', hz(72 + n), t + i * 0.06, 0.4, 0.07)); tone('sine', hz(48), t, 0.4, 0.15, null, hz(41)); },
    door: t => { noise(t, 0.35, 0.18, 'lowpass', 1800, 200); tone('sine', 90, t, 0.35, 0.12, null, 60); }
  };
  function sfx(name) {
    if (!ctx || muted || !SFX[name]) return;
    try { SFX[name](ctx.currentTime + 0.005); } catch (e) { /* áudio nunca deve quebrar o jogo */ }
  }

  SC.audio = {
    init, sfx,
    mood: name => { if (ctx) { try { mood(name); } catch (e) {} } else cur = name; },
    /* tensão 0–1: usada pela missão para intensificar a trilha conforme a detecção */
    tension: v => { tension = SC.clamp(v, 0, 1); },
    resume: () => { if (init() && cur) { const c = cur; cur = null; mood(c); } },
    toggle: () => { muted = !muted; if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05); return !muted; }
  };
})(window.SC);
