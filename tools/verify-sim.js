#!/usr/bin/env node
/* ============================================================================
   tools/verify-sim.js — segunda opinião, independente do gerador.

   Reproduz a simulação do jogo quadro a quadro (60 fps: patrulha dos guardas com a mesma
   suavização de giro, câmeras balançando em seno, mesmas regras de cone e linha de visada)
   e confere, para cada alvo, se existe um ponto de onde dá para completar o hack inteiro
   sem NENHUM guarda ou câmera enxergar o jogador (em algum momento dos primeiros 150 s).

   Uso: node tools/verify-sim.js
   ========================================================================== */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const win = { NO_AUTOBUILD: true };
const ctx = vm.createContext({ window: win, console, Math, Int32Array, Uint8Array, Float32Array, Array, Set, Map, Error, Object, JSON });
for (const f of ['core', 'catalog', 'mapdata', 'maps']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const SC = win.SC; SC.buildMaps(); const K = SC.K;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const turnTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const FPS = 60, DT = 1 / FPS, HORIZON = 150, N = HORIZON * FPS;

let bad = 0;
for (const def of SC.MAPS) {
  const m = SC.parseMap(def), D = m.diff, W = m.W, H = m.H, g = m.grid;
  const GR = K.G_RANGE + D.range, CR = K.C_RANGE + D.range * 0.6;
  const isD = c => c === 'd' || c === 'k' || c === 'v';
  const blocked = (x, y, ex) => { const gx = Math.floor(x), gy = Math.floor(y); if (gx < 0 || gy < 0 || gx >= W || gy >= H) return true; const c = g[gy][gx]; return c === '#' || (ex && isD(c) && ex.gx === gx && ex.gy === gy); };
  const los = (x0, y0, x1, y1, ex) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2); for (let i = 1; i < n; i++) if (blocked(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, ex)) return false; return true; };

  /* guardas exatamente como em game.js */
  const guards = def.guards.map(gd => ({ x: gd.path[0][0] + 0.5, y: gd.path[0][1] + 0.5, a: 0, path: gd.path, wi: 1 % gd.path.length, pause: 0 }));
  const gTL = guards.map(() => new Float32Array(N * 3));
  for (let s = 0; s < N; s++) {
    guards.forEach((gd, i) => {
      gTL[i][s * 3] = gd.x; gTL[i][s * 3 + 1] = gd.y; gTL[i][s * 3 + 2] = gd.a;
      if (gd.pause > 0) { gd.pause -= DT; return; }
      const t = { x: gd.path[gd.wi][0] + 0.5, y: gd.path[gd.wi][1] + 0.5 }, d = Math.hypot(gd.x - t.x, gd.y - t.y);
      gd.a = turnTo(gd.a, Math.atan2(t.y - gd.y, t.x - gd.x), 0.12);
      if (d < 0.06) { gd.wi = (gd.wi + 1) % gd.path.length; gd.pause = 0.7; }
      else { const sp = Math.min(d, K.G_SPEED * D.gSpeed * DT); gd.x += (t.x - gd.x) / d * sp; gd.y += (t.y - gd.y) / d * sp; }
    });
  }
  const cams = def.cams.map((c, i) => ({ x: c.x, y: c.y, a0: c.a, sweep: c.sweep, ph: i * 2 }));

  /* o jogador é visto em (px,py) no quadro s? (sem agachar: pior caso) */
  const seenAt = (px, py, s, ex) => {
    for (let i = 0; i < guards.length; i++) {
      const gx = gTL[i][s * 3], gy = gTL[i][s * 3 + 1], a = gTL[i][s * 3 + 2], dx = px - gx, dy = py - gy, d = Math.hypot(dx, dy);
      if (d < GR && angDiff(Math.atan2(dy, dx), a) < K.G_FOV && los(gx, gy, px, py, ex)) return true;
      if (d < 0.9 && los(gx, gy, px, py, ex)) return true;
    }
    const t = s * DT;
    for (const c of cams) {
      const a = c.a0 + Math.sin(t * 0.7 + c.ph) * c.sweep, dx = px - c.x, dy = py - c.y, d = Math.hypot(dx, dy);
      if (d < CR && angDiff(Math.atan2(dy, dx), a) < K.C_FOV && los(c.x, c.y, px, py, ex)) return true;
    }
    return false;
  };

  const targets = [];
  m.terms.forEach(t => targets.push({ label: 'terminal ' + t.spec.name + ' (' + t.gx + ',' + t.gy + ')', o: t, rad: 1.25, need: t.spec.time }));
  m.doors.forEach(d => targets.push({ label: 'porta ' + d.spec.name + ' (' + d.gx + ',' + d.gy + ')', o: d, rad: 1.45, need: d.spec.time, ex: d }));
  if (m.hostage) targets.push({ label: 'refém', o: m.hostage, rad: 1.0, need: 1 });
  targets.push({ label: 'extração', o: m.exit, rad: 0.85, need: 1 });
  targets.push({ label: 'início', o: m.start, rad: 1.0, need: 2 });

  const fails = [];
  for (const t of targets) {
    let okAny = false;
    /* pontos de espera: centro de cada célula livre dentro do alcance (4 subpontos por célula) */
    const pts = [];
    for (let y = Math.floor(t.o.y - t.rad); y <= Math.ceil(t.o.y + t.rad); y++) for (let x = Math.floor(t.o.x - t.rad); x <= Math.ceil(t.o.x + t.rad); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || g[y][x] === '#' || isD(g[y][x])) continue;
      for (const [ox, oy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.5]]) { const px = x + ox, py = y + oy; if (Math.hypot(px - t.o.x, py - t.o.y) < t.rad) pts.push([px, py]); }
    }
    const needF = Math.ceil(t.need * FPS);
    for (const [px, py] of pts) {
      let run = 0;
      for (let s = 0; s < N; s += 2) { if (seenAt(px, py, s, t.ex)) run = 0; else { run += 2; if (run >= needF) { okAny = true; break; } } }
      if (okAny) break;
    }
    if (!okAny) fails.push(t.label);
  }
  console.log(def.id.padEnd(12), SC.diffOf(def).name.padEnd(8), `${targets.length} alvos`.padEnd(10), fails.length ? 'FALHA: ' + fails.join('; ') : 'ok');
  if (fails.length) bad++;
}
if (bad) { console.error(bad + ' mapa(s) com alvo sempre visível.'); process.exit(1); }
console.log('Verificação por simulação: todos os alvos têm um ponto seguro.');
