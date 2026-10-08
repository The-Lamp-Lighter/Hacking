#!/usr/bin/env node
/* ============================================================================
   tools/build-maps.js — gera js/mapdata.js e valida todos os mapas.

   Uso:   node tools/build-maps.js            gera/atualiza js/mapdata.js e valida tudo
          node tools/build-maps.js --check    só valida (não escreve nada)

   O que é validado em TODO mapa (inclusive os feitos à mão):
     1. tudo é alcançável (portas contam como passáveis);
     2. patrulhas só andam por piso livre, em linha reta;
     3. VISIBILIDADE: cada alvo (terminal, porta, refém, extração, início) precisa de pelo
        menos um ponto de onde dá para fazer o objetivo sem ser visto:
          - nenhuma câmera pode cobrir esse ponto em nenhum momento da varredura;
          - existe uma janela contínua sem nenhum guarda enxergando o ponto, de duração
            maior que o tempo do hack + 1,5 s (o jogador espera a ronda passar).
        O gerador só aceita câmeras e guardas que mantêm isso verdadeiro.
   ========================================================================== */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const win = { NO_AUTOBUILD: true };
const ctx = vm.createContext({ window: win, console, Math, Int32Array, Uint8Array, Float32Array, Array, Set, Map, Error, Object, JSON });
for (const f of ['core', 'catalog', 'maps']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const SC = win.SC, K = SC.K;
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/* =========================== analisador de visibilidade =========================== */
function makeAnalyzer(m) {
  const D = m.diff, W = m.W, H = m.H, g = m.grid;
  const GR = K.G_RANGE + D.range, CR = K.C_RANGE + D.range * 0.6, DT = 0.25, STEPS = 600, GSP = K.G_SPEED * D.gSpeed;
  const isD = c => c === 'd' || c === 'k' || c === 'v';
  /* para a linha de visada, portas contam como abertas, exceto a porta que está sendo hackeada (ex) */
  const blocked = (x, y, ex) => {
    const gx = Math.floor(x), gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return true;
    const c = g[gy][gx]; return c === '#' || (ex && isD(c) && ex.gx === gx && ex.gy === gy);
  };
  const los = (x0, y0, x1, y1, ex) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2); for (let i = 1; i < n; i++) if (blocked(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, ex)) return false; return true; };
  function reach(block) {
    const seen = new Uint8Array(W * H), q = [m.start.gx + m.start.gy * W]; seen[q[0]] = 1;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = nx + ny * W; if (seen[k] || g[ny][nx] === '#' || (block && block.gx === nx && block.gy === ny)) continue;
        seen[k] = 1; q.push(k);
      }
    }
    return seen;
  }
  const cellsNear = (o, rad, mask) => {
    const out = [];
    for (let y = Math.floor(o.y - rad); y <= Math.ceil(o.y + rad); y++) for (let x = Math.floor(o.x - rad); x <= Math.ceil(o.x + rad); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || g[y][x] === '#' || isD(g[y][x]) || !mask[x + y * W]) continue;
      if (Math.hypot(x + 0.5 - o.x, y + 0.5 - o.y) < rad) out.push({ x, y, cam: false, seen: new Uint8Array(STEPS) });
    }
    return out;
  };
  const all = reach(null), targets = [];
  const add = (label, o, rad, need, mask, ex) => targets.push({ label, o, need: Math.ceil(need / DT), cells: cellsNear(o, rad, mask), ex: ex || null });
  m.terms.forEach(t => add('terminal ' + t.spec.name + ' (' + t.gx + ',' + t.gy + ')', t, 1.3, t.spec.time + 1.5, all));
  m.doors.forEach(d => add('porta ' + d.spec.name + ' (' + d.gx + ',' + d.gy + ')', d, 1.5, d.spec.time + 1.5, reach(d), d));
  if (m.hostage) add('refém', m.hostage, 1.0, 2.5, all);
  add('extração', m.exit, 0.85, 2.5, all);
  add('início', m.start, 1.0, 3, all);

  const maxRun = a => { let best = 0, cur = 0; for (let i = 0; i < a.length; i++) { if (a[i]) cur = 0; else if (++cur > best) best = cur; } return best; };
  const ok = (t, camOver, seenOver) => {
    for (let i = 0; i < t.cells.length; i++) {
      const c = t.cells[i]; if (c.cam || (camOver && camOver[i])) continue;
      if (maxRun(seenOver && seenOver[i] ? seenOver[i] : c.seen) >= t.need) return true;
    }
    return false;
  };
  const camSees = (cam, c, ex) => {
    const cx = c.x + 0.5, cy = c.y + 0.5, d = Math.hypot(cx - cam.x, cy - cam.y);
    return d < CR + 0.2 && angDiff(Math.atan2(cy - cam.y, cx - cam.x), cam.a) < cam.sweep + K.C_FOV + 0.05 && los(cam.x, cam.y, cx, cy, ex);
  };
  /* posição e direção do guarda a cada 0,25 s (mesma regra de patrulha do jogo) */
  function timeline(p) {
    const n = p.length, tl = new Float32Array(STEPS * 3);
    let x = p[0][0] + 0.5, y = p[0][1] + 0.5, wi = 1 % n, pause = 0, a = 0;
    for (let s = 0; s < STEPS; s++) {
      const tx = p[wi][0] + 0.5, ty = p[wi][1] + 0.5, d = Math.hypot(tx - x, ty - y);
      if (pause <= 0 || s === 0) a = Math.atan2(ty - y, tx - x);
      tl[s * 3] = x; tl[s * 3 + 1] = y; tl[s * 3 + 2] = a;
      if (pause > 0) { pause -= DT; continue; }
      if (d < 0.06) { wi = (wi + 1) % n; pause = 0.7; } else { const st = Math.min(d, GSP * DT); x += (tx - x) / d * st; y += (ty - y) / d * st; }
    }
    return tl;
  }
  const bbox = p => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; p.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); return { x0: x0 - GR - 1, y0: y0 - GR - 1, x1: x1 + GR + 2, y1: y1 + GR + 2 }; };
  const guardSeen = (tl, c, ex, out) => {
    const cx = c.x + 0.5, cy = c.y + 0.5;
    for (let s = 0; s < STEPS; s++) {
      const gx = tl[s * 3], gy = tl[s * 3 + 1], a = tl[s * 3 + 2], dx = cx - gx, dy = cy - gy, d = Math.hypot(dx, dy);
      if (d > GR + 0.3) continue;
      if ((d < 0.9 || angDiff(Math.atan2(dy, dx), a) < K.G_FOV + 0.12) && los(gx, gy, cx, cy, ex)) out[s] = 1;
    }
  };
  const near = (t, b) => t.cells.some(c => c.x >= b.x0 && c.x <= b.x1 && c.y >= b.y0 && c.y <= b.y1);

  const api = {
    targets,
    /* câmera: aceita se todo alvo ainda tem um ponto fora do alcance dela */
    testCam(cam) {
      for (const t of targets) {
        if (Math.hypot(t.o.x - cam.x, t.o.y - cam.y) > CR + 2.5) continue;
        const over = t.cells.map(c => camSees(cam, c, t.ex));
        if (over.some(Boolean) && !ok(t, over, null)) return false;
      }
      return true;
    },
    commitCam(cam) { for (const t of targets) { if (Math.hypot(t.o.x - cam.x, t.o.y - cam.y) > CR + 2.5) continue; t.cells.forEach(c => { if (camSees(cam, c, t.ex)) c.cam = true; }); } },
    /* guarda: aceita se todo alvo ainda tem uma janela longa o bastante sem ser visto */
    testGuard(p, commit) {
      const tl = timeline(p), b = bbox(p), pend = [];
      for (const t of targets) {
        if (!near(t, b)) continue;
        const over = t.cells.map(c => {
          if (c.x < b.x0 || c.x > b.x1 || c.y < b.y0 || c.y > b.y1) return null;
          const a = Uint8Array.from(c.seen); guardSeen(tl, c, t.ex, a); return a;
        });
        if (!commit && !ok(t, null, over)) return false;
        pend.push([t, over]);
      }
      if (commit) pend.forEach(([t, over]) => over.forEach((a, i) => { if (a) t.cells[i].seen = a; }));
      return true;
    },
    fails() { return targets.filter(t => !ok(t, null, null)).map(t => t.label + (t.cells.length ? ' sempre visível' : ' sem ponto de acesso')); }
  };
  return api;
}

