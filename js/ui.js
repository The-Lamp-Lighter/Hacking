/* ============================================================================
   ui.js — título, seleção de missão (por modo e dificuldade) e resultado.
   O fundo dos menus é um "modo demonstração": o próprio motor do jogo desenha um
   mapa de verdade, com guardas patrulhando e um agente hackeando terminais.
   ========================================================================== */
(function (SC) {
  'use strict';
  const { $, $$, esc } = SC;
  const MODES = {
    infil: { name: 'Invasão', tag: 'Entre na rede, saia sem rastro', desc: 'Invada o local, hackeie os terminais (um só ou vários) e chegue à extração. Portas trancadas também pedem hack.',
      icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="26" rx="2" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M14 20l6 5-6 5M24 31h10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/><path d="M16 42h16" stroke="currentColor" stroke-width="2.5"/></svg>' },
    rescue: { name: 'Resgate', tag: 'Ache, abra, leve para fora', desc: 'Encontre a pessoa, abra o caminho até ela e escolte-a até a extração sem disparar o alarme.',
      icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="14" r="5.5" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M8 38v-6c0-5 4-9 10-9s10 4 10 9v6" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M32 24h12m0 0l-5-5m5 5l-5 5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/></svg>' }
  };
  const RANK_NAME = { S: 'Fantasma', A: 'Sombra', B: 'Ruído', F: 'Flatline' };
  let mode = SC.store.get('mode', 'infil');

  /* =========================== fundo: modo demonstração =========================== */
  const att = { on: false, t: 0, m: null, guards: [], route: [], ri: 0, pos: null, hack: 0, hackLen: 7, cx: 0, cy: 0, fade: 0, ready: false };
  function bfsPath(m, a, b) {
    const W = m.W, H = m.H, prev = new Int32Array(W * H).fill(-2), q = [Math.floor(a.x) + Math.floor(a.y) * W]; prev[q[0]] = -1;
    const tgt = Math.floor(b.x) + Math.floor(b.y) * W;
    for (let i = 0; i < q.length && prev[tgt] === -2; i++) {
      const c = q[i], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || m.grid[ny][nx] === '#' || prev[nx + ny * W] !== -2) continue;
        prev[nx + ny * W] = c; q.push(nx + ny * W);
      }
    }
    const out = []; for (let c = tgt; c >= 0 && c !== -2; c = prev[c]) out.push({ x: (c % W) + 0.5, y: Math.floor(c / W) + 0.5 });
    return out.reverse();
  }
  function initAttract() {
    const def = SC.mapById('datacenter'), m = SC.parseMap(def);
    m.doors.forEach(d => { d.open = true; m.grid[d.gy][d.gx] = '.'; });       /* o agente já abriu tudo */
    att.m = m; att.def = def;
    att.guards = def.guards.map(g => ({ x: g.path[0][0] + 0.5, y: g.path[0][1] + 0.5, a: 0, path: g.path, wi: 1 % g.path.length, pause: 0 }));
    /* rota: início → terminais (sempre o mais próximo) → extração, com paradas para hackear */
    const left = m.terms.slice(), route = []; let cur = m.start;
    route.push({ p: cur, stop: false });
    while (left.length) {
      let bi = 0, bd = 1e9; left.forEach((t, i) => { const d = Math.hypot(t.x - cur.x, t.y - cur.y); if (d < bd) { bd = d; bi = i; } });
      const t = left.splice(bi, 1)[0], pts = bfsPath(m, cur, t);
      pts.slice(1).forEach((p, i, a) => route.push({ p, stop: i === a.length - 1 ? t : false })); cur = t;
    }
    bfsPath(m, cur, m.exit).slice(1).forEach(p => route.push({ p, stop: false }));
    att.route = route; att.ri = 0; att.pos = { x: route[0].p.x, y: route[0].p.y, a: 0 }; att.cx = att.pos.x; att.cy = att.pos.y; att.hack = 0; att.ready = true;
    m.terms.forEach(t => { t.done = false; });
  }
  function stepAttract(dt) {
    const m = att.m;
    att.t += dt;
    for (const g of att.guards) {
      if (g.pause > 0) { g.pause -= dt; continue; }
      const t = { x: g.path[g.wi][0] + 0.5, y: g.path[g.wi][1] + 0.5 }, d = Math.hypot(g.x - t.x, g.y - t.y);
      const da = Math.atan2(Math.sin(Math.atan2(t.y - g.y, t.x - g.x) - g.a), Math.cos(Math.atan2(t.y - g.y, t.x - g.x) - g.a)); g.a += da * 0.12;
      if (d < 0.06) { g.wi = (g.wi + 1) % g.path.length; g.pause = 0.7; } else { const s = Math.min(d, 1.25 * dt); g.x += (t.x - g.x) / d * s; g.y += (t.y - g.y) / d * s; }
    }
    if (att.fade > 0) { att.fade -= dt; if (att.fade <= 0) { m.terms.forEach(t => { t.done = false; }); att.ri = 0; att.pos = { x: att.route[0].p.x, y: att.route[0].p.y, a: 0 }; } return; }
    if (att.hack > 0) {
      att.hack -= dt;
      if (att.hack <= 0) { att.route[att.ri].stop.done = true; att.ri++; }
      return;
    }
    const nxt = att.route[att.ri + 1];
    if (!nxt) { att.fade = 1.4; return; }
    const cur = att.route[att.ri];
    if (cur.stop && !cur.stop.done) { att.hack = 2.6; att.hackLen = cur.stop.spec.len; return; }
    const d = Math.hypot(nxt.p.x - att.pos.x, nxt.p.y - att.pos.y), sp = 3.4 * dt;
    att.pos.a = Math.atan2(nxt.p.y - att.pos.y, nxt.p.x - att.pos.x);
    if (d <= sp) { att.pos.x = nxt.p.x; att.pos.y = nxt.p.y; att.ri++; } else { att.pos.x += (nxt.p.x - att.pos.x) / d * sp; att.pos.y += (nxt.p.y - att.pos.y) / d * sp; }
  }
  function drawAttract(cv) {
    const { ctx, w, h } = SC.fit(cv), m = att.m, s = Math.max(30, Math.min(46, h / 15)), D = SC.draw, col = SC.THEMES[att.def.theme];
    att.cx += (att.pos.x - att.cx) * 0.05; att.cy += (att.pos.y - att.cy) * 0.05;
    /* o agente fica um pouco à direita do centro para o texto respirar à esquerda */
    const sx = w * 0.62, sy = h * 0.5, ox = sx - att.cx * s, oy = sy - att.cy * s;
    ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(ox, oy);
    const r = { x0: Math.max(0, Math.floor(-ox / s) - 1), y0: Math.max(0, Math.floor(-oy / s) - 1), x1: Math.min(m.W - 1, Math.ceil((w - ox) / s) + 1), y1: Math.min(m.H - 1, Math.ceil((h - oy) / s) + 1) };
    ctx.fillStyle = 'rgba(63,214,255,.07)';
    for (let y = r.y0; y <= r.y1 + 1; y++) for (let x = r.x0; x <= r.x1 + 1; x++) ctx.fillRect(x * s - 1, y * s - 1, 2, 2);
    att.guards.forEach(g => D.cone(ctx, m, g, SC.K.G_RANGE, SC.K.G_FOV, s, false));
    D.drawMap(ctx, m, s, col, false, r);
    m.terms.forEach(t => D.drawTerm(ctx, t, s, att.t));
    D.mark(ctx, m.exit.x * s, m.exit.y * s, s * 0.34, '#5ED99B', '', att.t);
    att.guards.forEach(g => {
      ctx.fillStyle = '#FFB347'; ctx.beginPath(); ctx.arc(g.x * s, g.y * s, s * 0.22, 0, 6.3); ctx.fill();
      ctx.strokeStyle = '#FFB347'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(g.x * s, g.y * s); ctx.lineTo((g.x + Math.cos(g.a) * 0.5) * s, (g.y + Math.sin(g.a) * 0.5) * s); ctx.stroke();
    });
    const p = att.pos, a = att.fade > 0 ? Math.max(0, att.fade / 1.4) : 1;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x * s, p.y * s); ctx.rotate(p.a); ctx.shadowColor = '#3FD6FF'; ctx.shadowBlur = 14; ctx.fillStyle = '#3FD6FF';
    const rr = s * 0.33; ctx.beginPath(); ctx.moveTo(rr, 0); ctx.lineTo(-rr * 0.7, rr * 0.65); ctx.lineTo(-rr * 0.35, 0); ctx.lineTo(-rr * 0.7, -rr * 0.65); ctx.closePath(); ctx.fill(); ctx.restore();
    if (att.hack > 0) {                                                        /* sequência de setas sobre o agente */
      const n = att.hackLen, k = Math.min(n, Math.floor((1 - att.hack / 2.6) * (n + 1))), bw = 15, gap = 4, x0 = p.x * s - (n * (bw + gap)) / 2, y0 = p.y * s - s * 1.15;
      for (let i = 0; i < n; i++) { ctx.fillStyle = i < k ? '#5ED99B' : 'rgba(8,12,22,.9)'; ctx.strokeStyle = i === k ? '#fff' : '#3a4a6b'; ctx.lineWidth = 1.5; ctx.fillRect(x0 + i * (bw + gap), y0, bw, bw); ctx.strokeRect(x0 + i * (bw + gap), y0, bw, bw); }
    }
    ctx.restore();
  }
  function bootAttract() {
    const cv = $('#bg-cv'); initAttract();
    let last = performance.now();
    (function f(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const cur = document.querySelector('.screen.on'), show = cur && ['s-title', 's-select', 's-result'].includes(cur.id);
      cv.style.display = show ? 'block' : 'none'; if (show) cv.dataset.s = cur.id;
      if (show) { stepAttract(dt); drawAttract(cv); }
      requestAnimationFrame(f);
    })(last);
  }

  /* =========================== título =========================== */
  SC.screen('title', {
    mood: 'title',
    enter() {
      const best = SC.store.get('best', {}), done = Object.keys(best).length;
      $('#title-wrap').innerHTML = `
        <div class="title-box">
          <h1 class="logo" aria-label="Neon Breach"><span class="l1">NEON</span><span class="l2 tear" data-t="BREACH"><i>BREACH</i></span></h1>
          <p class="lead">Infiltração tática vista de cima. Hackeie com as setas, passe pelos cones de luz e saia sem deixar rastro.</p>
          <nav id="menu" aria-label="Menu principal">
            <button data-a="play"><span class="mk" aria-hidden="true"><i>▲</i><i>▶</i><i>▼</i></span><b>Jogar</b><small>${SC.MAPS.length} missões em 6 níveis${done ? ' · ' + done + ' concluída' + (done > 1 ? 's' : '') : ''}</small></button>
            <button data-a="how"><span class="mk" aria-hidden="true"><i>◀</i><i>▲</i></span><b>Como jogar</b><small>controles e o minigame de hack</small></button>
            <button data-a="sound"><span class="mk" aria-hidden="true"><i>▶</i></span><b id="snd-l">Som: ligado</b><small>trilha e efeitos procedurais</small></button>
          </nav>
        </div>`;
      const go = {
        play() { SC.audio.resume(); SC.audio.sfx('click'); SC.go('select'); },
        how() { SC.audio.resume(); SC.audio.sfx('click'); howTo(); },
        sound() { SC.audio.resume(); const on = SC.audio.toggle(); $('#snd-l').textContent = 'Som: ' + (on ? 'ligado' : 'desligado'); }
      };
      const items = $$('#menu button');
      items.forEach((b, i) => { b.onclick = () => go[b.dataset.a](); b.onmouseenter = () => SC.audio.sfx('hover'); });
      $('#s-title').onkeydown = e => {                                           /* o menu também obedece às setas */
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      };
      items[0].focus({ preventScroll: true });
      const logo = $('.logo'); logo.classList.remove('go'); void logo.offsetWidth; logo.classList.add('go');
    }
  });
  function howTo() {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="panel modal-box"><h3>Como jogar</h3>
      <p>Chegue ao alvo sem ser visto: os cones amarelos são o que guardas e câmeras enxergam. Quando o rastreamento enche, o ICE dispara o alarme e os guardas vêm atrás de você.</p>
      <div class="how-grid">
        <div><b>Mover</b><span class="mono">WASD ou setas</span></div>
        <div><b>Furtivo</b><span class="mono">Shift (rastreamento cai pela metade)</span></div>
        <div><b>Hackear</b><span class="mono">E, perto de um terminal ou porta</span></div>
        <div><b>Pausar</b><span class="mono">Esc</span></div>
      </div>
      <p class="mono kick" style="margin-top:14px">O hack</p>
      <div class="how-seq"><i>▲</i><i>▶</i><i>▶</i><i>▼</i><i>◀</i></div>
      <p>Aperte as setas na ordem, antes de o tempo acabar. Errou uma, a sequência recomeça. O mundo não para enquanto você hackeia. O número em cada alvo é o tamanho da sequência, e quanto mais difícil o nível, mais longa e mais apertada ela fica.</p>
      <div class="row"><button class="btn primary" id="how-ok">Entendi</button></div></div>`;
    $('#modal-root').appendChild(m); requestAnimationFrame(() => m.classList.add('on'));
    const close = () => { m.classList.remove('on'); setTimeout(() => m.remove(), 160); SC.audio.sfx('click'); };
    $('#how-ok', m).onclick = close; m.onclick = e => { if (e.target === m) close(); };
    $('#how-ok', m).focus();
  }

  /* =========================== seleção =========================== */
  const pips = n => Array.from({ length: 6 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  function renderSelect() {
    const best = SC.store.get('best', {}), list = SC.MAPS.filter(m => m.mode === mode);
    $$('#sel-tabs button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    $('#sel-tabs').dataset.m = mode;
    $('#sel-desc').textContent = MODES[mode].desc;
    $('#ladder').innerHTML = SC.DIFF.map(D => {
      const n = list.filter(m => m.diff === D.id).length, got = list.filter(m => m.diff === D.id && best[m.id]).length;
      return `<button style="--dc:${D.col}" data-d="${D.id}" ${n ? '' : 'disabled'} title="${esc(D.blurb)}"><span class="dot"></span><b>${D.name}</b><small class="mono">${got}/${n}</small></button>`;
    }).join('');
    $$('#ladder button').forEach(b => b.onclick = () => { SC.audio.sfx('click'); const g = $('#grp-' + b.dataset.d); if (g) g.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
    $('#sel-grid').innerHTML = SC.DIFF.map(D => {
      const maps = list.filter(m => m.diff === D.id); if (!maps.length) return '';
      return `<section class="grp g-${D.id}" id="grp-${D.id}" style="--dc:${D.col}">
        <header><h2 class="gname"><span data-t="${D.name}">${D.name}</span></h2><div class="gpips" aria-label="nível ${D.n} de 6">${pips(D.n)}</div><p>${esc(D.blurb)}</p></header>
        <div class="cards">${maps.map(d => {
          const b = best[d.id], chips = [];
          chips.push(d.mode === 'infil' ? `<span class="chip">${d.nTerms} terminal${d.nTerms > 1 ? 'is' : ''}</span>` : '<span class="chip">1 refém</span>');
          if (d.nTerms) chips.push(`<span class="chip hk">${d.termMin === d.termMax ? d.termMin : d.termMin + '–' + d.termMax} teclas</span>`);
          if (d.nDoors) chips.push(`<span class="chip">${d.nDoors} porta${d.nDoors > 1 ? 's' : ''} · ${d.doorMin === d.doorMax ? d.doorMin : d.doorMin + '–' + d.doorMax} teclas</span>`);
          chips.push(`<span class="chip">${d.guards.length} guarda${d.guards.length === 1 ? '' : 's'}</span>`);
          if (d.cams.length) chips.push(`<span class="chip">${d.cams.length} câmera${d.cams.length > 1 ? 's' : ''}</span>`);
          const area = Math.min(1, Math.log(d.W * d.H / 200) / Math.log(7840 / 200));
          return `<button class="ms-card panel t-${d.theme}" data-id="${d.id}" style="--dc:${D.col}">
            <div class="thumbw"><canvas class="thumb" data-id="${d.id}"></canvas><span class="scan"></span></div>
            <div class="ms-body">
              <div class="ms-top"><span class="mono size"><i style="width:${Math.round(14 + area * 46)}px"></i>${d.size} · ${d.W}×${d.H}</span>${b ? `<span class="rank r-${b.rank}" title="Melhor resultado: ${RANK_NAME[b.rank]}">${b.rank}</span>` : ''}</div>
              <h3>${esc(d.name)}</h3>
              <p class="tagline">${esc(d.tagline)}</p>
              <div class="chips">${chips.join('')}</div>
            </div></button>`;
        }).join('')}</div></section>`;
    }).join('');
    $$('#sel-grid .ms-card').forEach(c => { c.onclick = () => { SC.audio.resume(); SC.audio.sfx('click'); SC.go('mission', c.dataset.id); }; c.onmouseenter = () => SC.audio.sfx('hover'); });
    requestAnimationFrame(() => $$('#sel-grid canvas.thumb').forEach(cv => SC.mission.thumb(cv, SC.mapById(cv.dataset.id))));
  }
  SC.screen('select', {
    mood: 'lobby',
    enter() {
      $('#sel-tabs').innerHTML = Object.keys(MODES).map(k => `<button data-m="${k}"><span class="ic">${MODES[k].icon}</span><span class="tx"><b>${MODES[k].name}</b><span>${MODES[k].tag}</span></span></button>`).join('');
      $$('#sel-tabs button').forEach(b => b.onclick = () => { mode = b.dataset.m; SC.store.set('mode', mode); SC.audio.sfx('click'); renderSelect(); $('#s-select').scrollTo({ top: 0 }); });
      $('#sel-back').onclick = () => { SC.audio.sfx('click'); SC.go('title'); };
      renderSelect();
    }
  });

  /* =========================== resultado =========================== */
  const OUT = {
    silent: { t: 'Rastro zero', c: 'gn', s: 'Ninguém sabe que você esteve lá.' },
    alarm: { t: 'Saída ruidosa', c: 'yl', s: 'Objetivo cumprido, mas o ICE tem o seu rastro.' },
    fail: { t: 'Flatline', c: 'rd', s: 'O objetivo não foi cumprido.' }
  };
  SC.screen('result', {
    mood: 'win',
    enter(r) {
      const o = OUT[r.outcome], d = SC.mapById(r.id), D = SC.diffOf(d), mm = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
      SC.audio.mood(r.outcome === 'fail' ? 'lose' : 'win'); SC.audio.sfx(r.outcome === 'fail' ? 'bad' : 'ok');
      const list = SC.MAPS.filter(m => m.mode === d.mode).sort((a, b) => a.dn - b.dn), next = list[list.indexOf(d) + 1];
      const stats = [['Tempo em campo', mm(r.time)], ['Pico de rastreamento', Math.round(r.maxDet * 100) + '%'], ['Vezes rastreado', r.spotted], ['Hacks concluídos', r.hacksOk], ['Hacks que falharam', r.hacksFail], ['Item opcional', r.intel ? 'recuperado' : 'não']];
      $('#result-wrap').innerHTML = `
        <div class="res-band ${o.c}"><p class="mono">${esc(d.name)} · <span style="color:${D.col}">${D.name}</span></p><h2>${o.t}</h2><p>${o.s}</p>
          <div class="rank big r-${r.rank}" title="${RANK_NAME[r.rank]}">${r.rank}</div><p class="rname mono">${RANK_NAME[r.rank]}</p></div>
        ${r.outcome !== 'fail' ? `<blockquote class="epi">${esc(d.win)}</blockquote>` : `<blockquote class="epi">O ICE fechou a rede. Respire, olhe os cones de novo e tente outra rota.</blockquote>`}
        <div class="res-grid">${stats.map(x => `<div class="panel"><span class="mono">${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>
        <div class="row center"><button class="btn primary big" id="r-retry">Tentar de novo</button>${next && r.outcome !== 'fail' ? `<button class="btn am" id="r-next">Próxima: ${esc(next.name)}</button>` : ''}<button class="btn ghost" id="r-menu">Missões</button></div>
        <p class="mono mut small center">Fantasma: rastro zero, rastreamento baixo e nenhum hack falho. Sombra: rastro zero. Ruído: cumprida sob alarme.</p>`;
      $('#r-retry').onclick = () => { SC.audio.sfx('click'); SC.go('mission', d.id); };
      if ($('#r-next')) $('#r-next').onclick = () => { SC.audio.sfx('click'); SC.go('mission', next.id); };
      $('#r-menu').onclick = () => { SC.audio.sfx('click'); SC.go('select'); };
    }
  });

  window.addEventListener('DOMContentLoaded', () => { bootAttract(); SC.go('title'); });
})(window.SC);
