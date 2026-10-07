/* ============================================================================
   maps.js — tabela de hack, gerador de mapas e catálogo de missões.

   Legenda do mapa (cada caractere = 1 célula):
     #  parede                     .  piso
     P  início do agente           E  extração
     S  refém (modo resgate)       I  item opcional
     p  PC simples                 s  servidor            m  mainframe      (terminais)
     d  porta básica               k  porta com teclado   v  porta-cofre    (portas trancadas)

   Terminais e portas são hackeados com a sequência de setas (js/hack.js).
   O TAMANHO da sequência não é sorteado: ele depende do tipo do alvo (tabela HACK),
   então portas e PCs simples pedem poucas teclas e sistemas complexos pedem muitas.
   Mínimo global 3, máximo global 12.
   ========================================================================== */
(function (SC) {
  'use strict';

  /* ---------- tabela de dificuldade do hack ----------
     min/max: faixa de teclas do alvo · per: segundos por tecla · slack: folga fixa em segundos */
  const HACK = {
    d: { name: 'Porta básica',       tier: 1, min: 3,  max: 4,  per: 1.10, slack: 1.6, door: true },
    p: { name: 'PC simples',         tier: 1, min: 4,  max: 5,  per: 1.00, slack: 1.5 },
    k: { name: 'Porta com teclado',  tier: 2, min: 5,  max: 6,  per: 0.95, slack: 1.5, door: true },
    s: { name: 'Servidor',           tier: 3, min: 7,  max: 9,  per: 0.85, slack: 1.3 },
    v: { name: 'Porta-cofre',        tier: 4, min: 9,  max: 11, per: 0.80, slack: 1.3, door: true },
    m: { name: 'Mainframe',          tier: 5, min: 11, max: 12, per: 0.75, slack: 1.2 }
  };
  SC.HACK = HACK;
  SC.isDoor = ch => ch === 'd' || ch === 'k' || ch === 'v';
  SC.isTerm = ch => ch === 'p' || ch === 's' || ch === 'm';

  /* o tamanho da sequência é fixo por alvo (mesmo mapa, mesmo alvo, mesmo tamanho) */
  SC.hackSpec = function (kind, mapId, gx, gy) {
    const h = HACK[kind], len = h.min + (SC.hash(mapId, gx, gy) % (h.max - h.min + 1));
    return { kind, name: h.name, tier: h.tier, len, time: +(h.slack + len * h.per).toFixed(1), door: !!h.door };
  };

  /* ---------- leitura de um mapa em ASCII ---------- */
  SC.parseMap = function (def) {
    const rows = def.map, H = rows.length, W = Math.max(...rows.map(r => r.length));
    const grid = rows.map(r => r.padEnd(W, '#').split(''));
    const m = { def, W, H, grid, start: null, exit: null, hostage: null, intel: null, terms: [], doors: [] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = grid[y][x], c = { x: x + 0.5, y: y + 0.5, gx: x, gy: y };
      if (ch === 'P') { m.start = c; grid[y][x] = '.'; }
      else if (ch === 'E') { m.exit = c; grid[y][x] = '.'; }
      else if (ch === 'S') { m.hostage = c; grid[y][x] = '.'; }
      else if (ch === 'I') { m.intel = c; grid[y][x] = '.'; }
      else if (SC.isTerm(ch)) { m.terms.push(Object.assign(c, { kind: ch, spec: SC.hackSpec(ch, def.id, x, y), done: false })); grid[y][x] = '.'; }
      else if (SC.isDoor(ch)) m.doors.push(Object.assign(c, { kind: ch, spec: SC.hackSpec(ch, def.id, x, y), open: false }));
    }
    return m;
  };

  /* ---------- gerador: salas + corredores (BSP) ---------- */
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function bfs(g, W, H, sx, sy) {
    const d = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H);
    let a = 0, b = 0; d[sx + sy * W] = 0; q[b++] = sx + sy * W;
    while (a < b) {
      const c = q[a++], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || g[ny][nx] === '#' || d[nx + ny * W] >= 0) continue;
        d[nx + ny * W] = d[c] + 1; q[b++] = nx + ny * W;
      }
    }
    return d;
  }

  function tryGenerate(o, seed) {
    const rnd = SC.rng(seed), ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
    const W = o.w, H = o.h, g = Array.from({ length: H }, () => Array(W).fill('#'));
    const minLeaf = o.minLeaf || 8, maxLeaf = o.maxLeaf || 16, rooms = [];

    /* salas */
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

    /* ligações extras criam voltas (rotas alternativas) */
    const loops = o.loops != null ? o.loops : Math.floor(rooms.length * 0.18);
    for (let i = 0; i < loops; i++) {
      const a = rooms[ri(0, rooms.length - 1)];
      const near = rooms.filter(r => r !== a).sort((p, q) => Math.hypot(p.cx - a.cx, p.cy - a.cy) - Math.hypot(q.cx - a.cx, q.cy - a.cy));
      corridor(a, near[ri(0, Math.min(2, near.length - 1))]);
    }

    /* pilares e caixas: quebram a linha de visão sem bloquear o caminho */
    const floorCount = () => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] !== '#') n++; return n; };
    const connected = () => { const d = bfs(g, W, H, rooms[0].cx, rooms[0].cy); let n = 0; for (let i = 0; i < d.length; i++) if (d[i] >= 0) n++; return n === floorCount(); };
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

    /* sala inicial: a que fica mais perto de um canto sorteado */
    const corner = [[0, 0], [W, 0], [0, H], [W, H]][ri(0, 3)];
    const startRoom = rooms.slice().sort((a, b) => Math.hypot(a.cx - corner[0], a.cy - corner[1]) - Math.hypot(b.cx - corner[0], b.cy - corner[1]))[0];
    const dist = bfs(g, W, H, startRoom.cx, startRoom.cy);
    rooms.forEach(r => { r.d = dist[r.cx + r.cy * W]; });
    const others = rooms.filter(r => r !== startRoom).sort((a, b) => b.d - a.d);
    const exitRoom = others[Math.floor(others.length * (0.15 + 0.4 * rnd()))];
    const far = others.filter(r => r !== exitRoom);

    /* entidades */
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
    const doors = [];
    const chokes = []; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (choke(x, y)) chokes.push([x, y]);
    const putDoor = (x, y, kind) => { g[y][x] = kind; doors.push([x, y]); };
    const farFromDoors = (x, y, n) => !doors.some(([dx, dy]) => Math.max(Math.abs(dx - x), Math.abs(dy - y)) < n);
    const entrances = room => chokes.filter(([x, y]) => g[y][x] === '.' && D4.some(([dx, dy]) => inRoom(room, x + dx, y + dy)));
    if (o.gate && hardest.length) {
      const hard = o.mode === 'infil' ? g[hardest[0].cy] && ents.filter(e => SC.isTerm(e.ch) && e.room === hardest[0])[0].ch : 'x';
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

    /* guardas: patrulhas em retângulo dentro das salas */
    const guards = [], pool = shuffle(rooms.filter(r => r !== startRoom));
    pool.sort((a, b) => (used.has(b.id) ? 1 : 0) - (used.has(a.id) ? 1 : 0));
    for (let i = 0; i < (o.guards || 0); i++) {
      const r = pool[i % pool.length], lap = Math.floor(i / pool.length), ins = lap % 2 ? 0 : 1;
      const x0 = r.x + ins, x1 = r.x + r.w - 1 - ins, y0 = r.y + ins, y1 = r.y + r.h - 1 - ins;
      let path;
      if (x1 - x0 >= 2 && y1 - y0 >= 2) path = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      else if (r.w >= r.h) path = [[r.x + 1, r.cy], [r.x + r.w - 2, r.cy]];
      else path = [[r.cx, r.y + 1], [r.cx, r.y + r.h - 2]];
      if (i % 2) path.reverse();
      const k = ri(0, path.length - 1); guards.push({ path: path.slice(k).concat(path.slice(0, k)) });
    }
    /* câmeras: nos cantos das salas, apontando para o centro */
    const cams = [], camRooms = shuffle(rooms.filter(r => r !== startRoom && r !== exitRoom));
    for (let i = 0; i < (o.cams || 0) && i < camRooms.length; i++) {
      const r = camRooms[i], cs = shuffle([[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]]);
      const c = cs.find(([x, y]) => g[y][x] === '.'); if (!c) continue;
      cams.push({ x: c[0] + 0.5, y: c[1] + 0.5, a: +Math.atan2(r.cy - c[1], r.cx - c[0]).toFixed(2), sweep: +(0.35 + rnd() * 0.25).toFixed(2) });
    }

    /* validação: tudo alcançável (portas contam como passáveis) */
    const d = bfs(g, W, H, startRoom.cx, startRoom.cy);
    for (const e of ents) if (d[e.x + e.y * W] < 0) return null;
    return { map: g.map(r => r.join('')), guards, cams };
  }

  function generate(o) {
    for (let i = 0; i < 80; i++) { const r = tryGenerate(o, o.seed + i * 7919); if (r) return r; }
    throw new Error('Falha ao gerar o mapa ' + o.id);
  }

  /* ---------- catálogo ---------- */
  const LAB = {
    map: [
      '######################',
      '#P...#.......#......s#',
      '#....#.......#.......#',
      '#............#..##...#',
      '#....#..##......##...#',
      '#....#..##...#.......#',
      '###d####..####..######',
      '#..........#.........#',
      '#..........#.........#',
      '#...###....#.........#',
      '#...###..............#',
      '#..........#####..####',
      '#..........#.........#',
      '#E.........#....I....#',
      '######################'],
    guards: [{ path: [[6, 1], [12, 1], [12, 3], [6, 3]] }, { path: [[8, 8], [3, 8], [3, 11], [8, 11]] }, { path: [[13, 7], [19, 7], [19, 10], [13, 10]] }],
    cams: [{ x: 19.5, y: 5.5, a: -2.35, sweep: 0.6 }, { x: 10.5, y: 13.5, a: 3.14, sweep: 0.4 }]
  };
  const RESCUE = {
    map: [
      '######################',
      '#P.....#.............#',
      '#......#..###........#',
      '#..##.....###....#...#',
      '#..##............#...#',
      '#......#.........#..I#',
      '####d###########.#####',
      '#.........#..........#',
      '#.........#..........#',
      '#...##....#....##....#',
      '#...##.........##....#',
      '#.........#..........#',
      '######..###....##.####',
      '#E.............#...S.#',
      '######################'],
    guards: [{ path: [[8, 1], [16, 1], [16, 5], [8, 5]] }, { path: [[8, 7], [1, 7], [1, 11], [8, 11]] }, { path: [[12, 8], [19, 8], [19, 11], [12, 11]] }],
    cams: [{ x: 14.5, y: 13.5, a: 3.14, sweep: 0.35 }]
  };
  const BUNKER = {
    map: [
      '####################',
      '#P....#.......#....#',
      '#.....#.......#.m..#',
      '#.....d.......v....#',
      '#.....#.......#....#',
      '###.###.......######',
      '#.....#.......#....#',
      '#.....#..###..#....#',
      '#.....#..###..k....#',
      '#E....d.......#....#',
      '#.....#.......#..I.#',
      '####################'],
    guards: [{ path: [[8, 2], [12, 2], [12, 9], [8, 9]] }],
    cams: [{ x: 7.5, y: 1.5, a: 1.57, sweep: 0.4 }, { x: 18.5, y: 1.5, a: 2.68, sweep: 0.3 }]
  };

  const DEFS = [
    /* ===== INVASÃO ===== */
    Object.assign({
      id: 'lab', mode: 'infil', name: 'Laboratório Apex', code: 'Operação Kestrel', theme: 'cyber', kind: 'Espionagem',
      place: 'Complexo Apex Tech, zona de contestação',
      brief: 'Um laboratório rival está a dias de concluir um protocolo que deixaria seu bloco uma geração atrás. Entre, hackeie o servidor e saia sem ser visto.',
      intelName: 'Amostras de bio-síntese'
    }, LAB),
    Object.assign({
      id: 'bunker', mode: 'infil', name: 'Bunker Compacto', code: 'Operação Cofre Mínimo', theme: 'toxic', kind: 'Invasão',
      place: 'Bunker de comunicações, setor 9',
      brief: 'Mapa minúsculo, alvo pesado: um único mainframe atrás de uma porta-cofre. São poucos passos, mas as sequências são longas. Uma câmera vigia o corredor.',
      intelName: 'Chaves de criptografia'
    }, BUNKER),
    { id: 'posto', mode: 'infil', name: 'Posto Avançado', code: 'Operação Primeira Luz', theme: 'cyber', kind: 'Invasão', place: 'Posto de vigilância na fronteira',
      brief: 'Um posto pequeno com um único computador comum. Bom para aprender o ritmo: entrar, hackear, sair.', intelName: 'Registros de patrulha',
      gen: { seed: 11, w: 30, h: 20, minLeaf: 7, maxLeaf: 12, terms: { p: 1 }, doors: { d: 1 }, guards: 2, cams: 1 } },
    { id: 'escritorio', mode: 'infil', name: 'Escritório Corporativo', code: 'Operação Papel Timbrado', theme: 'cyber', kind: 'Espionagem', place: 'Sede da Meridian Holdings, 14º andar',
      brief: 'Um servidor guardado atrás de uma porta com teclado, no fundo do andar. Dois seguranças e câmeras nos corredores.', intelName: 'Contratos sigilosos',
      gen: { seed: 23, w: 40, h: 26, minLeaf: 8, maxLeaf: 13, terms: { s: 1 }, doors: { d: 1, k: 1 }, gate: true, guards: 4, cams: 2 } },
    { id: 'cofre', mode: 'infil', name: 'Cofre do Banco', code: 'Operação Último Dígito', theme: 'violet', kind: 'Invasão', place: 'Banco Central, subsolo B',
      brief: 'Um único alvo, o mainframe do cofre, protegido por porta-cofre e muita vigilância. Sequência longa, tempo apertado.', intelName: 'Livro de contas',
      gen: { seed: 5, w: 34, h: 22, minLeaf: 7, maxLeaf: 12, terms: { m: 1 }, doors: { k: 1, d: 1 }, gate: true, guards: 4, cams: 3 } },
    { id: 'torre', mode: 'infil', name: 'Torre de Comando', code: 'Operação Vertigem', theme: 'violet', kind: 'Invasão', place: 'Torre de controle aéreo, 20 andares',
      brief: 'Um prédio estreito e alto, três terminais de dificuldades diferentes e portas em todo lugar. Hackeie todos antes de descer.', intelName: 'Planos de voo',
      gen: { seed: 71, w: 26, h: 48, minLeaf: 7, maxLeaf: 14, terms: { m: 1, s: 1, p: 1 }, doors: { d: 2, k: 1 }, gate: true, guards: 7, cams: 4 } },
    { id: 'datacenter', mode: 'infil', name: 'Data Center', code: 'Operação Nuvem Negra', theme: 'cyber', kind: 'Invasão', place: 'Data center Helix, nível de servidores',
      brief: 'Quatro terminais espalhados em um prédio grande: um PC, dois servidores e o mainframe central. Planeje a rota e escolha quais portas valem o risco.', intelName: 'Backups não catalogados',
      gen: { seed: 37, w: 56, h: 36, minLeaf: 8, maxLeaf: 15, terms: { m: 1, s: 2, p: 1 }, doors: { d: 2, k: 2 }, gate: true, guards: 8, cams: 5 } },
    { id: 'complexo', mode: 'infil', name: 'Complexo Industrial', code: 'Operação Altos-Fornos', theme: 'toxic', kind: 'Sabotagem digital', place: 'Complexo Ferrovale, planta principal',
      brief: 'Um mapa enorme: seis terminais, de PCs simples a dois mainframes, e uma frota de guardas. Não tem pressa, mas tem muito para ver.', intelName: 'Projetos de maquinário',
      gen: { seed: 101, w: 84, h: 54, minLeaf: 9, maxLeaf: 18, terms: { m: 2, s: 2, p: 2 }, doors: { d: 3, k: 3, v: 1 }, gate: true, guards: 14, cams: 8 } },

    /* ===== RESGATE ===== */
    Object.assign({
      id: 'rescue', mode: 'rescue', name: 'Estação Abandonada', code: 'Operação Fio de Ariadne', theme: 'bio', kind: 'Extração',
      place: 'Estação de pesquisa abandonada, Zona de Ruptura', hostageName: 'Dra. Amara Diallo',
      brief: 'A Dra. Amara Diallo, especialista em agricultura resiliente, ficou para trás quando a região colapsou. Saqueadores ocuparam a estação. Encontre-a e traga-a de volta.',
      intelName: 'Mapa geológico de lítio'
    }, RESCUE),
    { id: 'cabana', mode: 'rescue', name: 'Cabana', code: 'Operação Lenha Seca', theme: 'bio', kind: 'Extração', place: 'Cabana na floresta, vale do Rio Claro', hostageName: 'o guia Tomás',
      brief: 'Pequena e silenciosa: um único vigia. É o resgate mais simples do catálogo.', intelName: 'Rádio de campanha',
      gen: { seed: 3, w: 24, h: 16, minLeaf: 6, maxLeaf: 10, minRooms: 4, doors: {}, guards: 1, cams: 0 } },
    { id: 'casa', mode: 'rescue', name: 'Casa Abandonada', code: 'Operação Janela Quebrada', theme: 'bio', kind: 'Extração', place: 'Casarão no bairro velho', hostageName: 'a jornalista Inês Prado',
      brief: 'A refém está trancada num cômodo com porta de teclado. Dois guardas e uma câmera.', intelName: 'Caderno de anotações',
      gen: { seed: 19, w: 30, h: 20, minLeaf: 7, maxLeaf: 12, doors: { d: 1 }, gate: true, gateKind: 'k', guards: 2, cams: 1 } },
    { id: 'estacao', mode: 'rescue', name: 'Estação de Trem', code: 'Operação Último Vagão', theme: 'violet', kind: 'Extração', place: 'Terminal ferroviário desativado', hostageName: 'o engenheiro Caio Mendes',
      brief: 'Um mapa comprido e aberto, com muitas salas em fila. A porta onde ele está é daquelas que pedem sequência média.', intelName: 'Manifesto de carga',
      gen: { seed: 83, w: 56, h: 20, minLeaf: 7, maxLeaf: 13, doors: { d: 2, k: 1 }, gate: true, gateKind: 'k', guards: 5, cams: 2 } },
    { id: 'hospital', mode: 'rescue', name: 'Hospital Desativado', code: 'Operação Ala Norte', theme: 'bio', kind: 'Extração', place: 'Hospital São Jorge, ala isolada', hostageName: 'a Dra. Helena Rocha',
      brief: 'Corredores, quartos e salas de cirurgia. A refém está na ala mais distante, atrás de uma porta com teclado.', intelName: 'Prontuários',
      gen: { seed: 29, w: 42, h: 28, minLeaf: 8, maxLeaf: 13, doors: { d: 2, k: 1 }, gate: true, gateKind: 'k', guards: 6, cams: 2 } },
    { id: 'base', mode: 'rescue', name: 'Base Saqueadora', code: 'Operação Toca do Lobo', theme: 'toxic', kind: 'Extração', place: 'Antigo depósito militar, Zona Leste', hostageName: 'o coronel Brandão',
      brief: 'Uma base grande, com muitos guardas e portas pesadas. O refém está na cela com porta-cofre.', intelName: 'Inventário de armas',
      gen: { seed: 43, w: 64, h: 42, minLeaf: 8, maxLeaf: 16, doors: { d: 3, k: 2, v: 1 }, gate: true, gateKind: 'v', guards: 10, cams: 4 } },
    { id: 'subterranea', mode: 'rescue', name: 'Cidade Subterrânea', code: 'Operação Raiz Funda', theme: 'violet', kind: 'Extração', place: 'Metrô abandonado, nível -4', hostageName: 'a Dra. Yasmin Haddad',
      brief: 'O maior mapa do jogo: um labirinto de salas e túneis, com muitas portas e guardas. A refém está lá no fundo.', intelName: 'Mapas de túneis',
      gen: { seed: 59, w: 92, h: 56, minLeaf: 9, maxLeaf: 18, doors: { d: 4, k: 3, v: 2 }, gate: true, gateKind: 'v', guards: 16, cams: 8 } }
  ];

  const sizeLabel = n => n <= 450 ? 'Pequeno' : n <= 1000 ? 'Médio' : n <= 2000 ? 'Grande' : 'Enorme';

  SC.MAPS = DEFS.map(d => {
    const def = Object.assign({}, d);
    if (def.gen) Object.assign(def, generate(Object.assign({ id: def.id, mode: def.mode }, def.gen)));
    def.map = def.map; def.guards = def.guards || []; def.cams = def.cams || [];
    if (def.mode === 'infil') {
      def.goal = 'Hackear os terminais'; def.goal2 = 'Chegar ao ponto de extração'; def.opt = 'Opcional: recolher ' + def.intelName.toLowerCase();
    } else {
      def.goal = 'Localizar ' + def.hostageName; def.goal2 = 'Escoltar até a extração'; def.opt = 'Opcional: recuperar ' + def.intelName.toLowerCase();
    }
    const p = SC.parseMap(def);
    def.W = p.W; def.H = p.H; def.size = sizeLabel(p.W * p.H);
    def.nTerms = p.terms.length; def.nDoors = p.doors.length;
    const lens = p.terms.map(t => t.spec.len); def.termMin = lens.length ? Math.min(...lens) : 0; def.termMax = lens.length ? Math.max(...lens) : 0;
    def.doorMin = p.doors.length ? Math.min(...p.doors.map(t => t.spec.len)) : 0; def.doorMax = p.doors.length ? Math.max(...p.doors.map(t => t.spec.len)) : 0;
    return def;
  });
  SC.mapById = id => SC.MAPS.find(m => m.id === id);
})(window.SC);