/* patrulha só por piso livre e em linha reta */
function pathClear(grid, p) {
  const bad = ch => ch === '#' || ch === 'd' || ch === 'k' || ch === 'v';
  for (let k = 0; k < p.length; k++) {
    const [x, y] = p[k], [x2, y2] = p[(k + 1) % p.length];
    if (!grid[y] || bad(grid[y][x])) return false;
    const n = Math.ceil(Math.hypot(x2 - x, y2 - y) / 0.2);
    for (let s = 0; s <= n; s++) { const gx = Math.floor(x + 0.5 + (x2 - x) * s / n), gy = Math.floor(y + 0.5 + (y2 - y) * s / n); if (!grid[gy] || bad(grid[gy][gx])) return false; }
  }
  return true;
}

/* =========================== gerador (salas + corredores) =========================== */
function bfsDist(g, W, H, sx, sy) {
  const d = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H); let a = 0, b = 0; d[sx + sy * W] = 0; q[b++] = sx + sy * W;
  while (a < b) {
    const c = q[a++], x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of D4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || g[ny][nx] === '#' || d[nx + ny * W] >= 0) continue; d[nx + ny * W] = d[c] + 1; q[b++] = nx + ny * W; }
  }
  return d;
}

function tryGenerate(o, seed) {
  const rnd = SC.rng(seed), ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const W = o.w, H = o.h, g = Array.from({ length: H }, () => Array(W).fill('#'));
  const minLeaf = o.minLeaf || 8, maxLeaf = o.maxLeaf || 16, rooms = [];

  function makeRoom(x, y, w, h) {
    const exW = Math.max(0, Math.min(3, w - 2 - Math.max(4, minLeaf - 3))), exH = Math.max(0, Math.min(3, h - 2 - Math.max(4, minLeaf - 3)));
    const a = ri(0, exW), b = ri(0, exW - a), c = ri(0, exH), d = ri(0, exH - c);
    const r = { x: x + 1 + a, y: y + 1 + c, w: w - 2 - a - b, h: h - 2 - c - d, id: rooms.length };
    r.cx = r.x + (r.w >> 1); r.cy = r.y + (r.h >> 1);
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) g[yy][xx] = '.';
    rooms.push(r); return [r];
  }
  function corridor(a, b) {
    const x = ri(a.x, a.x + a.w - 1), y = ri(a.y, a.y + a.h - 1), tx = ri(b.x, b.x + b.w - 1), ty = ri(b.y, b.y + b.h - 1);
    const H_ = (x0, x1, yy) => { for (let i = Math.min(x0, x1); i <= Math.max(x0, x1); i++) g[yy][i] = '.'; };
    const V_ = (y0, y1, xx) => { for (let i = Math.min(y0, y1); i <= Math.max(y0, y1); i++) g[i][xx] = '.'; };
    if (rnd() < 0.5) { H_(x, tx, y); V_(y, ty, tx); } else { V_(y, ty, x); H_(x, tx, ty); }
  }
  function split(x, y, w, h) {
    const canV = w >= minLeaf * 2, canH = h >= minLeaf * 2, big = w > maxLeaf || h > maxLeaf;
    if ((!canV && !canH) || (!big && rnd() < 0.3)) return makeRoom(x, y, w, h);
    const vertical = canV && canH ? (w / h > 1.25 ? true : h / w > 1.25 ? false : rnd() < 0.5) : canV;
    let A, B;
    if (vertical) { const c = ri(x + minLeaf, x + w - minLeaf); A = split(x, y, c - x, h); B = split(c, y, x + w - c, h); }
    else { const c = ri(y + minLeaf, y + h - minLeaf); A = split(x, y, w, c - y); B = split(x, c, w, y + h - c); }
    corridor(A[ri(0, A.length - 1)], B[ri(0, B.length - 1)]);
    return A.concat(B);
  }
  split(0, 0, W, H);
  if (rooms.length < (o.minRooms || 5)) return null;

  const loops = o.loops != null ? o.loops : Math.floor(rooms.length * 0.18);
  for (let i = 0; i < loops; i++) {
    const a = rooms[ri(0, rooms.length - 1)];
    const nr = rooms.filter(r => r !== a).sort((p, q) => Math.hypot(p.cx - a.cx, p.cy - a.cy) - Math.hypot(q.cx - a.cx, q.cy - a.cy));
    corridor(a, nr[ri(0, Math.min(2, nr.length - 1))]);
  }

  /* pilares e caixas */
  const floorCount = () => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] !== '#') n++; return n; };
  const connected = () => { const d = bfsDist(g, W, H, rooms[0].cx, rooms[0].cy); let n = 0; for (let i = 0; i < d.length; i++) if (d[i] >= 0) n++; return n === floorCount(); };
  for (const r of rooms) {
    if (r.w < 7 || r.h < 7) continue;
    const tries = ri(1, 1 + Math.floor(r.w * r.h / 70));
    for (let t = 0; t < tries; t++) {
      const ow = ri(1, 2), oh = ri(1, 2);
      if (r.x + 2 > r.x + r.w - 2 - ow || r.y + 2 > r.y + r.h - 2 - oh) continue;
      const ox = ri(r.x + 2, r.x + r.w - 2 - ow), oy = ri(r.y + 2, r.y + r.h - 2 - oh);
      if (ox <= r.cx + 1 && ox + ow - 1 >= r.cx - 1 && oy <= r.cy + 1 && oy + oh - 1 >= r.cy - 1) continue;
      const saved = [];
      for (let yy = oy; yy < oy + oh; yy++) for (let xx = ox; xx < ox + ow; xx++) { saved.push([xx, yy, g[yy][xx]]); g[yy][xx] = '#'; }
      if (!connected()) saved.forEach(([xx, yy, c]) => { g[yy][xx] = c; });
    }
  }

  const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || g[y][x] === '#';
  const choke = (x, y) => g[y][x] === '.' && ((isW(x - 1, y) && isW(x + 1, y) && !isW(x, y - 1) && !isW(x, y + 1)) || (isW(x, y - 1) && isW(x, y + 1) && !isW(x - 1, y) && !isW(x + 1, y)));
  const inRoom = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  const corner = [[0, 0], [W, 0], [0, H], [W, H]][ri(0, 3)];
  const startRoom = rooms.slice().sort((a, b) => Math.hypot(a.cx - corner[0], a.cy - corner[1]) - Math.hypot(b.cx - corner[0], b.cy - corner[1]))[0];
  const dist = bfsDist(g, W, H, startRoom.cx, startRoom.cy);
  rooms.forEach(r => { r.d = dist[r.cx + r.cy * W]; });
  const others = rooms.filter(r => r !== startRoom).sort((a, b) => b.d - a.d);
  const exitRoom = others[Math.floor(others.length * (0.15 + 0.4 * rnd()))];
  const far = others.filter(r => r !== exitRoom);

  const ents = [];
  function pickCell(room, edge, sep) {
    const c = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
      if (g[y][x] !== '.') continue;
      const onX = x === room.x || x === room.x + room.w - 1, onY = y === room.y || y === room.y + room.h - 1;
      if (edge) {
        if (!(onX || onY) || (onX && onY)) continue;
        if (D4.some(([dx, dy]) => !inRoom(room, x + dx, y + dy) && !isW(x + dx, y + dy))) continue;
      } else if (onX || onY) continue;
      if (choke(x, y) || ents.some(e => Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) < sep)) continue;
      c.push([x, y]);
    }
    return c.length ? c[ri(0, c.length - 1)] : null;
  }
  function place(room, ch, edge, sep) {
    const c = pickCell(room, edge, sep) || pickCell(room, !edge, sep);
    if (!c) return null;
    g[c[1]][c[0]] = ch; ents.push({ x: c[0], y: c[1], ch, room }); return c;
  }
  if (!place(startRoom, 'P', false, 1) || !place(exitRoom, 'E', false, 1)) return null;

  const used = new Set(), hardest = [];
  if (o.mode === 'infil') {
    const list = []; ['m', 's', 'p'].forEach(k => { for (let i = 0; i < ((o.terms || {})[k] || 0); i++) list.push(k); });
    if (!list.length || !far.length) return null;
    list.forEach((k, i) => {
      let idx = Math.min(far.length - 1, Math.floor(i * far.length / list.length) + (i ? ri(0, 1) : 0));
      for (let s = 0; s < far.length && used.has(far[idx].id) && used.size < far.length; s++) idx = (idx + 1) % far.length;
      const room = far[idx]; used.add(room.id);
      if (!place(room, k, true, 3)) return;
      if (!i) hardest.push(room);
    });
    if (ents.filter(e => SC.isTerm(e.ch)).length !== list.length) return null;
  } else {
    if (!far.length || !place(far[0], 'S', true, 3)) return null;
    used.add(far[0].id); hardest.push(far[0]);
  }
  if (o.intel !== false) {
    const free = far.filter(r => !used.has(r.id)), room = free.length ? free[ri(0, free.length - 1)] : far[ri(0, far.length - 1)];
    place(room, 'I', true, 3);
  }

  /* portas trancadas */
  const doors = [], chokes = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (choke(x, y)) chokes.push([x, y]);
  const putDoor = (x, y, kind) => { g[y][x] = kind; doors.push([x, y]); };
  const farFromDoors = (x, y, n) => !doors.some(([dx, dy]) => Math.max(Math.abs(dx - x), Math.abs(dy - y)) < n);
  const entrances = room => chokes.filter(([x, y]) => g[y][x] === '.' && D4.some(([dx, dy]) => inRoom(room, x + dx, y + dy)));
  if (o.gate && hardest.length) {
    const hard = o.mode === 'infil' ? (ents.find(e => SC.isTerm(e.ch) && e.room === hardest[0]) || {}).ch : 'x';
    const kind = o.gateKind || (hard === 'm' ? 'v' : hard === 's' ? 'k' : 'd');
    entrances(hardest[0]).slice(0, 3).forEach(([x, y]) => putDoor(x, y, kind));
  }
  const safe = chokes.filter(([x, y]) => g[y][x] === '.' && !inRoom(startRoom, x, y) && !D4.some(([dx, dy]) => inRoom(startRoom, x + dx, y + dy)) &&
    !D4.some(([dx, dy]) => inRoom(exitRoom, x + dx, y + dy)) && Math.hypot(x - startRoom.cx, y - startRoom.cy) > 3 &&
    rooms.some(r => D4.some(([dx, dy]) => inRoom(r, x + dx, y + dy))));
  shuffle(safe);
  for (const kind of ['v', 'k', 'd']) {
    let n = ((o.doors || {})[kind]) || 0;
    for (const [x, y] of safe) { if (!n) break; if (g[y][x] === '.' && farFromDoors(x, y, 3)) { putDoor(x, y, kind); n--; } }
  }

  const d = bfsDist(g, W, H, startRoom.cx, startRoom.cy);
  for (const e of ents) if (d[e.x + e.y * W] < 0) return null;

  /* ---- câmeras e guardas: só entram os que mantêm todo objetivo realizável sem ser visto ---- */
  const base = SC.parseMap({ id: o.id, diff: o.diff, map: g.map(r => r.join('')) });
  const A = makeAnalyzer(base);
  if (A.fails().length) return null;
  const grid = base.grid;

  const cams = [], camCells = new Set(), camRooms = rooms.filter(r => r !== startRoom && r !== exitRoom);
  const camCand = r => shuffle([[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1], [r.cx, r.y], [r.cx, r.y + r.h - 1], [r.x, r.cy], [r.x + r.w - 1, r.cy]]);
  for (let pass = 0; pass < 3 && cams.length < (o.cams || 0); pass++) {
    for (const r of shuffle(camRooms.slice())) {
      if (cams.length >= (o.cams || 0)) break;
      for (const [x, y] of camCand(r)) {
        if (grid[y][x] !== '.' || camCells.has(x + ',' + y)) continue;
        const cam = { x: x + 0.5, y: y + 0.5, a: +Math.atan2(r.cy - y, r.cx - x).toFixed(2), sweep: +(0.35 + rnd() * 0.25).toFixed(2) };
        if (A.testCam(cam)) { A.commitCam(cam); cams.push(cam); camCells.add(x + ',' + y); break; }
      }
    }
  }

  const rounds = [
    r => (r.w >= 5 && r.h >= 5) ? [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + r.w - 2, r.y + r.h - 2], [r.x + 1, r.y + r.h - 2]] : null,
    r => [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x + r.w - 1, r.y + r.h - 1], [r.x, r.y + r.h - 1]],
    r => r.w >= 5 ? [[r.x + 1, r.cy], [r.x + r.w - 2, r.cy]] : null,
    r => r.h >= 5 ? [[r.cx, r.y + 1], [r.cx, r.y + r.h - 2]] : null
  ];
  const guards = [], patRooms = rooms.filter(r => r !== startRoom);
  const prio = patRooms.slice().sort((a, b) => (used.has(b.id) ? 1 : 0) - (used.has(a.id) ? 1 : 0));
  const rest = shuffle(patRooms.filter(r => !used.has(r.id))), objRooms = shuffle(prio.filter(r => used.has(r.id)));
  const order = objRooms.concat(rest);
  outer: for (const round of rounds) {
    for (const r of order) {
      if (guards.length >= (o.guards || 0)) break outer;
      let p = round(r); if (!p || !pathClear(grid, p)) continue;
      if (rnd() < 0.5) p = p.slice().reverse();
      const k = ri(0, p.length - 1); p = p.slice(k).concat(p.slice(0, k));
      if (A.testGuard(p, false)) { A.testGuard(p, true); guards.push({ path: p }); }
    }
  }
  return { map: g.map(r => r.join('')), guards, cams, wantG: o.guards || 0, wantC: o.cams || 0 };
}

