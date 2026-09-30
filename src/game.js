import * as THREE from 'three';
import { SpriteBatch, FxBatch, DecalBatch, makeGround, makeMist, makeBeams, light, flushLights, shared } from './render.js';
import * as D from './data.js';
import * as A from './audio.js';
import { HALF, buildWorld, colliderGrid } from './world.js';

const TAU = Math.PI * 2;
const HERO_FRAMES = 10;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const PROP_TYPES = ['tree_oak', 'tree_pine', 'pillar', 'arch', 'statue', 'bush', 'rock', 'mushrooms', 'grave', 'flowers'];
const ENEMY_TYPES = ['shade', 'moth', 'crawler', 'wraith', 'golem', 'boss'];
const NIGHT_AMB = new THREE.Color(0.22, 0.26, 0.46), DAWN_AMB = new THREE.Color(1.0, 0.78, 0.62);
const NIGHT_MOON = new THREE.Color(0.45, 0.6, 1.0), DAWN_MOON = new THREE.Color(1.0, 0.72, 0.4);
const NIGHT_FOG = new THREE.Color(0.02, 0.025, 0.07), DAWN_FOG = new THREE.Color(0.42, 0.3, 0.32);

export const SPRITES = ['hero', 'shade', 'moth', 'crawler', 'wraith', 'golem', 'boss_moth', 'grave_warden_boss', 'dread_seraph', 'level4_ashen_titan', 'level5_frost_hag', 'gem_ember', 'gem_moon', 'heart_pickup', 'brazier', ...PROP_TYPES];

export class Game {
  constructor(r, spr) {
    this.r = r;
    this.world = buildWorld();
    this.hits = colliderGrid(this.world.colliders);
    const sc = r.scene;
    makeGround(sc, HALF, this.world.paths);
    this.mist = makeMist(sc);
    this.beams = makeBeams(sc, this.world.beams);

    this.shadowsStatic = new DecalBatch(sc, { cap: 700 });
    this.shadows = new DecalBatch(sc, { cap: 900 });
    this.rings = new DecalBatch(sc, { cap: 64, additive: true });
    this.pools = new DecalBatch(sc, { cap: 64, pool: true });
    this.props = {};
    for (const t of PROP_TYPES) this.props[t] = new SpriteBatch(sc, spr[t], { cap: 400, glow: t === 'mushrooms' || t === 'flowers' ? 2.2 : t === 'bush' || t === 'grave' || t === 'arch' ? 1.6 : 0 });
    for (const p of this.world.props) {
      this.props[p.type].add(p.x, 0, p.z, p.s * (p.flip ? -1 : 1), p.s);
      const big = p.type.startsWith('tree') ? 1.6 : p.type === 'arch' ? 2.4 : p.type === 'statue' ? 1.3 : 0.7;
      if (!['flowers', 'mushrooms'].includes(p.type)) this.shadowsStatic.shadow(p.x + 0.25, p.z + 0.15, big * p.s, 0.55);
    }
    for (const b of Object.values(this.props)) b.end();
    this.braz = new SpriteBatch(sc, spr.brazier, { cap: 8, glow: 3 });
    for (const b of this.world.braziers) this.shadowsStatic.shadow(b.x + 0.2, b.z + 0.1, 0.8, 0.6);
    this.shadowsStatic.end();

    this.pl = new SpriteBatch(sc, spr.hero, { cap: 16, glow: 2.6, rim: 0.8, frames: HERO_FRAMES, face: true });
    this.plSil = new SpriteBatch(sc, spr.hero, { cap: 1, silhouette: true, frames: HERO_FRAMES, face: true });
    this.eb = {};
    for (const t of ENEMY_TYPES) this.eb[t] = new SpriteBatch(sc, spr[t === 'boss' ? 'boss_moth' : t], { cap: t === 'boss' ? 2 : 420, glow: D.ENEMIES[t].glow, rim: 1.1 });
    this.eb.grave = new SpriteBatch(sc, spr.grave_warden_boss, { cap: 2, glow: 2.5, rim: 1.1 });
    this.eb.seraph = new SpriteBatch(sc, spr.dread_seraph, { cap: 2, glow: 3.0, rim: 1.1 });
    const bossAssets = ['level4_ashen_titan','level5_frost_hag','level6_void_leviathan','level7_briar_queen','level8_sun_eater','level9_storm_archon','level10_dawn_reaper'];
    bossAssets.slice(0, 2).forEach((n, i) => { this.eb[`level${i + 4}`] = new SpriteBatch(sc, spr[n], { cap: 2, glow: 2.5 + i * 0.15, rim: 1.1 }); });
    this.gb = { ember: new SpriteBatch(sc, spr.gem_ember, { cap: 700, glow: 1.4 }), moon: new SpriteBatch(sc, spr.gem_moon, { cap: 200, glow: 1.4 }), heart: new SpriteBatch(sc, spr.heart_pickup, { cap: 20, glow: 3 }) };
    this.glow = new FxBatch(sc, { cap: 5000 });
    this.px = new FxBatch(sc, { cap: 3000, square: true });

    this.glowQ = [];
    this.fireflies = Array.from({ length: 90 }, () => ({ x: rand(-HALF, HALF), z: rand(-HALF, HALF), y: rand(0.4, 2.5), ph: rand(0, TAU), sp: rand(0.3, 0.9) }));
    this.camX = 0; this.camZ = 6; this.camDist = 34;
    this.mode = 'title';
    this.runMode = 'story';
    this.reset();
  }

  reset() {
    this.p = { x: 0, z: 3, vx: 0, vz: 0, hp: 100, maxHp: 100, face: 1, walk: 0, dashT: 0, dashCd: 0, dx: 0, dz: 1, inv: 0, ward: 0, wardUp: false, flash: 0, trail: [], dead: false };
    this.lv = { bolt: 1 };
    this.en = []; this.shots = []; this.eshots = []; this.gems = []; this.parts = []; this.texts = []; this.arcs = []; this.corpses = [];
    this.t = 0; this.spawnAcc = 0; this.surgeIdx = 0; this.boss = null; this.bossDone = false;
    this.cd = { bolt: 0.5, chain: 2, nova: 3 };
    this.level = 1; this.bossLevel = 1; this.xp = 0; this.need = D.xpNeed(1); this.pendingLevels = 0;
    this.score = 0; this.kills = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0; this.streak = 0; this.streakT = 0; this.lit = 0;
    this.slow = 1; this.hitstop = 0; this.hurtFx = 0; this.dawn = 0; this.over = 0; this.won = 0; this.events = []; this.hinted = false;
    for (const b of this.world.braziers) { b.lit = 0; b.fuel = 0; b.prog = 0; }
    this.world.braziers[0].lit = 1; this.world.braziers[0].fuel = 999;
  }

  start() {
    this.reset();
    this.world.braziers[0].lit = 0; this.world.braziers[0].fuel = 0;
    this.mode = 'play';
  }

