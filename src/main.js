import './style.css';
import { makeRenderer, loadSprites } from './render.js';
import { Game, SPRITES } from './game.js';
import * as A from './audio.js';
import * as UI from './ui.js';

const r = makeRenderer(document.getElementById('gl'));
const all = () => true;
const spr = await loadSprites(SPRITES, {
  golem: (r, g, b, mx, s) => g > 0.72 && b > 0.66 && r < 0.45 && s > 0.4,
  wraith: (r, g, b) => r > 0.6 && g < 0.35 && b < 0.35,
  shade: (r, g, b) => b > 0.6 && g > 0.6 && r < 0.5,
  moth: (r, g, b, mx, s) => mx > 0.85 && s > 0.35 && b > r,
  boss_moth: (r, g, b, mx, s) => b > 0.75 && g > 0.6 && r < 0.6 && s > 0.3,
  gem_ember: all, gem_moon: all, heart_pickup: all,
  arch: (r, g, b, mx) => mx > 0.75 && r > 0.8 && g > 0.45 && b < 0.45,
});
const game = new Game(r, spr);
const fx = document.getElementById('fx');
const fctx = fx.getContext('2d');

let state = 'title', best = 0, lastT = performance.now(), dashBuf = 0, luDelay = 0;
let scoreSaved = false, finalScore = 0;
let runMode = 'campaign';
const mobile = matchMedia('(pointer: coarse), (max-width: 700px)').matches;
const joy = { active: false, id: null, x: 0, z: 0, cx: 0, cy: 0 };
if (mobile) {
  document.body.classList.add('mobile');
  document.getElementById('mobileHint').classList.remove('hidden');
  document.getElementById('pcHow').innerHTML = '<div>DRAG ANYWHERE TO MOVE</div><div>TAP DASH TO ESCAPE</div><div>your lantern fights on its own</div>';
}
const modeButtons = [...document.querySelectorAll('.mode')];
modeButtons.forEach((b) => b.onclick = (e) => { e.stopPropagation(); runMode = b.id === 'modeArcade' ? 'arcade' : 'campaign'; modeButtons.forEach((x) => x.classList.toggle('active', x === b)); });
try { best = +localStorage.getItem('emberwake.best') || 0; } catch { /* storage blocked */ }
UI.setBest(best);
UI.show('title');
let scoreTab = 'campaign';
function readScores() { try { return JSON.parse(localStorage.getItem('emberwake.scores') || '[]'); } catch { return []; } }
function refreshScores() { UI.showScores(readScores(), scoreTab); }
function writeScore() { if (scoreSaved) return; scoreSaved = true; const rows = readScores(); rows.push({ name: UI.scoreName(), score: finalScore, level: game.bossLevel, mode: runMode }); rows.sort((a, b) => b.score - a.score); try { localStorage.setItem('emberwake.scores', JSON.stringify(rows.slice(0, 100))); } catch {} UI.hideScores(); UI.show("title"); setState("title"); }
document.getElementById('highScores').onclick = (e) => { e.stopPropagation(); UI.showScores(readScores(), scoreTab); };
document.getElementById('closeScores').onclick = () => UI.hideScores();
document.getElementById('saveScore').onclick = () => writeScore();
document.getElementById('scoresCampaign').onclick = () => { scoreTab = 'campaign'; refreshScores(); };
document.getElementById('scoresArcade').onclick = () => { scoreTab = 'arcade'; refreshScores(); };

const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashBuf = 0.15;
  if (e.code === 'KeyM') A.toggleMute();
  onPress(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (state === 'play') setState('pause'); });
const stage = document.getElementById('stage');
stage.addEventListener('pointerdown', (e) => { if (e.target.closest('button, input')) return; if (mobile && state === 'play' && e.target === stage) { joy.active = true; joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; stage.setPointerCapture(e.pointerId); } else onPress('Click'); });
stage.addEventListener('pointermove', (e) => { if (!joy.active || e.pointerId !== joy.id) return; joy.x = Math.max(-1, Math.min(1, (e.clientX - joy.cx) / 65)); joy.z = Math.max(-1, Math.min(1, (e.clientY - joy.cy) / 65)); });
stage.addEventListener('pointerup', (e) => { if (e.pointerId === joy.id) { joy.active = false; joy.x = joy.z = 0; } });
document.getElementById('dash').addEventListener('pointerdown', (e) => { e.stopPropagation(); dashBuf = 0.2; });

