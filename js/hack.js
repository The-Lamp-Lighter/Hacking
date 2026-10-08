/* ============================================================================
   hack.js — minigame de hack por sequência de setas (inspirado no hack do Dispatcher).

   Um alvo (terminal ou porta) define QUANTAS teclas e QUANTO TEMPO (ver SC.hackSpec).
   O jogador precisa apertar a sequência de setas na ordem, antes do tempo acabar.
   Errar uma tecla reinicia a sequência (o relógio não para). O mundo continua rodando
   durante o hack: guardas patrulham e você fica parado, então hackear tem risco.

   API:  SC.hack.start(alvo, cb)   cb('ok' | 'fail' | 'cancel', info)
         SC.hack.update(dt)        chamado todo quadro pelo jogo
         SC.hack.key('up'|'down'|'left'|'right')
         SC.hack.cancel()          SC.hack.active()
   ========================================================================== */
(function (SC) {
  'use strict';
  const { $ } = SC;
  const DIRS = ['up', 'right', 'down', 'left'], ROT = { up: 0, right: 90, down: 180, left: 270 };
  let st = null, hideT = null;

  function box() { return $('#mi-hack'); }
  function flashPenalty(p) {
    const e = $('#hk-pen'); e.textContent = '−' + String(p).replace('.', ',') + ' s';
    e.classList.remove('on'); void e.offsetWidth; e.classList.add('on');
  }

  function start(target, cb) {
    const sp = target.spec, seq = [];
    for (let i = 0; i < sp.len; i++) {
      let d;
      do { d = DIRS[Math.floor(Math.random() * 4)]; } while (i >= 2 && seq[i - 1] === d && seq[i - 2] === d);   /* sem 3 iguais seguidas */
      seq.push(d);
    }
    st = { target, seq, i: 0, t: sp.time, max: sp.time, cb, wrong: 0 };
    clearTimeout(hideT);
    const b = box();
    b.className = 'on tier' + sp.tier;
    $('#hk-name').textContent = sp.name;
    $('#hk-count').textContent = '0 / ' + sp.len;
    $('#hk-seq').innerHTML = seq.map(d => `<span class="hk-key" style="--r:${ROT[d]}deg"><i>▲</i></span>`).join('');
    $('#hk-seq').dataset.n = sp.len;
    render();
    SC.audio.sfx('hackstart');
  }

  function render() {
    if (!st) return;
    const keys = $('#hk-seq').children;
    for (let k = 0; k < keys.length; k++) {
      keys[k].classList.toggle('done', k < st.i);
      keys[k].classList.toggle('cur', k === st.i);
    }
    $('#hk-count').textContent = st.i + ' / ' + st.seq.length;
    const f = Math.max(0, st.t / st.max);
    $('#hk-fill').style.width = (f * 100) + '%';
    $('#hk-fill').dataset.low = f < 0.3 ? '1' : '0';
    $('#hk-time').textContent = Math.max(0, st.t).toFixed(1) + ' s';
  }

  function finish(res) {
    const s = st; st = null;
    const b = box();
    b.classList.remove('bad');
    b.classList.add(res === 'ok' ? 'win' : res === 'fail' ? 'lose' : 'gone');
    hideT = setTimeout(() => { b.className = ''; }, res === 'cancel' ? 0 : 450);
    s.cb(res, s);
  }

  function key(d) {
    if (!st) return false;
    if (d === st.seq[st.i]) {
      st.i++; SC.audio.sfx('key');
      if (st.i >= st.seq.length) { render(); finish('ok'); return true; }
    } else {
      st.i = 0; st.wrong++; SC.audio.sfx('keybad');
      const pen = st.target.spec.penalty || 0;
      if (pen) { st.t = Math.max(0, st.t - pen); flashPenalty(pen); }
      const b = box(); b.classList.remove('bad'); void b.offsetWidth; b.classList.add('bad');
    }
    render(); return true;
  }

  function update(dt) {
    if (!st) return;
    st.t -= dt;
    if (st.t <= 0) { st.t = 0; render(); finish('fail'); return; }
    render();
  }

  SC.hack = { start, update, key, cancel: () => { if (st) finish('cancel'); }, active: () => !!st };
})(window.SC);
