/* ============================================================================
   ui.js — título, seleção de missão por modo e resultado.
   ========================================================================== */
(function (SC) {
  'use strict';
  const { $, $$, esc } = SC;
  const MODES = {
    infil: { name: 'Invasão', tag: 'Entre, hackeie e saia', desc: 'Invada o local, hackeie os terminais (um só ou vários) e chegue à extração. Portas trancadas também pedem hack.' },
    rescue: { name: 'Resgate', tag: 'Encontre e escolte', desc: 'Encontre a pessoa, abra o caminho até ela e escolte-a para fora sem disparar o alarme.' }
  };
  let mode = SC.store.get('mode', 'infil'), stopThumbs = null;

  /* ---------- título ---------- */
  SC.screen('title', {
    mood: 'title',
    enter() {
      $('#title-wrap').innerHTML = `
        <div class="title-box">
          <p class="mono kick">protótipo · jogo solo top-down</p>
          <h1>Código<br>de Invasão</h1>
          <p class="lead">Infiltração tática vista de cima. Escolha entre invadir um local ou resgatar alguém, em mapas que vão do minúsculo ao enorme.</p>
          <div class="row"><button class="btn primary big" id="t-play">Jogar</button><button class="btn ghost" id="t-mute">Som: ligado</button></div>
          <p class="mono mut small" style="margin-top:22px">Desktop: WASD/setas para mover · Shift agacha · E hackeia · Esc pausa</p>
        </div>`;
      $('#t-play').onclick = () => { SC.audio.resume(); SC.audio.sfx('click'); SC.go('select'); };
      $('#t-mute').onclick = e => { SC.audio.resume(); const on = SC.audio.toggle(); e.currentTarget.textContent = 'Som: ' + (on ? 'ligado' : 'desligado'); };
    }
  });

  /* ---------- seleção ---------- */
  function renderSelect() {
    const best = SC.store.get('best', {}), list = SC.MAPS.filter(m => m.mode === mode);
    $$('#sel-tabs button').forEach(b => { b.classList.toggle('on', b.dataset.m === mode); });
    $('#sel-desc').textContent = MODES[mode].desc;
    $('#sel-grid').innerHTML = list.map(d => {
      const b = best[d.id], chips = [];
      if (d.mode === 'infil') chips.push(`<span class="chip">${d.nTerms} terminal${d.nTerms > 1 ? 'is' : ''}</span>`);
      else chips.push('<span class="chip">1 refém</span>');
      if (d.nTerms) chips.push(`<span class="chip hk">${d.termMin === d.termMax ? d.termMin : d.termMin + '–' + d.termMax} teclas</span>`);
      if (d.nDoors) chips.push(`<span class="chip">${d.nDoors} porta${d.nDoors > 1 ? 's' : ''} · ${d.doorMin === d.doorMax ? d.doorMin : d.doorMin + '–' + d.doorMax} teclas</span>`);
      chips.push(`<span class="chip">${d.guards.length} guarda${d.guards.length === 1 ? '' : 's'}</span>`);
      if (d.cams.length) chips.push(`<span class="chip">${d.cams.length} câmera${d.cams.length > 1 ? 's' : ''}</span>`);
      return `<button class="ms-card panel t-${d.theme}" data-id="${d.id}">
        <canvas class="thumb" data-id="${d.id}"></canvas>
        <div class="ms-body">
          <div class="ms-top"><span class="mono size s-${d.size}">${d.size} · ${d.W}×${d.H}</span>${b ? `<span class="rank r-${b.rank}" title="melhor resultado">${b.rank}</span>` : ''}</div>
          <h3>${esc(d.name)}</h3>
          <p class="mono kick">${esc(d.code)}</p>
          <div class="chips">${chips.join('')}</div>
        </div></button>`;
    }).join('');
    $$('#sel-grid .ms-card').forEach(c => c.onclick = () => { SC.audio.resume(); SC.audio.sfx('click'); SC.go('mission', c.dataset.id); });
    requestAnimationFrame(() => $$('#sel-grid canvas.thumb').forEach(cv => SC.mission.thumb(cv, SC.mapById(cv.dataset.id))));
  }
  SC.screen('select', {
    mood: 'lobby',
    enter() {
      $('#sel-tabs').innerHTML = Object.keys(MODES).map(k => `<button data-m="${k}"><b>${MODES[k].name}</b><span class="mono">${MODES[k].tag}</span></button>`).join('');
      $$('#sel-tabs button').forEach(b => b.onclick = () => { mode = b.dataset.m; SC.store.set('mode', mode); SC.audio.sfx('click'); renderSelect(); });
      $('#sel-back').onclick = () => { SC.audio.sfx('click'); SC.go('title'); };
      renderSelect();
    }
  });

  /* ---------- resultado ---------- */
  const OUT = {
    silent: { t: 'Sucesso silencioso', c: 'gn', s: 'Ninguém sabe que você esteve lá.' },
    alarm: { t: 'Cumprida sob alarme', c: 'yl', s: 'Objetivo cumprido, mas você foi detectado.' },
    fail: { t: 'Operação fracassada', c: 'rd', s: 'O objetivo não foi cumprido.' }
  };
  SC.screen('result', {
    mood: 'win',
    enter(r) {
      const o = OUT[r.outcome], d = SC.mapById(r.id), mm = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
      SC.audio.mood(r.outcome === 'fail' ? 'lose' : 'win'); SC.audio.sfx(r.outcome === 'fail' ? 'bad' : 'ok');
      const list = SC.MAPS.filter(m => m.mode === d.mode), next = list[(list.indexOf(d) + 1) % list.length];
      const stats = [['Tempo em campo', mm(r.time)], ['Pico de detecção', Math.round(r.maxDet * 100) + '%'], ['Vezes avistado', r.spotted], ['Hacks concluídos', r.hacksOk], ['Hacks que falharam', r.hacksFail], ['Item opcional', r.intel ? 'recuperado' : 'não']];
      $('#result-wrap').innerHTML = `
        <div class="res-band ${o.c}"><p class="mono">${esc(d.code)}, relatório de campo</p><h2>${o.t}</h2><p>${o.s}</p><div class="rank big r-${r.rank}">${r.rank}</div></div>
        <div class="res-grid">${stats.map(x => `<div class="panel"><span class="mono">${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>
        <div class="row center"><button class="btn primary big" id="r-retry">Tentar de novo</button>${next && next !== d ? `<button class="btn am" id="r-next">Próximo mapa: ${esc(next.name)}</button>` : ''}<button class="btn ghost" id="r-menu">Menu</button></div>
        <p class="mono mut small center">Rank S: silencioso, detecção baixa e nenhum hack falho. A: silencioso. B: sob alarme.</p>`;
      $('#r-retry').onclick = () => { SC.audio.sfx('click'); SC.go('mission', d.id); };
      if ($('#r-next')) $('#r-next').onclick = () => { SC.audio.sfx('click'); SC.go('mission', next.id); };
      $('#r-menu').onclick = () => { SC.audio.sfx('click'); SC.go('select'); };
    }
  });

  window.addEventListener('DOMContentLoaded', () => SC.go('title'));
})(window.SC);
