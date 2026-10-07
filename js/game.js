/* ============================================================================
   game.js — simulação e visão top-down.
   Base: 06-mission.js do protótipo Survival Code (grade, colisão, guardas com patrulha
   e perseguição, câmeras, cones de visão, barra de detecção, escolta, extração).
   Novidades: mapas de qualquer tamanho (câmera que segue + minimapa), portas
   trancadas, vários terminais e o hack por sequência de setas (js/hack.js).
   ========================================================================== */
(function (SC) {
  'use strict';
  const { $, $$, clamp } = SC;
  const G_RANGE = 5, G_FOV = 0.55, C_RANGE = 6, C_FOV = 0.38;
  const TIER_COL = { 1: '#5ED99B', 2: '#FFD24A', 3: '#FF9548', 4: '#FF7AD9', 5: '#C77DFF' };
  const THEME = { cyber: '#3FD6FF', bio: '#FF9548', toxic: '#8CFF7A', violet: '#B58CFF' };
  const SHORT = { p: 'PC', s: 'SRV', m: 'MAINFRAME' };
  let M = null, stop = null, keys = {}, endT = null;

  /* ---------- grade e colisão ---------- */
  const isDoorCh = c => c === 'd' || c === 'k' || c === 'v';
  /* guardas têm a chave das portas: só o jogador esbarra nelas */
  const wall = (m, x, y, guard) => {
    const gx = Math.floor(x), gy = Math.floor(y);
    if (gy < 0 || gy >= m.H || gx < 0 || gx >= m.W) return true;
    const c = m.grid[gy][gx];
    return c === '#' || (!guard && isDoorCh(c));
  };
  const hit = (m, x, y, r, guard) => wall(m, x - r, y - r, guard) || wall(m, x + r, y - r, guard) || wall(m, x - r, y + r, guard) || wall(m, x + r, y + r, guard);
  function slide(m, o, dx, dy, r, guard) { if (!hit(m, o.x + dx, o.y, r, guard)) o.x += dx; if (!hit(m, o.x, o.y + dy, r, guard)) o.y += dy; }
  function los(m, x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2);
    for (let i = 1; i < n; i++) if (wall(m, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false;
    return true;
  }
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const turnTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /* campo de distâncias (em células) a partir de um ponto; portas contam como passáveis */
  function distField(m, from) {
    const W = m.W, H = m.H, d = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H);
    let a = 0, b = 0; const s = Math.floor(from.x) + Math.floor(from.y) * W; d[s] = 0; q[b++] = s;
    while (a < b) {
      const c = q[a++], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || m.grid[ny][nx] === '#' || d[nx + ny * W] >= 0) continue;
        d[nx + ny * W] = d[c] + 1; q[b++] = nx + ny * W;
      }
    }
    return d;
  }
  /* próximo passo do guarda em perseguição (busca a partir do alvo até achar o guarda) */
  function nextStep(m, from, to) {
    const W = m.W, H = m.H, sx = Math.floor(from.x), sy = Math.floor(from.y), tx = Math.floor(to.x), ty = Math.floor(to.y);
    if (sx === tx && sy === ty) return to;
    const prev = m._prev || (m._prev = new Int32Array(W * H)), q = m._q || (m._q = new Int32Array(W * H));
    prev.fill(-2); let a = 0, b = 0; prev[tx + ty * W] = -1; q[b++] = tx + ty * W;
    while (a < b) {
      const c = q[a++], x = c % W, y = (c / W) | 0;
      if (x === sx && y === sy) { const p = prev[c]; return { x: (p % W) + 0.5, y: Math.floor(p / W) + 0.5 }; }
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || m.grid[ny][nx] === '#' || prev[nx + ny * W] !== -2) continue;
        prev[nx + ny * W] = c; q[b++] = nx + ny * W;
      }
    }
    return to;
  }

  /* ---------- criação da missão ---------- */
  function create(def) {
    const m = SC.parseMap(def);
    Object.assign(m, {
      id: def.id, mode: def.mode, phase: 'brief', time: 0,
      p: { x: m.start.x, y: m.start.y, a: 0, crouch: false, moving: false, trail: [] },
      guards: def.guards.map(g => ({ x: g.path[0][0] + 0.5, y: g.path[0][1] + 0.5, a: 0, path: g.path, wi: 1 % g.path.length, pause: 0, sees: false, tgt: null, rp: 0 })),
      cams: def.cams.map((c, i) => ({ x: c.x, y: c.y, a0: c.a, a: c.a, sweep: c.sweep, ph: i * 2, sees: false })),
      det: 0, maxDet: 0, spotted: 0, seen: false, alarm: false, alarmT: 0, objDone: false,
      intelGot: false, exitHint: 0, hacksOk: 0, hacksFail: 0, near: null,
      sci: m.hostage ? { x: m.hostage.x, y: m.hostage.y, found: false, crumbs: [] } : null,
      explored: new Uint8Array(m.W * m.H), cx: m.start.x, cy: m.start.y
    });
    return m;
  }

  /* ---------- simulação ---------- */
  function routeBudget() {
    /* tempo para cumprir o que falta e chegar à extração, em ordem do mais próximo */
    const p = M.p, rest = [];
    if (M.mode === 'infil') M.terms.filter(t => !t.done).forEach(t => rest.push({ x: t.x, y: t.y, hack: t.spec.time }));
    else if (M.sci && !M.sci.found) rest.push({ x: M.sci.x, y: M.sci.y, hack: 0 });
    let cur = { x: p.x, y: p.y }, total = 0, hackT = 0;
    while (rest.length) {
      const d = distField(M, cur); let bi = 0, bd = 1e9;
      rest.forEach((t, i) => { const v = d[Math.floor(t.x) + Math.floor(t.y) * M.W]; if (v >= 0 && v < bd) { bd = v; bi = i; } });
      if (bd < 1e9) total += bd; hackT += rest[bi].hack; cur = rest.splice(bi, 1)[0];
    }
    const d = distField(M, cur), v = d[Math.floor(M.exit.x) + Math.floor(M.exit.y) * M.W]; if (v > 0) total += v;
    const doors = Math.min(4, M.doors.filter(x => !x.open).length) * 5;
    return clamp(total / 2.5 * 1.35 + hackT + doors + 14, 30, 240);
  }
  function alarm() {
    if (M.alarm) return;
    M.alarm = true; M.alarmT = routeBudget(); M.det = 1;
    SC.audio.mood('alarm'); SC.audio.sfx('alarm'); SC.shake(); $('#mi-alarm').classList.add('on');
    SC.toast('Você foi detectado. Termine o objetivo e chegue à extração antes que fechem o perímetro.', 'bad');
    objectives();
  }
  function finish(outcome) {
    if (M.phase === 'end') return;
    M.phase = 'end'; SC.hack.cancel(); keys = {};
    const mm = M, rank = outcome === 'fail' ? 'F'
      : outcome === 'silent' && mm.maxDet < 0.35 && mm.hacksFail === 0 ? 'S' : outcome === 'silent' ? 'A' : 'B';
    const res = { id: mm.id, outcome, rank, time: mm.time, maxDet: mm.maxDet, spotted: mm.spotted, hacksOk: mm.hacksOk, hacksFail: mm.hacksFail, intel: mm.intelGot };
    if (outcome !== 'fail') {
      const best = SC.store.get('best', {}), old = best[mm.id], order = 'FBAS';
      if (!old || order.indexOf(rank) > order.indexOf(old.rank) || (rank === old.rank && mm.time < old.time)) { best[mm.id] = { rank, time: mm.time }; SC.store.set('best', best); }
    }
    SC.lastResult = res; SC.audio.tension(0);
    clearTimeout(endT); endT = setTimeout(() => SC.go('result', res), 600);
  }

  /* alvo hackeável mais próximo ao alcance */
  function nearest() {
    let best = null, bd = 1e9;
    const test = (o, range) => { const d = dist(o, M.p); if (d < range && d < bd) { bd = d; best = o; } };
    M.terms.forEach(t => { if (!t.done) test(t, 1.35); });
    M.doors.forEach(d => { if (!d.open) test(d, 1.6); });
    return best;
  }
  function tryHack() {
    if (M.phase !== 'play' || SC.hack.active()) return;
    const t = M.near; if (!t) return;
    keys = {}; M.p.moving = false;
    SC.hack.start(t, (res, s) => {
      if (res === 'ok') {
        M.hacksOk++;
        if (t.spec.door) { t.open = true; M.grid[t.gy][t.gx] = '.'; SC.audio.sfx('door'); SC.toast(t.spec.name + ' aberta.', 'good'); }
        else {
          t.done = true; SC.audio.sfx('ok');
          const left = M.terms.filter(x => !x.done).length;
          SC.toast(left ? t.spec.name + ' hackeado. Faltam ' + left + '.' : 'Todos os terminais hackeados. Vá para a extração.', 'good');
          if (!left) M.objDone = true;
        }
        objectives();
      } else if (res === 'fail') {
        M.hacksFail++; SC.audio.sfx('bad');
        if (!M.alarm) M.det = clamp(M.det + 0.25, 0, 0.99);
        SC.toast('Tempo esgotado. O sistema registrou a tentativa.', 'bad');
      }
    });
  }

  function update(dt) {
    const p = M.p, hacking = SC.hack.active();
    M.time += dt;
    SC.hack.update(dt);

    /* movimento do agente (parado enquanto hackeia) */
    let vx = 0, vy = 0;
    p.crouch = !!keys.crouch && !hacking; const sp = (p.crouch ? 1.4 : 2.7) * dt;
    if (!hacking) {
      vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (vx || vy) { const l = Math.hypot(vx, vy); vx /= l; vy /= l; p.a = turnTo(p.a, Math.atan2(vy, vx), 0.25); }
    }
    p.moving = !!(vx || vy);
    if (p.moving) { slide(M, p, vx * sp, vy * sp, 0.27); const t = p.trail; if (!t.length || Math.hypot(t[t.length - 1].x - p.x, t[t.length - 1].y - p.y) > 0.35) { t.push({ x: p.x, y: p.y }); if (t.length > 26) t.shift(); } }

    /* mapa explorado (minimapa) */
    const R = 7, px = Math.floor(p.x), py = Math.floor(p.y);
    for (let y = Math.max(0, py - R); y <= Math.min(M.H - 1, py + R); y++) for (let x = Math.max(0, px - R); x <= Math.min(M.W - 1, px + R); x++) if ((x - px) * (x - px) + (y - py) * (y - py) <= R * R) M.explored[x + y * M.W] = 1;

    /* guardas: patrulha ou perseguição */
    for (const g of M.guards) {
      if (M.alarm) {
        g.rp -= dt; if (g.rp <= 0 || !g.tgt) { g.tgt = nextStep(M, g, p); g.rp = 0.3; }
        const a = Math.atan2(g.tgt.y - g.y, g.tgt.x - g.x); g.a = turnTo(g.a, a, 0.3);
        slide(M, g, Math.cos(a) * 2.0 * dt, Math.sin(a) * 2.0 * dt, 0.2, true);
        if (dist(g, p) < 0.55) return finish('fail');
      } else if (g.pause > 0) g.pause -= dt;
      else {
        const t = { x: g.path[g.wi][0] + 0.5, y: g.path[g.wi][1] + 0.5 }, d = dist(g, t);
        g.a = turnTo(g.a, Math.atan2(t.y - g.y, t.x - g.x), 0.12);
        if (d < 0.06) { g.wi = (g.wi + 1) % g.path.length; g.pause = 0.7; }
        else { const s = Math.min(d, 1.25 * dt); g.x += (t.x - g.x) / d * s; g.y += (t.y - g.y) / d * s; }
      }
    }
    for (const c of M.cams) c.a = c.a0 + Math.sin(M.time * 0.7 + c.ph) * c.sweep;

    /* detecção: cones de visão com linha de visada */
    let rate = 0;
    const see = (o, range, fov, r0, r1) => {
      const d = dist(o, p);
      o.sees = d < range && angDiff(Math.atan2(p.y - o.y, p.x - o.x), o.a) < fov && los(M, o.x, o.y, p.x, p.y);
      if (o.sees) rate = Math.max(rate, SC.lerp(r0, r1, d / range));
    };
    M.guards.forEach(g => { see(g, G_RANGE, G_FOV, 1.15, 0.4); if (!g.sees && dist(g, p) < 0.9 && los(M, g.x, g.y, p.x, p.y)) { g.sees = true; rate = 1.6; } });
    M.cams.forEach(c => see(c, C_RANGE, C_FOV, 0.75, 0.4));
    if (!M.alarm) {
      rate *= p.crouch ? 0.55 : 1;
      if (rate > 0 && !M.seen) { M.spotted++; SC.audio.sfx('spotted'); }
      M.seen = rate > 0;
      M.det = clamp(M.det + (rate > 0 ? rate : -0.28) * dt, 0, 1);
      M.maxDet = Math.max(M.maxDet, M.det);
      SC.audio.tension(M.det);
      if (M.det >= 1) alarm();
    } else {
      M.alarmT -= dt; SC.audio.tension(1);
      if (M.alarmT <= 0) return finish('fail');
    }

    /* alvo de hack ao alcance */
    M.near = hacking ? null : nearest();

    /* objetivos */
    if (M.intel && !M.intelGot && dist(p, M.intel) < 0.8) { M.intelGot = true; SC.audio.sfx('pickup'); SC.toast('Achado: ' + M.def.intelName + '.', 'good'); objectives(); }
    if (M.sci) {
      const s = M.sci;
      if (!s.found && dist(p, s) < 1.1) {
        s.found = true; M.objDone = true; SC.audio.sfx('ok');
        const nm = M.def.hostageName; SC.toast(nm.charAt(0).toUpperCase() + nm.slice(1) + ' está com você. Leve até a extração.', 'good'); objectives();
      }
      if (s.found) {
        const c = s.crumbs; if (!c.length || Math.hypot(c[c.length - 1].x - p.x, c[c.length - 1].y - p.y) > 0.3) c.push({ x: p.x, y: p.y });
        if (dist(s, p) > 1.1 && c.length) { const t = c[0], d = dist(s, t); if (d < 0.15) c.shift(); else { const v = Math.min(d, 2.6 * dt); s.x += (t.x - s.x) / d * v; s.y += (t.y - s.y) / d * v; } }
        if (c.length > 60) c.shift();
      }
    }
    if (dist(p, M.exit) < 0.9) {
      if (M.objDone && (!M.sci || dist(M.sci, p) < 3)) return finish(M.alarm ? 'alarm' : 'silent');
      if (M.time - M.exitHint > 4) { M.exitHint = M.time; SC.toast(M.objDone ? 'Espere o refém alcançar você.' : 'Objetivo pendente. A extração só libera depois.'); }
    }
  }

  /* ---------- HUD ---------- */
  function objectives() {
    const d = M.def; let g1, d1;
    if (M.mode === 'infil') { const n = M.terms.length, k = M.terms.filter(t => t.done).length; g1 = d.goal + (n > 1 ? ` (${k}/${n})` : ''); d1 = M.objDone; }
    else { g1 = d.goal; d1 = M.objDone; }
    const o = [[g1, d1], [d.goal2, false]];
    $('#mi-obj').innerHTML = `<b>${SC.esc(d.code)}</b>` + o.map(x => `<span class="${x[1] ? 'done' : ''}">${x[1] ? '■' : '□'} ${SC.esc(x[0])}</span>`).join('') +
      `<span class="optl ${M.intelGot ? 'done' : ''}">${M.intelGot ? '■' : '□'} ${SC.esc(d.opt)}</span>`;
  }
  function hud() {
    const p = M.p;
    $('#mi-det-fill').style.width = (M.det * 100) + '%';
    const st = M.alarm ? 'alarme' : M.det > 0.6 ? 'quase visto' : M.seen ? 'suspeita' : p.crouch ? 'agachado' : 'oculto';
    $('#mi-det-state').textContent = st; $('#mi-det').dataset.s = M.alarm ? 'alarm' : M.det > 0.6 ? 'hi' : M.seen ? 'mid' : 'lo';
    $('#mi-timer').textContent = M.alarm ? 'perímetro fecha em ' + Math.max(0, M.alarmT).toFixed(1) + ' s' : '';
    const pr = $('#mi-prompt');
    if (M.near && !SC.hack.active() && M.phase === 'play') {
      const s = M.near.spec;
      pr.innerHTML = `<b>[E]</b> Hackear ${SC.esc(s.name)} <span>${s.len} teclas · ${s.time.toFixed(1)} s</span>`; pr.className = 'on tier' + s.tier;
    } else pr.className = '';
    $('#mi-act').classList.toggle('rdy', !!M.near);
  }

  /* ---------- desenho ---------- */
  const themeCol = m => THEME[m.def.theme] || THEME.cyber;
  function viewport(w, h) {
    const top = 70, bot = 36, ah = h - top - bot, W = M.W, H = M.H;
    const fitS = Math.min(w / (W + 0.6), ah / (H + 0.6)), fits = fitS >= 24;
    const s = fits ? Math.min(fitS, 46) : clamp(Math.min(w, h) / 13, 28, 44);
    let tx = W / 2, ty = H / 2, sx = w / 2, sy = top + ah / 2;
    if (!fits) {
      sy = h / 2; const hx = w / 2 / s, hy = h / 2 / s;
      tx = W * s <= w ? W / 2 : clamp(M.cx, hx, W - hx); ty = H * s <= h ? H / 2 : clamp(M.cy, hy, H - hy);
    }
    return { s, fits, tx, ty, sx, sy, ox: sx - tx * s, oy: sy - ty * s };
  }
  function drawMap(ctx, m, s, col, thin, r) {
    const x0 = r ? r.x0 : 0, y0 = r ? r.y0 : 0, x1 = r ? r.x1 : m.W - 1, y1 = r ? r.y1 : m.H - 1;
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(19,27,43,.95)';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.grid[y][x] === '#') ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
    ctx.strokeStyle = col; ctx.lineWidth = thin ? 1 : 1.6; ctx.beginPath();
    const isW = (x, y) => x < 0 || y < 0 || x >= m.W || y >= m.H || m.grid[y][x] === '#';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!isW(x, y)) {
      if (isW(x, y - 1)) { ctx.moveTo(x * s, y * s); ctx.lineTo((x + 1) * s, y * s); }
      if (isW(x, y + 1)) { ctx.moveTo(x * s, (y + 1) * s); ctx.lineTo((x + 1) * s, (y + 1) * s); }
      if (isW(x - 1, y)) { ctx.moveTo(x * s, y * s); ctx.lineTo(x * s, (y + 1) * s); }
      if (isW(x + 1, y)) { ctx.moveTo((x + 1) * s, y * s); ctx.lineTo((x + 1) * s, (y + 1) * s); }
    }
    if (!thin) { ctx.shadowColor = col; ctx.shadowBlur = 8; }
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  function cone(ctx, m, o, range, fov, s, hot) {
    ctx.beginPath(); ctx.moveTo(o.x * s, o.y * s);
    for (let a = -fov; a <= fov + 0.001; a += 0.07) {
      const ca = Math.cos(o.a + a), sa = Math.sin(o.a + a); let d = 0;
      while (d < range && !wall(m, o.x + ca * (d + 0.15), o.y + sa * (d + 0.15))) d += 0.15;
      ctx.lineTo((o.x + ca * d) * s, (o.y + sa * d) * s);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(o.x * s, o.y * s, 0, o.x * s, o.y * s, range * s);
    const c = hot ? '255,77,94' : '255,179,71';
    g.addColorStop(0, `rgba(${c},.5)`); g.addColorStop(1, `rgba(${c},.04)`);
    ctx.fillStyle = g; ctx.fill();
  }
  function mark(ctx, x, y, r, col, label, t) {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    const k = r * (1 + 0.15 * Math.sin(t * 4));
    ctx.beginPath(); ctx.moveTo(0, -k); ctx.lineTo(k, 0); ctx.lineTo(0, k); ctx.lineTo(-k, 0); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.fillRect(-r * 0.3, -r * 0.3, r * 0.6, r * 0.6); ctx.globalAlpha = 1;
    if (label) { ctx.font = '10px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(label, 0, r + 13); }
    ctx.restore();
  }
  function drawDoor(ctx, d, s) {
    const x = d.gx * s, y = d.gy * s, col = TIER_COL[d.spec.tier];
    ctx.save();
    if (d.open) { ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.strokeRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8); ctx.restore(); return; }
    ctx.fillStyle = 'rgba(8,12,22,.95)'; ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.strokeRect(x + 2, y + 2, s - 4, s - 4); ctx.shadowBlur = 0;
    ctx.fillStyle = col; ctx.globalAlpha = 0.18; ctx.fillRect(x + 2, y + 2, s - 4, s - 4); ctx.globalAlpha = 1;
    ctx.font = '700 ' + Math.round(s * 0.42) + 'px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.spec.len, x + s / 2, y + s / 2 + 1); ctx.restore();
  }
  function drawTerm(ctx, t, s, time) {
    const col = t.done ? '#5ED99B' : TIER_COL[t.spec.tier];
    mark(ctx, t.x * s, t.y * s, s * 0.32, col, t.done ? 'hackeado' : SHORT[t.kind] + ' ' + t.spec.len, time);
  }

  function drawTac(cv, t) {
    const { ctx, w, h } = SC.fit(cv), p = M.p, col = themeCol(M);
    /* câmera suave */
    M.cx += (p.x - M.cx) * 0.14; M.cy += (p.y - M.cy) * 0.14;
    const v = viewport(w, h), s = v.s;
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.translate(v.ox, v.oy);
    const r = { x0: Math.max(0, Math.floor(-v.ox / s) - 1), y0: Math.max(0, Math.floor(-v.oy / s) - 1), x1: Math.min(M.W - 1, Math.ceil((w - v.ox) / s) + 1), y1: Math.min(M.H - 1, Math.ceil((h - v.oy) / s) + 1) };
    ctx.fillStyle = 'rgba(63,214,255,.07)';                                  /* malha de piso */
    for (let y = r.y0; y <= r.y1 + 1; y++) for (let x = r.x0; x <= r.x1 + 1; x++) ctx.fillRect(x * s - 1, y * s - 1, 2, 2);
    const onScr = (o, rg) => { const X = o.x * s + v.ox, Y = o.y * s + v.oy, m = rg * s; return X > -m && X < w + m && Y > -m && Y < h + m; };
    M.cams.forEach(c => { if (onScr(c, C_RANGE)) cone(ctx, M, c, C_RANGE, C_FOV, s, c.sees); });
    M.guards.forEach(g => { if (onScr(g, G_RANGE)) cone(ctx, M, g, G_RANGE, G_FOV, s, g.sees || M.alarm); });
    drawMap(ctx, M, s, col, false, r);
    const sy = (t * 0.25 % 1) * M.H * s;                                     /* varredura */
    ctx.fillStyle = 'rgba(63,214,255,.10)'; ctx.fillRect(0, sy, M.W * s, 2);
    M.doors.forEach(d => { if (d.gx >= r.x0 && d.gx <= r.x1 && d.gy >= r.y0 && d.gy <= r.y1) drawDoor(ctx, d, s); });
    M.terms.forEach(tm => { if (onScr(tm, 1)) drawTerm(ctx, tm, s, t); });
    if (M.intel && !M.intelGot) mark(ctx, M.intel.x * s, M.intel.y * s, s * 0.22, '#FF9548', 'achado', t);
    mark(ctx, M.exit.x * s, M.exit.y * s, s * 0.34, '#5ED99B', 'extração', t);
    M.cams.forEach(c => { ctx.fillStyle = c.sees ? '#FF4D5E' : '#FFB347'; ctx.fillRect(c.x * s - 4, c.y * s - 4, 8, 8); });
    M.guards.forEach(g => {
      ctx.fillStyle = g.sees || M.alarm ? '#FF4D5E' : '#FFB347';
      ctx.beginPath(); ctx.arc(g.x * s, g.y * s, s * 0.22, 0, 6.3); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(g.x * s, g.y * s); ctx.lineTo((g.x + Math.cos(g.a) * 0.5) * s, (g.y + Math.sin(g.a) * 0.5) * s); ctx.stroke();
    });
    if (M.sci) { ctx.fillStyle = '#5ED99B'; ctx.beginPath(); ctx.arc(M.sci.x * s, M.sci.y * s, s * 0.2, 0, 6.3); ctx.fill(); if (!M.sci.found) { ctx.font = '10px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText('refém', M.sci.x * s, M.sci.y * s + s * 0.2 + 13); } }
    if (M.near) {                                                            /* anel do alvo de hack */
      ctx.save(); ctx.strokeStyle = TIER_COL[M.near.spec.tier]; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 18;
      ctx.beginPath(); ctx.arc(M.near.x * s, M.near.y * s, s * 0.62, 0, 6.3); ctx.stroke(); ctx.restore();
    }
    p.trail.forEach((q, i) => { ctx.globalAlpha = i / p.trail.length * 0.5; ctx.fillStyle = '#3FD6FF'; ctx.fillRect(q.x * s - 1.5, q.y * s - 1.5, 3, 3); });
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(p.x * s, p.y * s); ctx.rotate(p.a);                 /* agente */
    ctx.shadowColor = '#3FD6FF'; ctx.shadowBlur = 12; ctx.fillStyle = p.crouch ? '#8fe9ff' : '#3FD6FF';
    const rr = s * (p.crouch ? 0.26 : 0.33);
    ctx.beginPath(); ctx.moveTo(rr, 0); ctx.lineTo(-rr * 0.7, rr * 0.65); ctx.lineTo(-rr * 0.35, 0); ctx.lineTo(-rr * 0.7, -rr * 0.65); ctx.closePath(); ctx.fill();
    ctx.restore(); ctx.restore();

    /* seta apontando para o objetivo atual quando ele está fora da tela */
    const tg = target(); const X = tg.x * s + v.ox, Y = tg.y * s + v.oy, mg = 30;
    if (X < mg || X > w - mg || Y < 70 || Y > h - 40) {
      const cx = p.x * s + v.ox, cy = p.y * s + v.oy, a = Math.atan2(Y - cy, X - cx);
      const k = Math.min((w / 2 - mg) / Math.max(1e-3, Math.abs(Math.cos(a))), (h / 2 - 64) / Math.max(1e-3, Math.abs(Math.sin(a))));
      const ax = w / 2 + Math.cos(a) * k, ay = h / 2 + Math.sin(a) * k;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(a); ctx.fillStyle = '#5ED99B'; ctx.shadowColor = '#5ED99B'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, 8); ctx.lineTo(-4, 0); ctx.lineTo(-8, -8); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#5ED99B'; ctx.font = '600 10px IBM Plex Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(Math.round(dist(tg, p) * 2) + ' m', ax - Math.cos(a) * 22, ay - Math.sin(a) * 22 + 3);
    }
    drawMini(v);
  }

  /* objetivo atual: terminal mais próximo, refém ou extração */
  function target() {
    if (M.objDone) return M.exit;
    if (M.mode === 'infil') { let b = null, bd = 1e9; M.terms.forEach(t => { if (!t.done) { const d = dist(t, M.p); if (d < bd) { bd = d; b = t; } } }); return b || M.exit; }
    return M.sci;
  }

  /* minimapa: só aparece quando o mapa não cabe na tela */
  function drawMini(v) {
    const cv = $('#mini-cv'); cv.style.display = v.fits ? 'none' : 'block'; if (v.fits) return;
    const { ctx, w, h } = SC.fit(cv), s = Math.min(w / M.W, h / M.H), ox = (w - M.W * s) / 2, oy = (h - M.H * s) / 2;
    ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(ox, oy);
    const col = themeCol(M);
    for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
      if (!M.explored[x + y * M.W]) continue;
      const c = M.grid[y][x];
      ctx.fillStyle = c === '#' ? col : 'rgba(63,214,255,.14)'; ctx.globalAlpha = c === '#' ? 0.55 : 1;
      ctx.fillRect(x * s, y * s, Math.max(1, s), Math.max(1, s));
    }
    ctx.globalAlpha = 1;
    M.doors.forEach(d => { if (!d.open) { ctx.fillStyle = TIER_COL[d.spec.tier]; ctx.fillRect(d.gx * s - 0.5, d.gy * s - 0.5, Math.max(2, s) + 1, Math.max(2, s) + 1); } });
    const dot = (o, c, r) => { ctx.fillStyle = c; ctx.fillRect(o.x * s - r, o.y * s - r, r * 2, r * 2); };
    M.terms.forEach(t => dot(t, t.done ? '#5ED99B' : TIER_COL[t.spec.tier], 2.5));
    if (M.sci && !M.sci.found) dot(M.sci, '#5ED99B', 2.5);
    dot(M.exit, '#5ED99B', 2.5);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    ctx.strokeRect((v.tx - v.sx / v.s) * s, (v.ty - v.sy / v.s) * s, (w / v.s) * s, (h / v.s) * s);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(M.p.x * s, M.p.y * s, 2.5, 0, 6.3); ctx.fill();
    if (M.alarm) { ctx.fillStyle = '#FF4D5E'; M.guards.forEach(g => ctx.fillRect(g.x * s - 1.5, g.y * s - 1.5, 3, 3)); }
    ctx.restore();
  }

  /* miniatura estática para o seletor de missões */
  function thumb(cv, def) {
    const m = SC.parseMap(def), { ctx, w, h } = SC.fit(cv), s = Math.min(w / m.W, h / m.H), col = THEME[def.theme] || THEME.cyber;
    ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate((w - m.W * s) / 2, (h - m.H * s) / 2);
    drawMap(ctx, m, s, col, true);
    const dot = (o, c, r) => { if (o) { ctx.fillStyle = c; ctx.fillRect(o.x * s - r, o.y * s - r, r * 2, r * 2); } };
    const r = Math.max(1.5, Math.min(3.5, s * 0.5));
    m.doors.forEach(d => dot(d, TIER_COL[d.spec.tier], r * 0.8));
    m.terms.forEach(t => dot(t, TIER_COL[t.spec.tier], r)); dot(m.hostage, '#5ED99B', r); dot(m.intel, '#FF9548', r); dot(m.exit, '#5ED99B', r); dot(m.start, '#fff', r);
    ctx.restore();
  }

  /* ---------- entrada ---------- */
  const KEY = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'crouch', ShiftRight: 'crouch' };
  function onKey(e) {
    if (!M) return;
    const dn = e.type === 'keydown', k = KEY[e.code];
    if (SC.hack.active()) {
      if (dn && !e.repeat) {
        if (e.code === 'Escape') { e.preventDefault(); SC.hack.cancel(); return; }
        if (k && k !== 'crouch') { e.preventDefault(); SC.hack.key(k); return; }
      }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!dn && k) keys[k] = false;
      return;
    }
    if (dn && !e.repeat) {
      if ((e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') && M.phase === 'play') { e.preventDefault(); tryHack(); return; }
      if ((e.code === 'Escape' || e.code === 'KeyP') && (M.phase === 'play' || M.phase === 'pause')) { e.preventDefault(); pause(M.phase === 'play'); return; }
    }
    if (!k) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    keys[k] = dn && M.phase === 'play';
  }
  function pause(on) {
    const ov = $('#mi-overlay');
    if (on) {
      M.phase = 'pause'; keys = {};
      ov.className = 'on';
      ov.innerHTML = `<div class="panel mi-card"><p class="mono kick">Pausado</p><h3>${SC.esc(M.def.name)}</h3>
        <div class="row"><button class="btn primary" data-a="resume">Continuar</button><button class="btn ghost" data-a="retry">Recomeçar</button><button class="btn ghost" data-a="menu">Sair para o menu</button></div></div>`;
      $$('#mi-overlay [data-a]').forEach(b => b.onclick = () => {
        SC.audio.sfx('click'); const a = b.dataset.a;
        if (a === 'resume') pause(false); else if (a === 'retry') SC.go('mission', M.def.id); else SC.go('select');
      });
    } else { M.phase = 'play'; ov.className = ''; ov.innerHTML = ''; }
  }
  function briefing() {
    const d = M.def, ov = $('#mi-overlay');
    const rng = (a, b) => a === b ? a + ' teclas' : a + ' a ' + b + ' teclas';
    const lines = [];
    if (M.terms.length) lines.push(`<li><b>${M.terms.length} terminal${M.terms.length > 1 ? 'is' : ''}</b>: ${rng(d.termMin, d.termMax)}</li>`);
    if (M.doors.length) lines.push(`<li><b>${M.doors.length} porta${M.doors.length > 1 ? 's' : ''} trancada${M.doors.length > 1 ? 's' : ''}</b>: ${rng(d.doorMin, d.doorMax)}</li>`);
    ov.className = 'on';
    ov.innerHTML = `<div class="panel mi-card"><p class="mono kick">${SC.esc(d.kind)}, ${SC.esc(d.place)}</p><h3>${SC.esc(d.code)}</h3><p>${SC.esc(d.brief)}</p>
      <ul class="bul"><li>${SC.esc(M.mode === 'infil' ? d.goal + (M.terms.length > 1 ? ` (${M.terms.length})` : '') : d.goal)}</li><li>${SC.esc(d.goal2)}</li><li>${SC.esc(d.opt)}</li></ul>
      ${lines.length ? `<p class="mono kick" style="margin-top:12px">Sequências de hack neste mapa</p><ul class="bul">${lines.join('')}</ul>` : ''}
      <p class="mut small">Cones amarelos são o que guardas e câmeras enxergam. Ficar dentro deles enche a barra de detecção. Agachar reduz o ritmo pela metade. Chegue perto de um terminal ou porta e aperte <b>E</b>: aperte as setas na ordem antes do tempo acabar. Os números nos alvos são o tamanho da sequência, e a cor mostra a dificuldade.</p>
      <div class="row"><button class="btn primary" id="mi-go">Começar</button><button class="btn ghost" id="mi-back">Voltar</button></div></div>`;
    $('#mi-go').onclick = () => { SC.audio.resume(); SC.audio.sfx('click'); ov.className = ''; ov.innerHTML = ''; M.phase = 'play'; };
    $('#mi-back').onclick = () => { SC.audio.sfx('click'); SC.go('select'); };
  }

  SC.mission = { thumb, get: () => M };
  SC.screen('mission', {
    mood: 'stealth',
    enter(id) {
      const def = SC.mapById(id); M = create(def); keys = {};
      const view = $('#mi-view'); view.style.setProperty('--th', themeCol(M)); view.dataset.theme = def.theme;
      $('#mi-alarm').classList.remove('on'); $('#mi-hack').className = ''; $('#mi-prompt').className = '';
      $('#mi-hint').textContent = 'WASD ou setas: mover   Shift: agachar   E: hackear   Esc: pausa';
      objectives(); briefing();
      window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
      /* controles de toque */
      $$('#mi-pad button').forEach(b => {
        const set = v => e => {
          e.preventDefault();
          if (v && SC.hack.active()) { SC.hack.key(b.dataset.k); return; }
          keys[b.dataset.k] = v && M.phase === 'play';
        };
        b.onpointerdown = set(true); b.onpointerup = set(false); b.onpointerleave = set(false); b.onpointercancel = set(false);
      });
      $('#mi-act').onpointerdown = e => { e.preventDefault(); tryHack(); };
      $('#mi-sneak').onpointerdown = e => { e.preventDefault(); keys.crouch = !keys.crouch; $('#mi-sneak').classList.toggle('rdy', !!keys.crouch); };
      $('#mi-pause').onclick = () => { if (M.phase === 'play') pause(true); };
      $('#hk-cancel').onclick = () => SC.hack.cancel();
      const tac = $('#tac-cv');
      stop = SC.loop((dt, t) => {
        if (M.phase === 'play') update(dt);
        drawTac(tac, t); hud();
      });
    },
    leave() {
      clearTimeout(endT); if (stop) stop(); stop = null; window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
      SC.hack.cancel(); SC.audio.tension(0); $('#mi-overlay').className = ''; $('#mi-overlay').innerHTML = ''; $('#mi-alarm').classList.remove('on'); $('#mi-hack').className = '';
    }
  });
})(window.SC);
