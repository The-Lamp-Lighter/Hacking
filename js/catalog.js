/* ============================================================================
   catalog.js — a lista de missões (só dados): nomes, dificuldade, história e,
   para os mapas gerados, os parâmetros do gerador.

   Mapas à mão têm `map`, `guards` e `cams` aqui mesmo.
   Mapas gerados têm `gen: {...}`; a geometria sai pronta em js/mapdata.js,
   criada por `node tools/build-maps.js` (ele também confere se todo objetivo
   tem um ponto de hack fora da visão de guardas e câmeras).

   Legenda do mapa:  # parede · . piso · P início · E extração · S refém · I item opcional
                     p s m terminais (PC, servidor, mainframe) · d k v portas (básica, cifrada, cofre)
   ========================================================================== */
(function (SC) {
  'use strict';

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
    cams: [{ x: 7.5, y: 1.5, a: 1.57, sweep: 0.4 }, { x: 18.5, y: 6.5, a: 2.21, sweep: 0.3 }]
  };

  /* ordem aqui = ordem de criação; a tela de seleção ordena por dificuldade */
  SC.CATALOG = [
    /* ================= INVASÃO ================= */
    { id: 'posto', mode: 'infil', diff: 'basico', name: 'Ponto Cego', code: 'Operação Primeira Luz', theme: 'cyber', kind: 'Aquecimento',
      place: 'Checkpoint Aurora-9, Zona Leste', intelName: 'Escala de vigias',
      tagline: 'Um terminal velho e uma lista esquecida.',
      story: 'Orquídea, sua fixer, quer ver se você ainda tem mão. O checkpoint da Aurora-9 guarda, num terminal antigo, a lista de entregadores que a empresa nunca pagou. Faz meses que ninguém olha para esse posto, e a segurança é um vigia entediado. Entre, copie a lista e saia antes que o café dele esfrie.',
      win: 'A lista chegou a dez mil telas antes do café. Orquídea responde só com "joia" e manda um novo contrato.',
      gen: { seed: 11, w: 30, h: 20, minLeaf: 7, maxLeaf: 12, terms: { p: 1 }, doors: { d: 1 }, guards: 2, cams: 1 } },

    Object.assign({ id: 'lab', mode: 'infil', diff: 'normal', name: 'Laboratório Kestrel', code: 'Operação Kestrel', theme: 'cyber', kind: 'Espionagem',
      place: 'Apex Tech, Distrito Ótico', intelName: 'Amostras de bio-síntese',
      tagline: 'Roube o protocolo antes do lançamento.',
      story: 'A Apex Tech lança na sexta o Protocolo Kestrel, um compilador que deixaria o resto da cidade uma geração para trás. Um cliente anônimo quer uma cópia na quinta. O servidor fica no fundo do laboratório, atrás de uma porta magnética e de três guardas que adoram uma ronda em círculo. Estude os cones, escolha a hora e hackeie.',
      win: 'O Kestrel agora roda em três gambiarras de garagem. A Apex vai passar a sexta inteira tentando descobrir quem vazou.' }, LAB),

    { id: 'escritorio', mode: 'infil', diff: 'normal', name: 'Meridian, Andar 14', code: 'Operação Papel Timbrado', theme: 'cyber', kind: 'Espionagem',
      place: 'Torre Meridian Holdings, andar 14', intelName: 'Contratos sigilosos',
      tagline: 'Contratos secretos atrás de uma porta cifrada.',
      story: 'Um advogado da Meridian decidiu vender os próprios contratos para o lado errado e depois sumiu. Os arquivos continuam no servidor do andar 14, atrás de uma porta cifrada. Há câmeras nos corredores e dois seguranças que odeiam hora extra, o que ajuda e atrapalha. Pegue o que ele esqueceu.',
      win: 'Os contratos vazam em ordem alfabética. A Meridian demite metade do jurídico antes do almoço.',
      gen: { seed: 23, w: 40, h: 26, minLeaf: 8, maxLeaf: 13, terms: { s: 1 }, doors: { d: 1, k: 1 }, gate: true, guards: 4, cams: 2 } },

    Object.assign({ id: 'bunker', mode: 'infil', diff: 'dificil', name: 'Bunker Zero-9', code: 'Operação Cofre Mínimo', theme: 'toxic', kind: 'Invasão',
      place: 'Bunker de comunicações, setor 9', intelName: 'Chaves de criptografia',
      tagline: 'Pouco espaço, sequências longas.',
      story: 'Zero-9 é um bunker esquecido que ainda retransmite as ordens de uma milícia corporativa. O mapa cabe na palma da mão, mas o mainframe está atrás de um cofre quântico e uma câmera vigia o corredor central. Não há rota longa para planejar: o que pesa aqui é a mão firme na hora de digitar.',
      win: 'O retransmissor calou. Em toda a cidade, uma dúzia de drones ficou sem ordens e pousou onde estava.' }, BUNKER),

    { id: 'cofre', mode: 'infil', diff: 'dificil', name: 'O Último Dígito', code: 'Operação Cofre Aberto', theme: 'violet', kind: 'Invasão',
      place: 'Banco Aurora, subsolo B', intelName: 'Livro de contas',
      tagline: 'Um único mainframe, nenhuma margem de erro.',
      story: 'O Banco Aurora jura que o cofre do subsolo B nunca foi aberto por ninguém de fora. Seu contratante só quer provar o contrário. Um mainframe, uma porta de cofre quântico, guardas contados nos dedos e câmeras suficientes para um reality show. Seja rápido nos dígitos, mas principalmente seja paciente.',
      win: 'O cofre abriu. O banco vai emitir uma nota dizendo que nada aconteceu, e ninguém vai acreditar.',
      gen: { seed: 5, w: 34, h: 22, minLeaf: 7, maxLeaf: 12, terms: { m: 1 }, doors: { k: 1, d: 1 }, gate: true, guards: 5, cams: 4 } },

    { id: 'torre', mode: 'infil', diff: 'hacker', name: 'Torre Vertigem', code: 'Operação Céu Fechado', theme: 'violet', kind: 'Sabotagem',
      place: 'Controle aéreo Helix, 20 andares', intelName: 'Planos de voo',
      tagline: 'Quatro terminais, vinte andares, nenhum elevador.',
      story: 'A Helix controla o tráfego de todos os drones da cidade a partir de uma torre estreita e alta. Para derrubar a rede de entregas por uma noite, quatro terminais precisam cair, espalhados pelos andares. Os corredores são curtos, as portas são muitas e cada passo conta.',
      win: 'Por seis horas nenhum drone da cidade soube para onde ir. Os pombos reclamaram do tráfego.',
      gen: { seed: 71, w: 26, h: 48, minLeaf: 7, maxLeaf: 14, terms: { m: 1, s: 2, p: 1 }, doors: { d: 2, k: 2 }, gate: true, guards: 9, cams: 5 } },

    { id: 'datacenter', mode: 'infil', diff: 'god', name: 'Nuvem Negra', code: 'Operação Backup Fantasma', theme: 'cyber', kind: 'Invasão',
      place: 'Data center Helix, nível de servidores', intelName: 'Backups não catalogados',
      tagline: 'Seis alvos num prédio que nunca dorme.',
      story: 'Debaixo da cidade, a Nuvem Negra guarda os backups que nenhuma empresa admite ter. Seis terminais, entre PCs de manutenção, servidores e o núcleo central, precisam cair na mesma noite. Os guardas usam nanolentes e o chão tem sensores. Planeje a rota, decida quais portas valem o risco e não confie em corredor vazio.',
      win: 'Os backups proibidos viraram notícia. Três diretorias renunciaram, e uma delas já estava de férias.',
      gen: { seed: 37, w: 56, h: 36, minLeaf: 8, maxLeaf: 15, terms: { m: 1, s: 3, p: 2 }, doors: { d: 2, k: 3, v: 1 }, gate: true, guards: 12, cams: 8 } },

    { id: 'complexo', mode: 'infil', diff: 'god', name: 'Altos-Fornos', code: 'Operação Fumaça Densa', theme: 'toxic', kind: 'Sabotagem',
      place: 'Ferrovale Heavy Industries, planta principal', intelName: 'Projetos de maquinário',
      tagline: 'Oito terminais e uma frota de vigilantes.',
      story: 'A Ferrovale esconde, sob a fumaça da planta principal, os projetos de uma máquina que nenhuma lei ainda proibiu. Oito terminais, mais de uma dúzia de portas e dezoito vigilantes patrulham um complexo que parece uma cidade. Não existe pressa aqui, só mapa demais. Leve água, café e paciência.',
      win: 'Os projetos saíram junto com a fumaça. A Ferrovale diz que era só vapor.',
      gen: { seed: 101, w: 84, h: 54, minLeaf: 9, maxLeaf: 18, terms: { m: 3, s: 3, p: 2 }, doors: { d: 4, k: 4, v: 2 }, gate: true, guards: 18, cams: 12 } },

    { id: 'nucleo', mode: 'infil', diff: 'f404', name: 'Núcleo 404', code: 'Operação Erro Fatal', theme: 'glitch', kind: 'Lenda',
      place: 'Servidor sem endereço, nível desconhecido', intelName: 'Registro-mestre',
      tagline: 'O lugar que a rede apagou do mapa.',
      story: 'Dizem que o Núcleo 404 é o último servidor que nenhuma empresa assume ter, e que ele guarda os registros de todas as outras. Não há planta oficial, e o prédio parece maior por dentro. Doze terminais, dezenas de portas, vigilância em cada esquina e nada que peça menos de doze teclas. Se você chegou até aqui, a rede já sabe seu nome.',
      win: 'Você saiu do Núcleo 404. A rede apagou seu nome dos registros, mas a lenda continua.',
      gen: { seed: 404, w: 112, h: 70, minLeaf: 9, maxLeaf: 18, terms: { m: 5, s: 4, p: 3 }, doors: { d: 6, k: 6, v: 6 }, gate: true, guards: 32, cams: 22 } },

    /* ================= RESGATE ================= */
    { id: 'cabana', mode: 'rescue', diff: 'basico', name: 'Cabana do Sinal', code: 'Operação Lenha Seca', theme: 'bio', kind: 'Extração',
      place: 'Cabana na floresta, Vale do Rio Claro', hostageName: 'o mensageiro Tomás', intelName: 'Rádio de campanha',
      tagline: 'Um vigia só e uma porta de madeira.',
      story: 'Tomás levava mensagens entre duas comunidades fora da rede, até uma milícia prendê-lo numa cabana. Só há um vigia por perto e nenhuma câmera. É o resgate ideal para treinar a calma: encontre-o, tire-o de lá e leve até a luz.',
      win: 'Tomás sai da floresta com os dois pés e a mensagem intacta. Agradece em três idiomas e uma gíria.',
      gen: { seed: 3, w: 24, h: 16, minLeaf: 6, maxLeaf: 10, minRooms: 4, doors: {}, guards: 1, cams: 0 } },

    Object.assign({ id: 'rescue', mode: 'rescue', diff: 'normal', name: 'Estação Ariadne', code: 'Operação Fio de Ariadne', theme: 'bio', kind: 'Extração',
      place: 'Estação de pesquisa abandonada, Zona de Ruptura', hostageName: 'a Dra. Amara Diallo', intelName: 'Mapa geológico de lítio',
      tagline: 'Uma cientista ficou para trás.',
      story: 'Quando a região colapsou, a Dra. Amara Diallo, especialista em agricultura resiliente, ficou presa na estação de pesquisa. Saqueadores ocuparam o lugar e já arrancaram metade dos fios. Siga o fio de luz, encontre-a e traga-a de volta.',
      win: 'A Dra. Diallo volta com um frasco de sementes que ninguém sabia que existia. A primeira pergunta dela é se há café.' }, RESCUE),

    { id: 'casa', mode: 'rescue', diff: 'normal', name: 'Casarão Vidro Quebrado', code: 'Operação Janela Quebrada', theme: 'bio', kind: 'Extração',
      place: 'Casarão do bairro velho', hostageName: 'a jornalista Inês Prado', intelName: 'Caderno de anotações',
      tagline: 'Uma porta cifrada guarda uma jornalista.',
      story: 'Inês Prado publicou o que não devia sobre um vereador e foi trancada num casarão do bairro velho. A porta do quarto tem teclado, há dois guardas e uma câmera piscando no corredor. Chegue sem ser visto, abra a porta e leve-a para fora.',
      win: 'A reportagem sai na manhã seguinte, e o vereador descobre que a internet também lê jornal.',
      gen: { seed: 19, w: 30, h: 20, minLeaf: 7, maxLeaf: 12, doors: { d: 1 }, gate: true, gateKind: 'k', guards: 2, cams: 1 } },

    { id: 'estacao', mode: 'rescue', diff: 'dificil', name: 'Último Vagão', code: 'Operação Trilho Magnético', theme: 'violet', kind: 'Extração',
      place: 'Terminal ferroviário desativado', hostageName: 'o engenheiro Caio Mendes', intelName: 'Manifesto de carga',
      tagline: 'Um mapa comprido e muitas salas em fila.',
      story: 'Caio Mendes projetou o sistema de trilhos magnéticos da cidade, e alguém quer que ele esqueça como. Está preso no fundo de uma estação desativada, comprida como um trem. São muitas salas em fila, e cada porta exige atenção. Leve-o antes que o último vagão parta.',
      win: 'Caio chega ao ponto de encontro e já está desenhando uma saída melhor num guardanapo.',
      gen: { seed: 83, w: 56, h: 20, minLeaf: 7, maxLeaf: 13, doors: { d: 2, k: 2 }, gate: true, gateKind: 'k', guards: 7, cams: 3 } },

    { id: 'hospital', mode: 'rescue', diff: 'dificil', name: 'Ala Norte', code: 'Operação Laudo Verdadeiro', theme: 'bio', kind: 'Extração',
      place: 'Hospital São Jorge, ala isolada', hostageName: 'a Dra. Helena Rocha', intelName: 'Prontuários',
      tagline: 'Corredores brancos, luz fria e uma porta cifrada.',
      story: 'Helena Rocha é a médica que se recusou a assinar o laudo errado. Agora está num quarto da ala norte do São Jorge, isolada por uma porta cifrada. O hospital ainda funciona, o que significa corredores de luz fria e guardas fingindo ser enfermeiros. Entre sem fazer barulho.',
      win: 'A Dra. Rocha atravessa a rua sem olhar para trás. O laudo verdadeiro vai ao ar às seis.',
      gen: { seed: 29, w: 42, h: 28, minLeaf: 8, maxLeaf: 13, doors: { d: 2, k: 2 }, gate: true, gateKind: 'k', guards: 8, cams: 3 } },

    { id: 'base', mode: 'rescue', diff: 'hacker', name: 'Toca do Lobo', code: 'Operação Cela Funda', theme: 'toxic', kind: 'Extração',
      place: 'Antigo depósito militar, Zona Leste', hostageName: 'o coronel Brandão', intelName: 'Inventário de armas',
      tagline: 'Muitos guardas, portas pesadas e uma cela com cofre.',
      story: 'O coronel Brandão sabe onde ficam os depósitos de uma facção inteira, e a facção quer o silêncio dele. Está na cela mais funda da Toca do Lobo, atrás de um cofre quântico. Há guardas em todos os pátios, portas pesadas e pouco tempo. Este é o primeiro resgate que cobra de verdade do hacker.',
      win: 'O coronel vira testemunha, e a Toca do Lobo vira só um buraco com eco.',
      gen: { seed: 43, w: 64, h: 42, minLeaf: 8, maxLeaf: 16, doors: { d: 4, k: 3, v: 2 }, gate: true, gateKind: 'v', guards: 14, cams: 7 } },

    { id: 'subterranea', mode: 'rescue', diff: 'god', name: 'Raiz Funda', code: 'Operação Quarto Nível', theme: 'violet', kind: 'Extração',
      place: 'Metrô abandonado, nível -4', hostageName: 'a Dra. Yasmin Haddad', intelName: 'Mapas de túneis',
      tagline: 'O maior labirinto de túneis do jogo.',
      story: 'A Dra. Yasmin Haddad sumiu ao tentar provar que o metrô escondia pessoas. Quatro níveis abaixo da superfície, a Raiz Funda é um labirinto de túneis, salas e portas que ninguém terminou de mapear. Há muitos vigilantes e muita escuridão. Encontre a doutora antes que a escuridão encontre você.',
      win: 'Yasmin sobe quatro níveis em silêncio e só fala quando vê o céu. A primeira palavra é um palavrão.',
      gen: { seed: 59, w: 92, h: 56, minLeaf: 9, maxLeaf: 18, doors: { d: 5, k: 4, v: 3 }, gate: true, gateKind: 'v', guards: 22, cams: 12 } },

    { id: 'abismo', mode: 'rescue', diff: 'f404', name: 'Abismo 404', code: 'Operação Zero Absoluto', theme: 'glitch', kind: 'Lenda',
      place: 'Nível sem nome, abaixo de tudo', hostageName: 'a mensageira Zero', intelName: 'Mapa do Abismo',
      tagline: 'O resgate que a rede jurou ser impossível.',
      story: 'Zero é a única pessoa que conhece o caminho de volta do Núcleo 404, e a rede decidiu guardá-la no Abismo, abaixo de tudo. Não há planta e não há aliados. O mapa é gigantesco, cheio de câmeras, e todos os hacks têm doze teclas. Se alguém ainda vai tentar, que seja você.',
      win: 'Zero sai do Abismo e olha para você: "Foi só isso que a rede conseguiu?" Ninguém sabe se ela está brincando.',
      gen: { seed: 4040, w: 112, h: 70, minLeaf: 9, maxLeaf: 18, doors: { d: 6, k: 6, v: 6 }, gate: true, gateKind: 'v', guards: 32, cams: 22 } }
  ];
})(window.SC);
