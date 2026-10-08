/* ============================================================================
   maps.js — tabela de hack, níveis de dificuldade e montagem do catálogo.

   Terminais e portas são hackeados com a sequência de setas (js/hack.js).
   O TAMANHO da sequência não é sorteado: depende do tipo do alvo (tabela HACK) e
   da dificuldade do mapa (SC.DIFF). Mínimo global 3, máximo global 12.
   A geometria dos mapas gerados vem de js/mapdata.js (criado por tools/build-maps.js).
   ========================================================================== */
(function (SC) {
  'use strict';

  /* constantes de visão (as mesmas do protótipo); a dificuldade soma alcance */
  SC.K = { G_RANGE: 5, G_FOV: 0.55, C_RANGE: 6, C_FOV: 0.38, G_SPEED: 1.25, G_CHASE: 2.0 };

  /* ---------- tabela de dificuldade do hack, por tipo de alvo ----------
     min/max: faixa de teclas · per: segundos por tecla · slack: folga fixa em segundos */
  const HACK = {
    d: { name: 'Fechadura magnética', short: 'FECH', tier: 1, min: 3,  max: 4,  per: 1.10, slack: 1.6, door: true },
    p: { name: 'Terminal de rua',     short: 'TERM', tier: 1, min: 4,  max: 5,  per: 1.00, slack: 1.5 },
    k: { name: 'Porta cifrada',       short: 'CIFR', tier: 2, min: 5,  max: 6,  per: 0.95, slack: 1.5, door: true },
    s: { name: 'Servidor corporativo', short: 'SERV', tier: 3, min: 7,  max: 9,  per: 0.85, slack: 1.3 },
    v: { name: 'Cofre quântico',      short: 'COFRE', tier: 4, min: 9,  max: 11, per: 0.80, slack: 1.3, door: true },
    m: { name: 'Núcleo mainframe',    short: 'NÚCLEO', tier: 5, min: 11, max: 12, per: 0.75, slack: 1.2 }
  };
  SC.HACK = HACK;
  SC.isDoor = ch => ch === 'd' || ch === 'k' || ch === 'v';
  SC.isTerm = ch => ch === 'p' || ch === 's' || ch === 'm';

  /* ---------- níveis de dificuldade (cada mapa pertence a um) ----------
     det: velocidade do rastreamento · gSpeed: velocidade dos guardas · range: alcance extra dos cones
     lenAdd: teclas a mais em cada hack (f404 força 12) · timeMul: multiplicador do tempo do hack
     penalty: segundos perdidos a cada tecla errada · alarmMul: prazo após o alarme */
  SC.DIFF = [
    { id: 'basico', n: 1, name: 'Básico', col: '#5ED99B', det: 0.7, gSpeed: 1.0, range: 0, lenAdd: -1, timeMul: 1.3, penalty: 0, alarmMul: 1.2,
      blurb: 'Rastreamento lento, mais tempo e sequências mais curtas. Para aprender o ritmo.' },
    { id: 'normal', n: 2, name: 'Normal', col: '#3FD6FF', det: 1.0, gSpeed: 1.0, range: 0, lenAdd: 0, timeMul: 1.0, penalty: 0, alarmMul: 1.0,
      blurb: 'A experiência padrão: guardas atentos, hacks no tempo certo.' },
    { id: 'dificil', n: 3, name: 'Difícil', col: '#FFD24A', det: 1.15, gSpeed: 1.05, range: 0.5, lenAdd: 0, timeMul: 0.95, penalty: 0, alarmMul: 0.95,
      blurb: 'Guardas enxergam mais longe e o rastreamento sobe mais rápido.' },
    { id: 'hacker', n: 4, name: 'Hacker', col: '#FF9548', det: 1.3, gSpeed: 1.1, range: 0.5, lenAdd: 1, timeMul: 0.9, penalty: 0, alarmMul: 0.9,
      blurb: 'Uma tecla a mais em cada hack, menos tempo e vigilância pesada.' },
    { id: 'god', n: 5, name: 'God', col: '#FF5C7A', det: 1.5, gSpeed: 1.15, range: 1.0, lenAdd: 2, timeMul: 0.85, penalty: 0.5, alarmMul: 0.8,
      blurb: 'Cada tecla errada custa meio segundo. Guardas rápidos, cones longos e mapas cheios de câmeras.' },
    { id: 'f404', n: 6, name: '404', col: '#FF4FD8', det: 1.8, gSpeed: 1.25, range: 1.2, lenAdd: 12, timeMul: 0.7, penalty: 1.0, alarmMul: 0.65, all12: true,
      blurb: 'Todo hack tem 12 teclas, cada erro custa 1 s, mapas gigantes e vigilância absurda. Só para quem é muito bom.' }
  ];
  SC.diffById = id => SC.DIFF.find(d => d.id === id) || SC.DIFF[1];
  SC.diffOf = def => SC.diffById(def && def.diff);

  /* o tamanho da sequência é fixo por alvo (mesmo mapa, mesmo alvo, mesma dificuldade, mesmo tamanho) */
  SC.hackSpec = function (kind, mapId, gx, gy, diff) {
    const h = HACK[kind], D = diff || SC.DIFF[1];
    const base = h.min + (SC.hash(mapId, gx, gy) % (h.max - h.min + 1));
    const len = D.all12 ? 12 : Math.max(3, Math.min(12, base + D.lenAdd));
    /* em 404 o tempo por tecla é o do Mainframe, para os 12 serem sempre equivalentes */
    const per = D.all12 ? HACK.m.per : h.per, slack = D.all12 ? HACK.m.slack : h.slack;
    return { kind, name: h.name, short: h.short, tier: h.tier, len, time: +((slack + len * per) * D.timeMul).toFixed(1), door: !!h.door, penalty: D.penalty };
  };

  /* ---------- leitura de um mapa em ASCII ---------- */
  SC.parseMap = function (def) {
    const rows = def.map, H = rows.length, W = Math.max(...rows.map(r => r.length)), D = SC.diffOf(def);
    const grid = rows.map(r => r.padEnd(W, '#').split(''));
    const m = { def, W, H, grid, start: null, exit: null, hostage: null, intel: null, terms: [], doors: [], diff: D };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = grid[y][x], c = { x: x + 0.5, y: y + 0.5, gx: x, gy: y };
      if (ch === 'P') { m.start = c; grid[y][x] = '.'; }
      else if (ch === 'E') { m.exit = c; grid[y][x] = '.'; }
      else if (ch === 'S') { m.hostage = c; grid[y][x] = '.'; }
      else if (ch === 'I') { m.intel = c; grid[y][x] = '.'; }
      else if (SC.isTerm(ch)) { m.terms.push(Object.assign(c, { kind: ch, spec: SC.hackSpec(ch, def.id, x, y, D), done: false })); grid[y][x] = '.'; }
      else if (SC.isDoor(ch)) m.doors.push(Object.assign(c, { kind: ch, spec: SC.hackSpec(ch, def.id, x, y, D), open: false }));
    }
    return m;
  };

  /* ---------- catálogo final ---------- */
  const sizeLabel = n => n <= 450 ? 'Pequeno' : n <= 1000 ? 'Médio' : n <= 2000 ? 'Grande' : n <= 4500 ? 'Enorme' : 'Colossal';
  SC.THEMES = { cyber: '#3FD6FF', bio: '#FF9548', toxic: '#8CFF7A', violet: '#B58CFF', glitch: '#FF4FD8' };

  SC.buildMaps = function () {
    SC.MAPS = SC.CATALOG.map(d => {
      const def = Object.assign({}, d);
      if (def.gen) {
        const g = (SC.MAPDATA || {})[def.id];
        if (!g) throw new Error('Mapa "' + def.id + '" sem geometria. Rode: node tools/build-maps.js');
        Object.assign(def, g);
      }
      def.guards = def.guards || []; def.cams = def.cams || [];
      const D = SC.diffOf(def);
      if (def.mode === 'infil') { def.goal = 'Hackear os terminais'; def.goal2 = 'Chegar à extração'; def.opt = 'Opcional: recolher ' + def.intelName.toLowerCase(); }
      else { def.goal = 'Localizar ' + def.hostageName; def.goal2 = 'Escoltar até a extração'; def.opt = 'Opcional: recuperar ' + def.intelName.toLowerCase(); }
      const p = SC.parseMap(def);
      def.W = p.W; def.H = p.H; def.size = sizeLabel(p.W * p.H); def.dn = D.n;
      def.nTerms = p.terms.length; def.nDoors = p.doors.length;
      const lens = p.terms.map(t => t.spec.len), dl = p.doors.map(t => t.spec.len);
      def.termMin = lens.length ? Math.min(...lens) : 0; def.termMax = lens.length ? Math.max(...lens) : 0;
      def.doorMin = dl.length ? Math.min(...dl) : 0; def.doorMax = dl.length ? Math.max(...dl) : 0;
      return def;
    });
    SC.mapById = id => SC.MAPS.find(m => m.id === id);
  };
  if (!window.NO_AUTOBUILD) SC.buildMaps();
})(window.SC);
