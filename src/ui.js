import { NIGHT, BOSS_AT, UPGRADES } from './data.js';

const $ = (id) => document.getElementById(id);
const cache = {};
const set = (id, prop, v) => {
  const k = id + prop;
  if (cache[k] === v) return;
  cache[k] = v;
  if (prop === 'text') $(id).textContent = v;
  else $(id).style[prop] = v;
};

export function show(name) {
  for (const s of ['title', 'levelup', 'pause', 'end']) $(s).classList.toggle('hidden', s !== name);
  $('hud').classList.toggle('hidden', name === 'title' || name === 'end');
}

export function hud(g) {
  const p = g.p;
  set('hpfill', 'width', `${(p.hp / p.maxHp) * 100}%`);
  set('hpghost', 'width', `${(p.hp / p.maxHp) * 100}%`);
  set('hptext', 'text', `${Math.ceil(p.hp)} / ${p.maxHp}`);
  set('lvl', 'text', String(g.level));
  set('xpfill', 'width', `${Math.min(1, g.xp / g.need) * 100}%`);
  set('nightfill', 'width', g.runMode === 'endless' ? '100%' : `${(g.t / NIGHT) * 100}%`);
  set('bossmark', 'left', `${(BOSS_AT / NIGHT) * 100}%`);
  const left = Math.max(0, Math.ceil(NIGHT - g.t));
  set('clock', 'text', g.runMode === 'endless' ? 'ENDLESS NIGHT' : g.won ? 'DAWN' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} until dawn`);
  set('score', 'text', g.score.toLocaleString('en-US'));
  const m = g.mult();
  $('combo').classList.toggle('hidden', g.combo < 5);
  set('combon', 'text', `${g.combo} CHAIN${m > 1 ? ` x${m}` : ''}`);
  set('combofill', 'width', `${Math.max(0, g.comboT / 2.2) * 100}%`);
  if (cache.combo !== g.combo && g.combo % 15 === 0 && g.combo) {
    $('combo').classList.remove('pop'); void $('combo').offsetWidth; $('combo').classList.add('pop');
  }
  cache.combo = g.combo;
  const dr = Math.max(0, p.dashCd) / (1.1 - (g.lv.boots || 0) * 0.08);
  set('dashfill', 'width', `${(1 - dr) * 100}%`);
  $('dash').classList.toggle('ready', dr <= 0);
  $('bossbar').classList.toggle('hidden', !g.boss);
  if (g.boss) set('bossfill', 'width', `${Math.max(0, g.boss.hp / g.boss.max) * 100}%`);
  const key = JSON.stringify(g.lv);
  if (cache.kit !== key) {
    cache.kit = key;
    $('kit').innerHTML = UPGRADES.filter((u) => g.lv[u.id]).map((u) => `<div class="kit"><img src="/sprites/icon_${u.icon}.png" alt=""><b>${g.lv[u.id]}</b></div>`).join('');
  }
}

export function banner(text, sub = '') {
  const b = $('banner');
  b.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}

export function flash(a) {
  $('flash').animate([{ opacity: a }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
}

let sel = 0, picks = [], onPick = null;

export function cards(opts, lv, cb) {
  picks = opts; onPick = cb; sel = 0;
  $('cards').innerHTML = opts.map((u, i) => {
    const l = (lv[u.id] || 0) + 1;
    return `<div class="card${i === 0 ? ' sel' : ''}" data-i="${i}">
      <div class="ic"><img src="/sprites/icon_${u.icon}.png" alt=""></div>
      ${l === 1 ? '<div class="new">NEW</div>' : ''}
      <div class="nm">${u.name}</div>
      <div class="lv">${'★'.repeat(l)}${'☆'.repeat(u.max - l)}</div>
      <div class="ds">${u.desc(l)}</div>
    </div>`;
  }).join('');
  for (const el of $('cards').children) {
    el.onmouseenter = () => select(+el.dataset.i);
    el.onclick = () => choose(+el.dataset.i);
  }
}

function select(i) {
  sel = (i + picks.length) % picks.length;
  [...$('cards').children].forEach((c, j) => c.classList.toggle('sel', j === sel));
}

export function choose(i = sel) {
  if (!onPick || !picks[i]) return;
  const cb = onPick;
  onPick = null;
  cb(picks[i]);
}

export function cardKey(code) {
  if (code === 'ArrowLeft' || code === 'KeyA') select(sel - 1);
  else if (code === 'ArrowRight' || code === 'KeyD') select(sel + 1);
  else if (code === 'Enter' || code === 'Space') choose();
  else if (/^Digit[1-3]$/.test(code)) choose(+code[5] - 1);
}

export function endScreen(win, g, final, best, isBest) {
  $('endtitle').textContent = win ? 'DAWN BREAKS' : 'THE FLAME GOES OUT';
  $('endtitle').style.color = win ? '#ffcf6b' : '#b9b3ff';
  $('endsub').textContent = win ? 'you kept the light alive through the night' : 'the shadows take the ruins, for now';
  const t = Math.floor(g.t);
  const rows = [
    ['Survived', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
    ['Shadows banished', g.kills],
    ['Best chain', g.bestCombo],
    ['Braziers lit', g.lit],
    ['Player level', g.level],
    ['Boss level', g.bossLevel],
    ['Best', best.toLocaleString('en-US')],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
  $('endscore').textContent = final.toLocaleString('en-US');
  $('newbest').classList.toggle('hidden', !isBest);
}

export function setBest(v) {
  $('highScores').textContent = 'HIGHSCORES';
}

export function showScores(scores, mode = 'campaign') {
  const filtered = scores.filter((s) => (s.mode || 'campaign') === mode);
  $('scoresCampaign').classList.toggle('active', mode === 'campaign'); $('scoresArcade').classList.toggle('active', mode === 'arcade');
  $('scoreRows').innerHTML = filtered.length ? filtered.map((s, i) => `<div class="score-row"><b>${i + 1}</b><span>${escapeHtml(s.name)}</span><strong>${Number(s.score).toLocaleString('en-US')}</strong><small>LV ${s.level}</small></div>`).join('') : '<div class="empty-scores">NO SCORES YET</div>';
  $('scoresModal').classList.remove('hidden');
}
export function hideScores() { $('scoresModal').classList.add('hidden'); }
export function askScoreName() { $('scoreName').value = ''; setTimeout(() => $('scoreName').focus(), 0); }
export function scoreName() { return $('scoreName').value.trim().slice(0, 16) || 'EMBER'; }
function escapeHtml(v) { return String(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