function generate(o) {
  let best = null;
  for (let i = 0; i < 60; i++) {
    const r = tryGenerate(o, o.seed + i * 7919);
    if (!r) continue;
    const score = r.guards.length / Math.max(1, r.wantG) + (r.wantC ? r.cams.length / r.wantC : 1);
    if (!best || score > best.score) best = Object.assign(r, { score, seed: o.seed + i * 7919 });
    if (r.guards.length >= r.wantG && r.cams.length >= r.wantC) break;
  }
  if (!best) throw new Error('Falha ao gerar o mapa ' + o.id);
  return best;
}

/* =========================== validação completa =========================== */
function validate(def) {
  const p = SC.parseMap(def), errs = [], { W, H, grid } = p;
  if (!p.start || !p.exit) errs.push('sem início/extração');
  if (def.mode === 'rescue' && !p.hostage) errs.push('sem refém');
  if (def.mode === 'infil' && !p.terms.length) errs.push('sem terminais');
  const seen = new Uint8Array(W * H), q = [p.start.gx + p.start.gy * W]; seen[q[0]] = 1;
  for (let i = 0; i < q.length; i++) { const c = q[i], x = c % W, y = (c / W) | 0; for (const [dx, dy] of D4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[ny][nx] === '#' || seen[nx + ny * W]) continue; seen[nx + ny * W] = 1; q.push(nx + ny * W); } }
  [p.exit, p.hostage, p.intel, ...p.terms, ...p.doors].filter(Boolean).forEach(c => { if (!seen[c.gx + c.gy * W]) errs.push('inalcançável ' + c.gx + ',' + c.gy); });
  def.guards.forEach((gd, i) => { if (!pathClear(grid, gd.path)) errs.push('patrulha ' + i + ' atravessa parede ou porta'); });
  def.cams.forEach((c, i) => { if (grid[Math.floor(c.y)][Math.floor(c.x)] === '#') errs.push('câmera ' + i + ' dentro da parede'); });
  const A = makeAnalyzer(p);
  def.cams.forEach(c => A.commitCam(c)); def.guards.forEach(gd => A.testGuard(gd.path, true));
  A.fails().forEach(f => errs.push('VISÍVEL: ' + f));
  return { errs, p };
}

