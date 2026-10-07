/* ============================================================================
   core.js — namespace global, utilitários, roteador de telas.
   Copiado e enxugado do 00-core.js do protótipo Survival Code (SC.screen / SC.go /
   SC.loop / SC.fit / SC.toast / SC.shake).
   ========================================================================== */
window.SC = {};
(function (SC) {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  Object.assign(SC, {
    $, $$, clamp,
    lerp: (a, b, t) => a + (b - a) * t,
    pick: a => a[Math.floor(Math.random() * a.length)],
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  });

  /* ---------- armazenamento (nunca pode quebrar o jogo) ---------- */
  SC.store = {
    get(k, d) { try { const v = localStorage.getItem('td:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('td:' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento: segue sem salvar */ }
    }
  };

  /* ---------- roteador de telas ---------- */
  const screens = {};
  let current = null;
  SC.screen = (id, def) => { screens[id] = def; };
  SC.go = function (id, arg) {
    const prev = current && screens[current];
    if (prev && prev.leave) prev.leave();
    current = id;
    $$('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + id));
    const next = screens[id];
    if (next) {
      if (next.mood) SC.audio.mood(next.mood);
      if (next.enter) next.enter(arg);
    }
  };

  SC.toast = function (msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast mono ' + (kind || '');
    t.textContent = msg; $('#toast-root').appendChild(t);
    setTimeout(() => t.classList.add('off'), 2600); setTimeout(() => t.remove(), 3000);
  };
  SC.shake = () => { const a = $('#app'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); };

  /* laço de animação com delta-time; retorna função para parar */
  SC.loop = function (fn) {
    let on = true, last = performance.now(), t = 0;
    (function f(now) {
      if (!on) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      fn(dt, t); requestAnimationFrame(f);
    })(last);
    return () => { on = false; };
  };

  /* ajusta um canvas 2D ao tamanho exibido (com densidade de pixels) */
  SC.fit = function (cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== w * d || cv.height !== h * d) { cv.width = w * d; cv.height = h * d; }
    const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
    return { ctx, w, h };
  };

  /* gerador pseudoaleatório com semente (mapas gerados são sempre os mesmos) */
  SC.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  SC.hash = (...n) => { let h = 2166136261; for (const v of n) { h ^= (typeof v === 'string' ? v.split('').reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7) : v | 0); h = Math.imul(h, 16777619); } return h >>> 0; };
})(window.SC);