function onPress(code) {
  if (state === 'title') begin();
  else if (state === 'levelup') UI.cardKey(code);
  else if (state === 'play' && (code === 'Escape' || code === 'KeyP')) setState('pause');
  else if (state === 'pause' && (code === 'Escape' || code === 'KeyP' || code === 'Click')) setState('play');
  else if (state === 'end' && (code === 'KeyR' || code === 'Click' || code === 'Enter') && game.endT > 1) begin();
}

function begin() {
  A.initAudio();
  game.runMode = runMode === 'arcade' ? 'endless' : 'story';
  game.start();
  scoreSaved = false;
  A.setMusic(1);
  A.ui();
  setState('play');
  UI.banner(runMode === 'arcade' ? 'ENDLESS NIGHT' : 'NIGHTFALL', runMode === 'arcade' ? 'defeat each boss to deepen the night' : 'survive until dawn · light the braziers');
}

function setState(s) {
  state = s;
  UI.show(s === 'play' ? null : s);
}

function input() {
  const k = (...c) => c.some((x) => keys.has(x));
  let x = mobile && joy.active ? joy.x : (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  let z = mobile && joy.active ? joy.z : (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0);
  let dash = dashBuf > 0;
  const pad = navigator.getGamepads?.()[0];
  if (pad) {
    if (Math.hypot(pad.axes[0], pad.axes[1]) > 0.2) { x = pad.axes[0]; z = pad.axes[1]; }
    if (pad.buttons[0]?.pressed || pad.buttons[5]?.pressed) dash = true;
  }
  if (dash) dashBuf = 0;
  return { x, z, dash };
}

function openLevelUp() {
  setState('levelup');
  A.levelUp();
  const pick = (u) => {
    A.pick();
    game.apply(u);
    if (game.pendingLevels > 0) { A.levelUp(); UI.cards(game.rollOptions(), game.lv, pick); }
    else setState('play');
  };
  UI.cards(game.rollOptions(), game.lv, pick);
}

function finish(win) {
  const bonus = win ? 3000 + Math.round(game.p.hp) * 20 : 0;
  const final = game.score + bonus;
  finalScore = final;
  const isBest = final > best;
  if (isBest) { best = final; try { localStorage.setItem('emberwake.best', String(best)); } catch { /* storage blocked */ } }
  UI.endScreen(win, game, final, best, isBest);
  UI.askScoreName();
  UI.setBest(best);
  game.endT = 0;
  setState('end');
}

function frame(now) {
  requestAnimationFrame(frame);
  tick(Math.min((now - lastT) / 1000, 1 / 20));
  lastT = now;
}

function tick(dt) {
  dashBuf -= dt;
  game.endT = (game.endT || 0) + dt;

  if (state === 'play' || state === 'title' || state === 'end') {
    game.update(dt, state === 'play' ? input() : { x: 0, z: 0, dash: false });
    if (state === 'play') {
      for (const ev of game.events) {
        if (ev.banner) UI.banner(ev.banner, ev.sub);
        if (ev.flash) UI.flash(ev.flash);
      }
      game.events.length = 0;
      if (!game.boss && !game.won && !game.p.dead) A.setMusic(game.t < 40 ? 1 : game.t < 110 ? 2 : 3);
      if (game.pendingLevels > 0 && !game.p.dead && !game.won) {
        luDelay += dt;
        if (luDelay > 0.12) { luDelay = 0; openLevelUp(); }
      }
      if (game.over > 2.4) finish(false);
      if (game.won > 5) finish(true);
    }
  }
  game.draw();
  r.render();

  const w = fx.clientWidth, h = fx.clientHeight, pr = Math.min(devicePixelRatio || 1, 2);
  if (fx.width !== Math.round(w * pr)) { fx.width = Math.round(w * pr); fx.height = Math.round(h * pr); }
  fctx.setTransform(pr, 0, 0, pr, 0, 0);
  game.drawOverlay(fctx, w, h);
  if (state !== 'title') UI.hud(game);
}
requestAnimationFrame(frame);

// Test hooks: drive frames without rAF (hidden webviews pause it).
window.__game = game;
window.__tick = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); return state; };
window.__press = onPress;
window.__keys = keys;
window.__audio = A.debug;