/* =========================== principal =========================== */
const checkOnly = process.argv.includes('--check');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const data = {};
let bad = 0;
const old = (() => { try { const c = { window: { SC: {} } }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/mapdata.js'), 'utf8'), Object.assign(c, { SC: c.window.SC })); return c.SC.MAPDATA || {}; } catch (e) { return {}; } })();
console.log('id'.padEnd(12), 'modo'.padEnd(7), 'dif'.padEnd(8), 'tam'.padEnd(9), 'term/portas', 'guardas', 'câmeras', ' teclas(term | portas)   resultado');
for (const d of SC.CATALOG) {
  const def = Object.assign({}, d);
  let t0 = Date.now();
  if (def.gen) {
    let g = old[def.id];
    if (!g || (!checkOnly && (!only || only === def.id))) g = generate(Object.assign({ id: def.id, mode: def.mode, diff: def.diff }, def.gen));
    Object.assign(def, g); data[def.id] = { map: g.map, guards: g.guards, cams: g.cams };
  }
  def.guards = def.guards || []; def.cams = def.cams || [];
  const { errs, p } = validate(def), D = SC.diffOf(def);
  const lens = a => a.length ? Math.min(...a.map(x => x.spec.len)) + '–' + Math.max(...a.map(x => x.spec.len)) : '-';
  const note = def.gen && (def.guards.length < def.gen.guards || def.cams.length < def.gen.cams) ? ` (pedido ${def.gen.guards}g/${def.gen.cams}c)` : '';
  console.log(def.id.padEnd(12), def.mode.padEnd(7), D.name.padEnd(8), `${p.W}x${p.H}`.padEnd(9), `${p.terms.length}/${p.doors.length}`.padEnd(11), String(def.guards.length).padEnd(7), String(def.cams.length).padEnd(7), (lens(p.terms) + ' | ' + lens(p.doors)).padEnd(22), errs.length ? 'ERRO ' + errs.join('; ') : 'ok' + note, `${Date.now() - t0}ms`);
  if (errs.length) bad++;
}
if (!checkOnly && !only) {
  const lines = ['/* GERADO por tools/build-maps.js — não edite à mão. Rode: node tools/build-maps.js */', 'window.SC.MAPDATA = {'];
  const ids = Object.keys(data);
  ids.forEach((id, i) => {
    const m = data[id];
    lines.push('  ' + JSON.stringify(id) + ': {', '    map: [', m.map.map(r => '      ' + JSON.stringify(r)).join(',\n'), '    ],',
      '    guards: ' + JSON.stringify(m.guards) + ',', '    cams: ' + JSON.stringify(m.cams), '  }' + (i < ids.length - 1 ? ',' : ''));
  });
  lines.push('};', '');
  fs.writeFileSync(path.join(ROOT, 'js/mapdata.js'), lines.join('\n'));
  console.log('\njs/mapdata.js escrito (' + ids.length + ' mapas gerados).');
}
if (bad) { console.error('\n' + bad + ' mapa(s) com problema.'); process.exit(1); }
console.log('\nTodos os mapas passaram na validação.');