  advanceLevel() {
    this.bossLevel++;
    this.t = 0; this.spawnAcc = 0; this.surgeIdx = 0; this.boss = null; this.bossDone = false;
    this.en.length = 0; this.eshots.length = 0; this.gems.length = 0;
    this.p.hp = this.p.maxHp; this.p.dead = false; this.over = 0;
    this.events.push({ banner: `BOSS LEVEL ${this.bossLevel}`, sub: `player level ${this.level} carries on` });
    A.setMusic(1);
  }

  // --- helpers -------------------------------------------------------------

  // Atlas (tools/cycle.py): 0-1 idle breathe, 2-5 run (stride, pass, stride, pass).
  heroFrame() {
    const p = this.p;
    if (p.dead) return 0;
    if (Math.hypot(p.vx, p.vz) > 0.8) return 4 + (Math.floor(p.walk) % 6);
        return Math.floor(shared.uTime.value * 1.6) % 2;
  }

  stat(id) { return this.lv[id] || 0; }
  cdMul() { return 1 - this.stat('wick') * 0.08; }
  speed() { return 6 * (1 + this.stat('boots') * 0.1); }
  lightRadius() { return D.lightR(this.stat('lantern')); }
  magnet() { return D.magnetR(this.stat('magnet')); }

  emit(x, y, z, n, col, { sp = 4, size = 0.3, life = 0.6, up = 2, grav = -4, drag = 2, sq = false, spread = 1 } = {}) {
    for (let i = 0; i < n && this.parts.length < 2800; i++) {
      const a = Math.random() * TAU, s = sp * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, z, vx: Math.cos(a) * s * spread, vy: up * (0.4 + Math.random()), vz: Math.sin(a) * s * spread, life: life * (0.6 + Math.random() * 0.6), max: 0, size: size * (0.6 + Math.random() * 0.8), r: col[0], g: col[1], b: col[2], grav, drag, sq });
      this.parts[this.parts.length - 1].max = this.parts[this.parts.length - 1].life;
    }
  }

  text(x, z, s, color = '#fff', big = false, y = 2) {
    if (this.texts.length > 45) this.texts.shift();
    this.texts.push({ x: x + rand(-0.3, 0.3), y, z, s, color, big, t: 0 });
  }

  collide(o, r) {
    for (const c of this.hits(o.x, o.z)) {
      const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
      if (d < m && d > 0.0001) { o.x = c.x + (dx / d) * m; o.z = c.z + (dz / d) * m; }
    }
    const lim = HALF - 2.5;
    o.x = clamp(o.x, -lim, lim); o.z = clamp(o.z, -lim, lim);
  }

  nearest(x, z, maxD = 1e9, skip) {
    let best = null, bd = maxD * maxD;
    for (const e of this.en) {
      if (e.dead || (skip && skip.has(e))) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // --- spawning ------------------------------------------------------------

  spawn(type, x, z) {
    const b = D.ENEMIES[type];
    const scale = type === 'boss' ? 1 + (this.bossLevel - 1) * 0.34 : 1 + (this.t / D.NIGHT) * 1.3;
    const bossStats = type === 'boss' ? { ...b, hp: b.hp * scale, speed: b.speed * (1 + (this.bossLevel - 1) * 0.045), dmg: b.dmg * (1 + (this.bossLevel - 1) * 0.12) } : b;
    const renderType = type === 'boss' ? (this.bossLevel === 1 ? 'boss' : this.bossLevel === 2 ? 'grave' : this.bossLevel === 3 ? 'seraph' : `level${Math.min(5, this.bossLevel)}`) : type;
    const e = { type, renderType, x, z, vx: 0, vz: 0, kx: 0, kz: 0, hp: bossStats.hp, max: bossStats.hp, b: bossStats, flash: 0, t: rand(0, 10), face: 1, orbT: 0, burn: 0, atk: rand(1.5, 3), slow: 0, dead: false, spawnT: 0 };
    if (type === 'boss') { e.ai = 'chase'; e.aiT = 3; e.seq = 0; }
    this.en.push(e);
    return e;
  }

  ringSpot(minD, maxD) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, d = rand(minD, maxD);
      const x = clamp(this.p.x + Math.cos(a) * d, -HALF + 4, HALF - 4), z = clamp(this.p.z + Math.sin(a) * d, -HALF + 4, HALF - 4);
      if (Math.hypot(x - this.p.x, z - this.p.z) > minD * 0.8) return [x, z];
    }
    return [this.p.x + minD, this.p.z];
  }

  director(dt) {
    const t = this.t;
    if (!this.hinted && t > 7 && !this.lit) { this.hinted = true; this.events.push({ banner: 'LIGHT THE BRAZIERS', sub: 'stand beside one to kindle it, its fire burns the dark' }); }
    if (t >= D.BOSS_AT && !this.boss && !this.bossDone) {
      const [x, z] = this.ringSpot(13, 14);
      this.boss = this.spawn('boss', x, z);
      this.events.push({ banner: 'THE MOONMOTH MATRIARCH', sub: 'descends from the moon' });
      A.roar(); A.setMusic(4);
      this.r.shake.amt = 1.2;
    }
    if (this.surgeIdx < D.SURGES.length && t >= D.SURGES[this.surgeIdx]) {
      this.surgeIdx++;
      const n = 18 + this.surgeIdx * 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        this.spawn(this.surgeIdx > 2 && i % 3 === 0 ? 'crawler' : 'shade', clamp(this.p.x + Math.cos(a) * 15, -HALF + 3, HALF - 3), clamp(this.p.z + Math.sin(a) * 15, -HALF + 3, HALF - 3));
      }
      this.events.push({ banner: 'A SURGE OF SHADOWS', sub: 'they close in from every side' });
      A.gong();
    }
    if (this.en.length > 320) return;
    const rate = (1.0 + (t / D.NIGHT) * 5.5) * (this.boss ? 0.45 : 1);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc--;
      const roll = Math.random();
      const [x, z] = this.ringSpot(17, 21);
      if (t > 150 && roll < 0.04) this.spawn('golem', x, z);
      else if (t > 110 && roll < 0.1) this.spawn('wraith', x, z);
      else if (t > 40 && roll < 0.24) {
        for (let i = 0; i < 5; i++) this.spawn('moth', x + rand(-1.5, 1.5), z + rand(-1.5, 1.5));
      } else if (t > 75 && roll < 0.45) this.spawn('crawler', x, z);
      else this.spawn('shade', x, z);
    }
  }

  // --- combat --------------------------------------------------------------

  damage(e, dmg, kx = 0, kz = 0, quiet = false) {
    if (e.dead) return;
    const crit = !quiet && Math.random() < 0.12;
    if (crit) dmg *= 2;
    e.hp -= dmg;
    e.flash = e.b.heavy ? 0.55 : 1;
    if (!e.b.heavy) { e.kx += kx; e.kz += kz; } else { e.kx += kx * 0.15; e.kz += kz * 0.15; }
    if (!quiet || dmg >= 8) this.text(e.x, e.z, Math.round(dmg), crit ? '#ffd35a' : '#fff', crit, 1.4 + e.b.hover);
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.dead = true;
    const b = e.b, boss = e.type === 'boss';
    this.kills++;
    this.combo++; this.comboT = 2.2;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += Math.round(b.score * this.mult());
    this.corpses.push({ type: e.type, x: e.x, z: e.z, face: e.face, t: 0, y: b.hover });
    this.emit(e.x, 0.6 + b.hover, e.z, boss ? 160 : e.b.heavy ? 30 : 8, b.col.map((c) => c * 1.6), { sp: boss ? 12 : 5, size: boss ? 0.5 : 0.28, life: boss ? 1.6 : 0.6, up: 3 });
    this.emit(e.x, 0.6 + b.hover, e.z, boss ? 60 : 6, [3, 1.6, 0.6], { sp: 3, size: 0.12, life: 0.8, sq: true, up: 4 });
    A.kill(e.b.heavy);
    const drop = (kind, n, val) => { for (let i = 0; i < n; i++) this.drop(e.x + rand(-0.6, 0.6), e.z + rand(-0.6, 0.6), kind, val); };
    if (boss) {
      drop('ember', 40, 2); drop('moon', 8, 6); drop('heart', 2, 0);
      this.boss = null; this.bossDone = true;
      this.slowmo(1.6);
      this.r.shake.amt = 1.6;
      this.flash(0.9);
      if (!this.won) {
        this.events.push({ banner: 'THE MATRIARCH FALLS', sub: `+${Math.round(b.score * this.mult())}` });
        A.setMusic(3);
      }
      this.advanceLevel();
      return;
    }
    if (e.type === 'golem') { drop('moon', 1, 6); drop('ember', 3, 1); this.hitstop = 0.06; this.r.shake.amt = Math.max(this.r.shake.amt, 0.5); }
    else if (e.type === 'wraith') drop('moon', 1, 5);
    else drop('ember', e.type === 'crawler' ? 2 : 1, 1);
    if (Math.random() < (e.type === 'golem' ? 0.3 : 0.02)) drop('heart', 1, 0);
  }

  mult() { return 1 + Math.floor(this.combo / 15) * 0.5; }
  slowmo(t) { this.slowT = t; }
  flash(a) { this.events.push({ flash: a }); }

  drop(x, z, kind, val) {
    if (kind === 'ember' && this.gems.length > 380) {
      for (let i = this.gems.length - 1; i > this.gems.length - 40 && i >= 0; i--) {
        const g = this.gems[i];
        if (g.kind === 'ember' && !g.pull && Math.abs(g.x - x) < 2 && Math.abs(g.z - z) < 2) { g.val += val; return; }
      }
    }
    const a = Math.random() * TAU, s = rand(1.5, 3.5);
    this.gems.push({ x, z, y: 0.3, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: rand(3, 5), kind, val, pull: false, sp: 0, t: rand(0, 6) });
  }

  hurtPlayer(dmg, fx, fz) {
    const p = this.p;
    if (p.inv > 0 || p.dashT > 0 || p.dead || this.won) return;
    if (p.wardUp) {
      p.wardUp = false; p.ward = D.wardCd(this.stat('ward')) * this.cdMul(); p.inv = 0.6;
      this.emit(p.x, 1, p.z, 30, [0.8, 1.6, 3], { sp: 6, size: 0.3, life: 0.5 });
      this.text(p.x, p.z, 'BLOCKED', '#9fe3ff', true, 2.6);
      A.block();
      return;
    }
    p.hp -= dmg; p.inv = 0.7; p.flash = 1;
    const d = Math.hypot(p.x - fx, p.z - fz) || 1;
    p.vx += ((p.x - fx) / d) * 9; p.vz += ((p.z - fz) / d) * 9;
    this.hurtFx = 0.75; this.hitstop = 0.05;
    this.r.shake.amt = Math.max(this.r.shake.amt, 0.8);
    this.combo = 0;
    this.text(p.x, p.z, `-${Math.round(dmg)}`, '#ff5a4f', true, 2.4);
    this.emit(p.x, 1, p.z, 16, [3, 0.5, 0.4], { sp: 5, size: 0.25, life: 0.4 });
    A.hurt();
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true; this.over = 0.001;
      this.slowmo(2);
      A.setMusic(6);
    }
  }

  // --- update --------------------------------------------------------------

  update(rdt, input) {
    shared.uTime.value += rdt;
    if (this.slowT > 0) { this.slowT -= rdt; this.slow = lerp(this.slow, 0.25, 0.2); } else this.slow = lerp(this.slow, 1, 0.1);
    let dt = rdt * this.slow;
    if (this.hitstop > 0) { this.hitstop -= rdt; dt *= 0.08; }
    this.hurtFx = Math.max(0, this.hurtFx - rdt * 3.5);

    if (this.mode === 'title') {
      this.titleTime = (this.titleTime || 0) + rdt;
      this.camX = Math.sin(this.titleTime * 0.07) * 7;
      this.camZ = 5 + Math.cos(this.titleTime * 0.05) * 3;
      this.camDist = 30;
      this.updateBraziers(dt, false);
      this.updateParts(dt);
      return;
    }

    if (this.over > 0) this.over += rdt;
    if (this.won > 0) this.won += rdt;
    if (!this.p.dead && !this.won) {
      this.t += dt;
      if (this.runMode !== 'endless' && this.t >= D.NIGHT) this.dawnBreak();
      else this.director(dt);
    }
    const nightT = this.t / D.NIGHT;
    const dawnMix = this.won ? Math.min(1, this.won / 3) : clamp((nightT - 0.9) / 0.1, 0, 1) * 0.35;
    this.dawn = dawnMix;

    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    this.streakT -= dt;
    if (this.streakT <= 0) this.streak = 0;

    this.updatePlayer(dt, input);
    this.updateWeapons(dt);
    this.updateShots(dt);
    this.updateEnemies(dt);
    this.updateGems(dt);
    this.updateBraziers(dt, true);
    this.updateParts(dt);

    const p = this.p;
    this.camX = lerp(this.camX, p.x + p.vx * 0.12, 1 - Math.exp(-dt * 5));
    this.camZ = lerp(this.camZ, p.z + p.vz * 0.12, 1 - Math.exp(-dt * 5));
    this.camDist = lerp(this.camDist, this.boss ? 33 : 30, dt * 1.5);
  }

  dawnBreak() {
    this.won = 0.001;
    this.t = D.NIGHT;
    A.setMusic(5);
    this.flash(0.7);
    this.events.push({ banner: 'DAWN', sub: 'the night is over' });
    this.en.forEach((e, i) => { e.dawnT = 0.3 + (i % 40) * 0.05; });
    this.eshots.length = 0;
  }

  updatePlayer(dt, input) {
    const p = this.p;
    p.inv -= dt; p.flash = Math.max(0, p.flash - dt * 6); p.dashCd -= dt;
    if (this.stat('ward') && !p.wardUp) { p.ward -= dt; if (p.ward <= 0) { p.wardUp = true; A.block(); } }
    if (p.dead) { p.vx *= 0.9; p.vz *= 0.9; return; }
    let ix = input.x, iz = input.z;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    if (il > 0.1) { p.dx = ix / Math.max(il, 1e-3); p.dz = iz / Math.max(il, 1e-3); }
    if (input.dash && p.dashCd <= 0 && p.dashT <= 0) {
      p.dashT = 0.18; p.dashCd = 1.1 - this.stat('boots') * 0.08;
      A.dash();
      this.emit(p.x, 0.3, p.z, 10, [0.6, 0.8, 1.4], { sp: 3, size: 0.35, life: 0.4, up: 0.5 });
    }
    const sp = this.speed();
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dx * sp * 3.4; p.vz = p.dz * sp * 3.4;
      p.trail.push({ x: p.x, z: p.z, t: 0.25, face: p.face, frame: this.heroFrame() });
    } else {
      const k = 1 - Math.exp(-dt * 14);
      p.vx = lerp(p.vx, ix * sp, k); p.vz = lerp(p.vz, iz * sp, k);
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    this.collide(p, 0.4);
    if (Math.abs(p.vx) > 0.3) p.face = p.vx > 0 ? -1 : 1;
    const moving = Math.hypot(p.vx, p.vz) > 0.8;
    const step = Math.floor(p.walk);
    if (moving) p.walk += dt * Math.hypot(p.vx, p.vz) * 1.5;
    if (moving && Math.floor(p.walk) !== step && Math.floor(p.walk) % 2 === 0) this.emit(p.x, 0.1, p.z + 0.1, 3, [0.35, 0.4, 0.6], { sp: 0.8, size: 0.28, life: 0.45, up: 0.4, grav: 0 });
    for (const tr of p.trail) tr.t -= dt;
    p.trail = p.trail.filter((tr) => tr.t > 0);
  }

  updateWeapons(dt) {
    const p = this.p;
    if (p.dead || this.won) return;
    const cm = this.cdMul();
    const bl = this.stat('bolt');
    this.cd.bolt -= dt;
    if (this.cd.bolt <= 0) {
      const tgt = this.nearest(p.x, p.z, 15);
      if (tgt) {
        this.cd.bolt = D.boltCd(bl) * cm;
        const n = 1 + this.stat('twin');
        const base = Math.atan2(tgt.z - p.z, tgt.x - p.x);
        const lx = p.x - p.face * 0.52, lz = p.z + 0.1;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.16;
          this.shots.push({ x: lx, z: lz, y: 1.0, vx: Math.cos(a) * 17, vz: Math.sin(a) * 17, dmg: D.boltDmg(bl), life: 1.1, pierce: bl >= 4 ? 1 : 0, hit: new Set(), spark: false });
        }
        this.emit(lx, 1, lz, 4, [3, 1.5, 0.5], { sp: 2, size: 0.2, life: 0.25 });
        A.shoot();
      }
    }
    const ol = this.stat('orbit');
    if (ol) {
      const n = ol + 1, rad = 2.3 + ol * 0.15;
      this.orbs = [];
      for (let i = 0; i < n; i++) {
        const a = shared.uTime.value * 3.2 + (i / n) * TAU;
        const ox = p.x + Math.cos(a) * rad, oz = p.z + Math.sin(a) * rad * 0.9;
        this.orbs.push([ox, oz]);
        for (const e of this.en) {
          if (e.dead || e.orbT > 0) continue;
          if ((e.x - ox) ** 2 + (e.z - oz) ** 2 < (e.b.r + 0.55) ** 2) {
            e.orbT = 0.4;
            this.damage(e, D.orbitDmg(ol), Math.cos(a + 1.57) * 4, Math.sin(a + 1.57) * 4);
            A.hit();
          }
        }
      }
    } else this.orbs = null;

    const chl = this.stat('chain');
    if (chl) {
      this.cd.chain -= dt;
      if (this.cd.chain <= 0) {
        let cur = this.nearest(p.x, p.z, 12);
        if (cur) {
          this.cd.chain = D.chainCd(chl) * cm;
          const seen = new Set();
          let fx = p.x, fz = p.z;
          for (let j = 0; j < chl + 2 && cur; j++) {
            seen.add(cur);
            this.arcs.push({ ax: fx, az: fz, bx: cur.x, bz: cur.z, t: 0.22 });
            this.damage(cur, D.chainDmg(chl));
            fx = cur.x; fz = cur.z;
            cur = this.nearest(fx, fz, 6, seen);
          }
          A.zap();
        }
      }
    }

    const nl = this.stat('nova');
    if (nl) {
      this.cd.nova -= dt;
      if (this.cd.nova <= 0) {
        this.cd.nova = D.novaCd(nl) * cm;
        this.blast(p.x, p.z, D.novaR(nl), D.novaDmg(nl), [3, 2.2, 1]);
        A.nova();
      }
    }

    const al = this.stat('lantern');
    if (al) {
      const rr = this.lightRadius() * 0.5;
      for (const e of this.en) {
        if (e.dead || (e.x - p.x) ** 2 + (e.z - p.z) ** 2 > rr * rr) continue;
        e.burn += D.auraDps(al) * dt;
        if (e.burn >= 4) { this.damage(e, e.burn, 0, 0, true); e.burn = 0; }
      }
    }
  }

  blast(x, z, rad, dmg, col) {
    this.novas = this.novas || [];
    this.novas.push({ x, z, rad, t: 0, col });
    for (const e of this.en) {
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
      if (dmg > 0 && !e.dead && d < rad + e.b.r) this.damage(e, dmg, (dx / (d || 1)) * 10, (dz / (d || 1)) * 10);
    }
    this.eshots = this.eshots.filter((s) => Math.hypot(s.x - x, s.z - z) > rad);
    this.emit(x, 0.5, z, 40, col, { sp: rad * 3, size: 0.35, life: 0.5, up: 1, grav: 0, drag: 4 });
    this.r.shake.amt = Math.max(this.r.shake.amt, 0.35);
  }

  updateShots(dt) {
    const sl = this.stat('scatter');
    for (const s of this.shots) {
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      if (Math.random() < 0.7) this.parts.push({ x: s.x, y: s.y, z: s.z, vx: 0, vy: 0.3, vz: 0, life: 0.22, max: 0.22, size: s.spark ? 0.18 : 0.32, r: 2.2, g: 0.9, b: 0.3, grav: 0, drag: 0, sq: false });
      for (const e of this.en) {
        if (e.dead || s.hit.has(e)) continue;
        const rr = e.b.r + 0.3;
        if (Math.abs(e.x - s.x) > rr || Math.abs(e.z - s.z) > rr) continue;
        if ((e.x - s.x) ** 2 + (e.z - s.z) ** 2 > rr * rr) continue;
        s.hit.add(e);
        const sp = Math.hypot(s.vx, s.vz);
        this.damage(e, s.dmg, (s.vx / sp) * 5, (s.vz / sp) * 5);
        this.emit(s.x, s.y, s.z, 6, [3, 1.4, 0.4], { sp: 3, size: 0.18, life: 0.3 });
        A.hit();
        if (sl && !s.spark) {
          for (let i = 0; i <= sl; i++) {
            const a = Math.random() * TAU;
            this.shots.push({ x: s.x, z: s.z, y: s.y, vx: Math.cos(a) * 12, vz: Math.sin(a) * 12, dmg: s.dmg * (0.3 + sl * 0.1), life: 0.35, pierce: 0, hit: new Set([e]), spark: true });
          }
        }
        if (s.pierce-- <= 0) { s.life = 0; break; }
      }
    }
    this.shots = this.shots.filter((s) => s.life > 0);

    const p = this.p;
    for (const s of this.eshots) {
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      if ((s.x - p.x) ** 2 + (s.z - p.z) ** 2 < (s.r + 0.35) ** 2) { this.hurtPlayer(s.dmg, s.x, s.z); s.life = 0; }
    }
    this.eshots = this.eshots.filter((s) => s.life > 0);
    for (const a of this.arcs) a.t -= dt;
    this.arcs = this.arcs.filter((a) => a.t > 0);
    if (this.novas) {
      for (const n of this.novas) n.t += dt;
      this.novas = this.novas.filter((n) => n.t < 0.45);
    }
  }

  updateEnemies(dt) {
    const p = this.p;
    const grid = new Map();
    for (const e of this.en) {
      const k = Math.floor(e.x / 1.6) * 4096 + Math.floor(e.z / 1.6);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(e);
    }
    const braz = this.world.braziers;
    for (const e of this.en) {
      if (e.dead) continue;
      const b = e.b;
      e.t += dt; e.spawnT += dt;
      e.flash = Math.max(0, e.flash - dt * 12);
      e.orbT -= dt;
      if (e.dawnT !== undefined) {
        e.dawnT -= dt;
        if (e.dawnT <= 0) { this.kill(e); }
        continue;
      }
      let dx = p.x - e.x, dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      let sp = b.speed * (e.slow > 0 ? 0.5 : 1);
      e.slow -= dt;
      let mx = dx, mz = dz;

      if (e.type === 'moth') {
        const w = Math.sin(e.t * 3) * 0.9;
        mx = dx - dz * w; mz = dz + dx * w;
      } else if (e.type === 'wraith') {
        if (d < 6.5) { mx = -dx; mz = -dz; sp *= 0.7; } else if (d < 9) { mx = -dz; mz = dx; sp *= 0.6; }
        e.atk -= dt;
        if (e.atk <= 0 && d < 14) {
          e.atk = 2.8;
          for (const off of [-0.2, 0, 0.2]) {
            const a = Math.atan2(dz, dx) + off;
            this.eshots.push({ x: e.x, z: e.z, vx: Math.cos(a) * 6.5, vz: Math.sin(a) * 6.5, life: 3, r: 0.35, dmg: 10, col: [2.2, 0.4, 0.6] });
          }
          this.emit(e.x, 1.2, e.z, 8, [2, 0.3, 0.5], { sp: 2, size: 0.3, life: 0.4 });
        }
      } else if (e.type === 'boss') {
        [mx, mz, sp] = this.bossAI(e, dt, dx, dz, d);
      }

      const k = 1 - Math.exp(-dt * 6);
      e.vx = lerp(e.vx, mx * sp, k); e.vz = lerp(e.vz, mz * sp, k);
      e.x += (e.vx + e.kx) * dt; e.z += (e.vz + e.kz) * dt;
      const kd = Math.exp(-dt * 9);
      e.kx *= kd; e.kz *= kd;
      if (Math.abs(e.vx) > 0.2) e.face = e.vx > 0 ? -1 : 1;

      const gi = Math.floor(e.x / 1.6), gj = Math.floor(e.z / 1.6);
      for (let i = gi - 1; i <= gi + 1; i++) for (let j = gj - 1; j <= gj + 1; j++) {
        const cell = grid.get(i * 4096 + j);
        if (!cell) continue;
        for (const o of cell) {
          if (o === e || o.dead) continue;
          const ox = e.x - o.x, oz = e.z - o.z, m = (e.b.r + o.b.r) * 0.85, dd = ox * ox + oz * oz;
          if (dd < m * m && dd > 1e-6) {
            const dist = Math.sqrt(dd), push = ((m - dist) / dist) * (o.b.heavy && !e.b.heavy ? 0.9 : 0.5);
            e.x += ox * push; e.z += oz * push;
          }
        }
      }
      if (e.type !== 'boss' && e.type !== 'moth') this.collide(e, b.r * 0.8);

      if (d < b.r + 0.4 && !p.dead) this.hurtPlayer(b.dmg, e.x, e.z);

      for (const bz of braz) {
        if (!bz.lit) continue;
        if ((bz.x - e.x) ** 2 + (bz.z - e.z) ** 2 < 36) {
          e.slow = 0.2;
          e.burn += 12 * dt;
          if (e.burn >= 5) { this.damage(e, e.burn, 0, 0, true); e.burn = 0; }
        }
      }
    }
    this.en = this.en.filter((e) => !e.dead);
    for (const c of this.corpses) c.t += dt;
    this.corpses = this.corpses.filter((c) => c.t < 0.45);
  }

  bossAI(e, dt, dx, dz, d) {
    const hpF = e.hp / e.max;
    const rage = hpF < 0.5;
    e.aiT -= dt;
    if (e.ai === 'chase') {
      if (e.aiT <= 0) {
        const seq = ['ring', 'swoop', 'summon', 'swoop', 'ring', 'swoop'];
        e.ai = seq[e.seq++ % seq.length];
        e.aiT = e.ai === 'swoop' ? 0.9 : 0.5;
        if (e.ai === 'swoop') { e.tx = dx; e.tz = dz; }
      }
      return [dx, dz, d > 5 ? e.b.speed * (rage ? 1.3 : 1) : 0.4];
    }
    if (e.ai === 'swoop') {
      if (e.aiT > 0) {
        this.tele = { x: e.x, z: e.z, dx: e.tx, dz: e.tz, t: e.aiT };
        return [0, 0, 0];
      }
      this.tele = null;
      if (!e.swoopT) { e.swoopT = 0.75; A.dash(); this.r.shake.amt = Math.max(this.r.shake.amt, 0.4); }
      e.swoopT -= dt;
      e.vx = e.tx * 19; e.vz = e.tz * 19;
      if (Math.random() < 0.8) this.emit(e.x, 1.5, e.z, 2, [1.4, 1.6, 3], { sp: 1, size: 0.5, life: 0.5 });
      if (e.swoopT <= 0) { e.swoopT = 0; e.ai = 'chase'; e.aiT = rage ? 1.6 : 2.6; }
      return [e.tx, e.tz, 19];
    }
    if (e.ai === 'ring') {
      const waves = rage ? 2 : 1;
      for (let w = 0; w < waves; w++) {
        const n = 20, off = w * (Math.PI / n);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + off;
          const s = 5.2 - w * 1.4;
          this.eshots.push({ x: e.x, z: e.z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, life: 5, r: 0.4, dmg: 14, col: [0.9, 1.3, 3] });
        }
      }
      A.nova();
      this.emit(e.x, 1.6, e.z, 40, [1, 1.4, 3], { sp: 6, size: 0.4, life: 0.6 });
      e.ai = 'chase'; e.aiT = rage ? 1.8 : 2.8;
    } else if (e.ai === 'summon') {
      for (let i = 0; i < (rage ? 9 : 6); i++) {
        const a = (i / 6) * TAU;
        this.spawn('moth', e.x + Math.cos(a) * 2.5, e.z + Math.sin(a) * 2.5);
      }
      this.emit(e.x, 1.6, e.z, 30, [2, 1.6, 2.6], { sp: 4, size: 0.4, life: 0.7 });
      e.ai = 'chase'; e.aiT = 2.2;
    }
    return [dx, dz, 0.5];
  }

  updateGems(dt) {
    const p = this.p, mr = this.magnet();
    for (const g of this.gems) {
      g.t += dt;
      if (g.vy || g.y > 0.3) {
        g.vy -= 18 * dt; g.y += g.vy * dt; g.x += g.vx * dt; g.z += g.vz * dt;
        if (g.y <= 0.3) { g.y = 0.3; g.vy = 0; g.vx = 0; g.vz = 0; }
      }
      const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
      if (!p.dead && (d < mr || this.won > 1.5)) g.pull = true;
      if (g.pull) {
        g.sp += dt * 45;
        const s = Math.min(g.sp, 30) * dt;
        g.x += (dx / (d || 1)) * s; g.z += (dz / (d || 1)) * s;
        if (d < 0.6) this.collect(g);
      }
    }
    this.gems = this.gems.filter((g) => !g.got);
  }

  collect(g) {
    g.got = true;
    const p = this.p;
    if (g.kind === 'heart') {
      p.hp = Math.min(p.maxHp, p.hp + 30);
      this.text(p.x, p.z, '+30', '#7dff9a', true, 2.4);
      A.pick();
      this.emit(p.x, 1, p.z, 16, [0.6, 3, 1], { sp: 3, size: 0.3, life: 0.6 });
      return;
    }
    this.streak++; this.streakT = 0.7;
    A.gem(this.streak);
    this.xp += g.val;
    this.score += g.val * 2;
    this.emit(p.x, 1.1, p.z, 2, g.kind === 'moon' ? [1, 2, 3] : [3, 1.6, 0.5], { sp: 1.5, size: 0.2, life: 0.3, sq: true });
    while (this.xp >= this.need) {
      this.xp -= this.need;
      this.level++;
      this.need = D.xpNeed(this.level);
      this.pendingLevels++;
    }
  }

  updateBraziers(dt, play) {
    const p = this.p;
    for (const b of this.world.braziers) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (play) {
        if (!b.lit) {
          if (d < 2.3 && !p.dead && !this.won) {
            b.prog += dt * 1.3;
            if (b.prog >= 1) this.ignite(b);
          } else b.prog = Math.max(0, b.prog - dt * 0.6);
        } else {
          b.fuel -= dt;
          if (d < 6 && !p.dead) p.hp = Math.min(p.maxHp, p.hp + 3 * dt);
          if (b.fuel <= 0) {
            b.lit = 0; b.prog = 0;
            this.emit(b.x, 1.2, b.z, 20, [0.25, 0.25, 0.35], { sp: 1, size: 0.6, life: 1.4, up: 1.5, grav: 0.5 });
          }
        }
      }
      if (b.lit && Math.random() < dt * 60) {
        const f = clamp(b.fuel / 45, 0.3, 1);
        this.parts.push({ x: b.x + rand(-0.35, 0.35), y: 2.1, z: b.z + 0.3 + rand(-0.15, 0.15), vx: rand(-0.3, 0.3), vy: rand(1.5, 3) * f, vz: 0.1, life: rand(0.4, 0.8), max: 0.8, size: rand(0.55, 1.0) * f, r: 2.6, g: 1.1, b: 0.3, grav: 0.5, drag: 1, sq: false });
        if (Math.random() < 0.25) this.parts.push({ x: b.x + rand(-0.3, 0.3), y: 2.3, z: b.z, vx: rand(-0.6, 0.6), vy: rand(2, 4), vz: 0, life: 1.4, max: 1.4, size: 0.09, r: 4, g: 2, b: 0.6, grav: -0.3, drag: 0.5, sq: true });
      }
    }
  }

  ignite(b) {
    b.lit = 1; b.fuel = 45; b.prog = 0;
    this.lit++;
    this.score += 100;
    A.ignite();
    this.blast(b.x, b.z, 5.5, 45, [3, 1.5, 0.4]);
    this.text(b.x, b.z, 'BRAZIER LIT', '#ffcf6b', true, 3);
    this.r.shake.amt = Math.max(this.r.shake.amt, 0.5);
  }

  updateParts(dt) {
    for (const q of this.parts) {
      q.life -= dt;
      const dr = Math.exp(-q.drag * dt);
      q.vx *= dr; q.vz *= dr; q.vy = q.vy * dr + q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.05) { q.y = 0.05; q.vy *= -0.3; }
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const t of this.texts) t.t += dt;
    this.texts = this.texts.filter((t) => t.t < 0.7);
  }

  // --- draw ----------------------------------------------------------------

  draw() {
    const T = shared.uTime.value, p = this.p;
    const nightT = this.t / D.NIGHT;
    shared.uAmbient.value.copy(NIGHT_AMB).multiplyScalar(1 - 0.18 * Math.sin(nightT * Math.PI)).lerp(DAWN_AMB, this.dawn);
    shared.uMoon.value.copy(NIGHT_MOON).lerp(DAWN_MOON, this.dawn);
    shared.uFog.value.copy(NIGHT_FOG).lerp(DAWN_FOG, this.dawn);
    this.beams.mat.uniforms.uAmt.value = 0.28 * (1 - this.dawn) + this.dawn * 0.9;
    this.beams.mat.uniforms.uTint.value.setRGB(lerp(0.35, 1.0, this.dawn), lerp(0.5, 0.62, this.dawn), lerp(0.95, 0.3, this.dawn));
    this.mist.uniforms.uAmt.value = 0.12 * (1 - this.dawn * 0.5);

    const lantern = p.dead ? Math.max(0, 1 - this.over * 0.8) : 1;
    const flick = 0.92 + Math.sin(T * 13) * 0.04 + Math.sin(T * 29) * 0.03;
    const lr = this.lightRadius();
    const lx = p.x - p.face * 0.52, lz = p.z + 0.15;
    light(lx, 1.3, lz, 2.1 * flick * lantern, 1.25 * flick * lantern, 0.55 * lantern, lr * lantern + 0.01);

    // player + afterimages
    this.pl.begin();
    this.shadows.begin();
    const blink = p.inv > 0 && !p.dead && Math.floor(T * 20) % 2 === 0;
    const frame = this.heroFrame();
    for (const tr of p.trail) this.pl.add(tr.x, 0, tr.z - 0.05, tr.face, 1, 0, 0.8, 1 - tr.t * 2.5, 2, tr.frame);
    if (!blink) this.pl.add(p.x, 0, p.z, p.face, 1, 0, p.flash, p.dead ? Math.min(1, this.over * 0.4) : 0, lantern, frame);
    this.plSil.begin();
    if (!p.dead && this.mode === 'play') this.plSil.add(p.x, 0, p.z + 0.12, p.face, 1, 0, 0, 0, 1, frame);
    this.plSil.end();
    this.shadows.shadow(p.x, p.z + 0.05, 0.75, 0.6);
    if (p.wardUp) {
      for (let i = 0; i < 10; i++) {
        const a = T * 1.5 + (i / 10) * TAU;
        this.glow.add(p.x + Math.cos(a) * 1.1, 1.1 + Math.sin(a * 2) * 0.2, p.z + Math.sin(a) * 1.1, 0.25, 0.4, 0.8, 1.6, 1);
      }
    }
    this.pl.end();

    // enemies
    for (const b of Object.values(this.eb)) b.begin();
    for (const e of this.en) {
      const b = e.b;
      let sx = e.face * b.s, sy = b.s, y = b.hover, rot = 0;
      if (e.type === 'moth') { sx *= 0.75 + Math.abs(Math.sin(e.t * 14)) * 0.35; y += Math.sin(e.t * 4) * 0.25; }
      else if (e.type === 'boss') { sx = b.s * (0.86 + Math.abs(Math.sin(e.t * 3)) * 0.16); y += Math.sin(e.t * 1.5) * 0.35; }
      else if (e.type === 'shade' || e.type === 'wraith') { y += Math.sin(e.t * 3) * 0.12; rot = Math.sin(e.t * 2) * 0.05; }
      else if (e.type === 'crawler') { sy *= 1 + Math.sin(e.t * 12) * 0.05; sx *= 1 - Math.sin(e.t * 12) * 0.04; }
      else if (e.type === 'golem') { y += Math.abs(Math.sin(e.t * 4)) * 0.1; rot = Math.sin(e.t * 4) * 0.04; }
      const pop = Math.min(1, e.spawnT * 3);
      const dis = e.dawnT !== undefined ? clamp(1 - e.dawnT * 3, 0, 1) : 0;
      this.eb[e.renderType || e.type].add(e.x, y, e.z, sx * (0.6 + pop * 0.4), sy * pop, rot, e.flash, dis, 1);
      this.shadows.shadow(e.x, e.z + 0.05, b.r * 1.3 * (e.type === 'boss' ? 1.8 : 1), e.b.hover > 0.5 ? 0.35 : 0.55);
      if (e.type === 'boss') light(e.x, 2.5, e.z, 0.6, 0.8, 2, 10);
      else if (e.type === 'wraith' || e.type === 'golem') light(e.x, 1.2, e.z, e.type === 'golem' ? 0.2 : 0.8, e.type === 'golem' ? 0.9 : 0.15, e.type === 'golem' ? 0.8 : 0.3, 3.5);
    }
    for (const c of this.corpses) {
      const b = D.ENEMIES[c.type];
      this.eb[c.type].add(c.x, c.y + c.t * 0.8, c.z, c.face * b.s * (1 + c.t), b.s * (1 - c.t * 0.5), 0, Math.max(0, 0.35 - c.t * 1.5), c.t / 0.45, 1);
      if (b.heavy) light(c.x, 1, c.z, b.col[0] * (1 - c.t * 2.2), b.col[1] * (1 - c.t * 2.2), b.col[2] * (1 - c.t * 2.2), 5);
    }
    for (const b of Object.values(this.eb)) b.end();

    // gems
    for (const b of Object.values(this.gb)) b.begin();
    for (const g of this.gems) {
      const s = g.kind === 'ember' ? Math.min(1 + (g.val - 1) * 0.15, 1.8) : 1;
      this.gb[g.kind].add(g.x, g.y + Math.sin(g.t * 3) * 0.08, g.z, s * (Math.sin(g.t * 2) > 0 ? 1 : -1), s, 0, 0, 0, 1 + Math.sin(g.t * 5) * 0.3);
      if (g.kind !== 'ember' || g.val > 3) light(g.x, 0.6, g.z, g.kind === 'moon' ? 0.3 : 1.2, g.kind === 'moon' ? 0.8 : 0.4, g.kind === 'moon' ? 1.4 : 0.3, 2.5);
    }
    for (const b of Object.values(this.gb)) b.end();

    // braziers
    this.braz.begin();
    this.rings.begin();
    this.pools.begin();
    if (this.boss) this.pools.ring(this.boss.x, this.boss.z, 5, 0.05, 0.08, 0.22);
    if (lantern > 0.01) this.pools.ring(lx, lz, lr * 0.75, 0.16 * lantern * flick, 0.08 * lantern * flick, 0.02 * lantern);
    if (!p.dead && this.mode === 'play') this.rings.ring(p.x, p.z, 0.9, 0.22, 0.12, 0.04);
    for (const b of this.world.braziers) {
      this.braz.add(b.x, 0, b.z, 1, 1, 0, 0, 0, b.lit ? 1 : 0);
      if (b.lit) {
        const f = clamp(b.fuel / 45, 0.35, 1) * (0.9 + Math.sin(T * 17 + b.x) * 0.06 + Math.sin(T * 7.3) * 0.05);
        light(b.x, 2.6, b.z, 2.6 * f, 1.2 * f, 0.4 * f, 10 * f + 2);
        this.glowQ.push([b.x, 2.25, b.z + 0.35, 1.4 * f, 2.2 * f, 0.9 * f, 0.25 * f]);
        this.rings.ring(b.x, b.z, 6, 0.25 * f, 0.1 * f, 0.02);
        this.pools.ring(b.x, b.z, 8 * f, 0.5 * f, 0.2 * f, 0.04 * f);
      } else if (this.mode === 'play') {
        const pulse = 0.5 + Math.sin(T * 3) * 0.3;
        this.rings.ring(b.x, b.z, 2.3, 0.1 * pulse, 0.18 * pulse, 0.35 * pulse);
        if (b.prog > 0) this.rings.ring(b.x, b.z, 2.3 * (1 - b.prog) + 0.2, 1.4, 0.7, 0.2);
        light(b.x, 1.5, b.z, 0.15, 0.25, 0.5, 4);
      }
    }
    this.braz.end();

    if (this.novas) for (const n of this.novas) {
      const k = n.t / 0.45;
      this.rings.ring(n.x, n.z, n.rad * Math.sqrt(k), n.col[0] * (1 - k), n.col[1] * (1 - k), n.col[2] * (1 - k));
      light(n.x, 1.5, n.z, n.col[0] * (1 - k) * 2, n.col[1] * (1 - k) * 2, n.col[2] * (1 - k) * 2, n.rad * 2);
    }
    if (this.tele && this.boss) {
      const t = this.tele;
      for (let i = 1; i < 14; i++) this.rings.ring(t.x + t.dx * i * 1.2, t.z + t.dz * i * 1.2, 0.6, 1.2, 0.2, 0.3);
    } else this.tele = null;
    this.rings.end();
    this.pools.end();

    // glow fx
    this.glow.begin();
    for (const q of this.glowQ) this.glow.add(...q, 1);
    this.glowQ.length = 0;
    this.px.begin();
    for (const s of this.shots) {
      this.glow.add(s.x, s.y, s.z, s.spark ? 0.35 : 0.7, 3, 1.5, 0.5, 1);
      if (!s.spark) light(s.x, 1.2, s.z, 0.7, 0.3, 0.08, 3);
    }
    for (const s of this.eshots) {
      this.glow.add(s.x, 0.9, s.z, 0.85, s.col[0], s.col[1], s.col[2], 1);
      this.glow.add(s.x, 0.9, s.z, 0.35, 2, 2, 2, 1);
      light(s.x, 1, s.z, s.col[0] * 0.3, s.col[1] * 0.3, s.col[2] * 0.3, 3);
    }
    if (this.orbs) for (const [ox, oz] of this.orbs) {
      this.glow.add(ox, 1, oz, 0.9, 3, 1.2, 0.3, 1);
      this.glow.add(ox, 1, oz, 0.4, 3, 2.5, 1.5, 1);
      light(ox, 1.2, oz, 0.8, 0.35, 0.08, 3.5);
      if (Math.random() < 0.5) this.parts.push({ x: ox, y: 1, z: oz, vx: 0, vy: 0.5, vz: 0, life: 0.3, max: 0.3, size: 0.4, r: 2.4, g: 0.8, b: 0.2, grav: 0, drag: 0, sq: false });
    }
    for (const a of this.arcs) {
      const n = Math.ceil(Math.hypot(a.bx - a.ax, a.bz - a.az) * 3);
      for (let i = 0; i <= n; i++) {
        const k = i / n, jit = Math.sin(k * Math.PI) * 0.5;
        this.glow.add(lerp(a.ax, a.bx, k) + rand(-jit, jit), 1 + rand(-jit, jit) * 0.5, lerp(a.az, a.bz, k) + rand(-jit, jit), 0.3, 1.2 * a.t * 5, 1.8 * a.t * 5, 3.5 * a.t * 5, 1);
      }
      light(a.bx, 1.2, a.bz, 0.4, 0.6, 1.2, 5);
    }
    for (const q of this.parts) {
      const k = q.life / q.max;
      (q.sq ? this.px : this.glow).add(q.x, q.y, q.z, q.size * (q.sq ? 1 : 0.5 + k * 0.5), q.r, q.g, q.b, k);
    }
    for (const f of this.fireflies) {
      const fx = f.x + Math.sin(T * f.sp + f.ph) * 1.5, fz = f.z + Math.cos(T * f.sp * 0.7 + f.ph) * 1.5, fy = f.y + Math.sin(T * 1.7 + f.ph) * 0.4;
      const tw = Math.max(0, Math.sin(T * 2.2 + f.ph * 3)) * (1 - this.dawn);
      if (tw > 0.05 && Math.abs(fx - this.camX) < 22 && Math.abs(fz - this.camZ) < 18) {
        this.px.add(fx, fy, fz, 0.1, 1.6 * tw, 2.4 * tw, 0.6 * tw, 1);
        this.glow.add(fx, fy, fz, 0.5, 0.5 * tw, 0.9 * tw, 0.2 * tw, 1);
      }
    }
    this.glow.end();
    this.px.end();
    this.shadows.end();

    flushLights(this.camX, this.camZ);
    this.r.place(this.camX, this.camZ, this.camDist, 1 / 60);
    const g = this.r.grade.uniforms;
    g.uDawn.value = this.dawn;
    g.uHurt.value = Math.max(this.hurtFx, p.hp / p.maxHp < 0.3 && !p.dead ? 0.25 + Math.sin(T * 6) * 0.1 : 0);
    g.uTime.value = T;
    this.r.bloom.strength = 0.85 + this.dawn * 0.5;
  }

  drawOverlay(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const cam = this.r.camera, v = new THREE.Vector3();
    const u = w / 1280;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      v.set(t.x, t.y + t.t * 1.4, t.z).project(cam);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const pop = t.t < 0.08 ? 1 + (0.08 - t.t) * 8 : 1;
      const size = (typeof t.s === 'string' ? 15 : t.big ? 20 : 13) * u * pop;
      ctx.globalAlpha = Math.min(1, (0.7 - t.t) * 5);
      ctx.font = `${size}px Silkscreen`;
      ctx.lineWidth = 4 * u;
      ctx.strokeStyle = '#120a1e';
      ctx.strokeText(t.s, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.s, x, y);
    }
    ctx.globalAlpha = 1;
    if (this.mode !== 'play' || this.won || this.p.dead) return;
    for (const b of this.world.braziers) {
      if (b.lit) continue;
      v.set(b.x, 1, b.z).project(cam);
      let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      if (x > 0 && x < w && y > 0 && y < h) continue;
      const cx = w / 2, cy = h / 2 + 12 * u;
      const a = Math.atan2(y - cy, x - cx);
      const s = Math.min((cx - 34 * u) / Math.abs(Math.cos(a)), (cy - 110 * u) / Math.abs(Math.sin(a)));
      x = cx + Math.cos(a) * s; y = cy + Math.sin(a) * s;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = 'rgba(12,14,34,0.75)';
      ctx.beginPath(); ctx.arc(0, 0, 13 * u, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9fe3ff';
      ctx.font = `${13 * u}px Silkscreen`;
      ctx.fillText('✦', 0, 5 * u);
      ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(20 * u, 0); ctx.lineTo(13 * u, -6 * u); ctx.lineTo(13 * u, 6 * u); ctx.fill();
      ctx.restore();
    }
  }

  // --- level-up ------------------------------------------------------------

  rollOptions() {
    const pool = D.UPGRADES.filter((u) => (this.lv[u.id] || 0) < u.max);
    const out = [];
    while (out.length < 3 && pool.length) {
      const weights = pool.map((u) => ((this.lv[u.id] || 0) ? 1.3 : 1) * (Object.keys(this.lv).length > 6 && !this.lv[u.id] ? 0.2 : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      let i = 0;
      while ((r -= weights[i]) > 0) i++;
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  apply(u) {
    this.lv[u.id] = (this.lv[u.id] || 0) + 1;
    if (u.id === 'heart') { this.p.maxHp += 20; this.p.hp = Math.min(this.p.maxHp, this.p.hp + 40); }
    if (u.id === 'ward' && this.lv.ward === 1) this.p.wardUp = true;
    this.pendingLevels--;
    this.emit(this.p.x, 1, this.p.z, 50, [3, 2, 0.8], { sp: 7, size: 0.35, life: 0.8, up: 3 });
    this.blast(this.p.x, this.p.z, 4, 0, [2, 1.4, 0.6]);
  }
}

