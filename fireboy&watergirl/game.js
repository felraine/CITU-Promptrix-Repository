// ---------------------------
// Setup (Full-screen + Popups flow)
// ---------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Size canvas: full-screen under a ~48px HUD bar
function sizeCanvas() {
  const HUD_HEIGHT = 48; // keep in sync with your CSS/top bar height
  canvas.width = window.innerWidth;
  canvas.height = Math.max(240, window.innerHeight - HUD_HEIGHT);
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

// HUD references (top bar)
const HUD = {
  level: document.getElementById('hudLevel'),
  time: document.getElementById('hudTime'),
  deaths: document.getElementById('hudDeaths'),
  chain: document.getElementById('hudChain'),
};

// ---------------------------
// Background Music 
// ---------------------------
const bgMusic = new Audio("assets/bg_music.mp3"); 
bgMusic.loop = true;
bgMusic.volume = 0.5; // range: 0.0 (mute) → 1.0 (full)

// helper function to start music safely
function startMusic() {
  if (bgMusic.paused) {
    bgMusic.play().catch(err => {
      console.log("Autoplay blocked until user interacts:", err);
    });
  }
}

// bind music start to any game-start events
document.addEventListener("click", startMusic, { once: true });
document.addEventListener("keydown", startMusic, { once: true });

// optional pause/resume controls
function pauseMusic() {
  if (!bgMusic.paused) bgMusic.pause();
}
function resumeMusic() {
  if (bgMusic.paused) startMusic();
}
// Music Credits: pixabay


// Start flow popups
const startScreen   = document.getElementById('startScreen');
const controlsPopup = document.getElementById('controlsPopup');
const goalPopup     = document.getElementById('goalPopup');

document.getElementById('btnStart')?.addEventListener('click', () => {
  startScreen.style.display = 'none';
  controlsPopup.style.display = 'flex';
});
document.getElementById('btnControlsNext')?.addEventListener('click', () => {
  controlsPopup.style.display = 'none';
  goalPopup.style.display = 'flex';
});
document.getElementById('btnGoalStart')?.addEventListener('click', () => {
  goalPopup.style.display = 'none';
  running = true;
});

// Keyboard
const keys = {};
addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (['arrowup','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
}, { passive: false });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// helpers
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ---------------------------
// Classes
// ---------------------------
class Player {
  constructor({x, y, color, controls, immune}) {
    this.spawnX = x; this.spawnY = y;
    this.x = x; this.y = y; this.w = 34; this.h = 44;
    this.dx = 0; this.dy = 0;

    // Movement tuning
    this.speed = 2.6;
    this.accel = 0.6;
    this.decel = 0.7;
    this.jumpPower = -11.6;
    this.maxFall = 11;
    this.gravity = 0.48;

    // platforming QoL
    this.coyoteMax = 0.10;
    this.bufferMax = 0.12;
    this.coyote = 0;
    this.buffer = 0;
    this.onGround = false;
    this.jumpHeld = false;

    this.color = color; // 'red' or 'blue'
    this.controls = controls;
    this.immune = immune;
    this.collected = 0; // gems collected
  }
  rect() { return {x:this.x,y:this.y,w:this.w,h:this.h}; }
  center() { return { cx: this.x + this.w/2, cy: this.y + this.h/2 }; }
  reset() {
    this.x = this.spawnX; this.y = this.spawnY;
    this.dx = 0; this.dy = 0;
    this.onGround = false;
    this.coyote = 0; this.buffer = 0; this.jumpHeld = false;
  }
}

class Platform {
  constructor(x,y,w,h) { this.x=x; this.y=y; this.w=w; this.h=h; }
  draw() { ctx.fillStyle = '#7b9704'; ctx.fillRect(this.x,this.y,this.w,this.h); }
}

class Hazard {
  constructor(x,y,w,h,type) { this.x=x; this.y=y; this.w=w; this.h=h; this.type=type; }
  draw() {
    ctx.fillStyle = this.type==='fire' ? '#ef4444' : this.type==='water' ? '#3b82f6' : '#22c55e';
    ctx.fillRect(this.x,this.y,this.w,this.h);
  }
}

class Plate {
  constructor(x,y,w,h) { this.x=x; this.y=y; this.w=w; this.h=h; this.active=false; }
  rect() { return {x:this.x,y:this.y,w:this.w,h:this.h}; }
  draw() { ctx.fillStyle = this.active ? '#cfd2da' : '#9ea3b0'; ctx.fillRect(this.x,this.y,this.w,this.h); }
}

class Door {
  constructor(x,y,w,h,color, linkedPlates=[]) {
    this.x=x; this.y=y; this.w=w; this.h=h; this.color=color;
    this.linkedPlates = linkedPlates;
    this.open = false;
  }
  update() { this.open = this.linkedPlates.every(p => p.active); }
  draw() {
    ctx.globalAlpha = this.open ? 0.25 : 1.0;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x,this.y,this.w,this.h);
    ctx.globalAlpha = 1.0;
  }
  rect() { return {x:this.x,y:this.y,w:this.w,h:this.h}; }
  isSolid() { return !this.open; }
}

class Exit {
  constructor(x,y,w,h, forColor) { this.x=x; this.y=y; this.w=w; this.h=h; this.forColor = forColor; }
  rect() { return {x:this.x,y:this.y,w:this.w,h:this.h}; }
  draw() {
    ctx.strokeStyle = this.forColor==='red' ? '#ef4444' : '#3b82f6';
    ctx.lineWidth = 3;
    ctx.strokeRect(this.x+1,this.y+1,this.w-2,this.h-2);
  }
}

// Rising water (murky)
class RisingWater {
  constructor(speed, color='#275a2d') {
    this.level = canvas.height; // starts below screen
    this.speed = speed; // px/frame
    this.color = color;
  }
  update() { if (running) this.level = Math.max(0, this.level - this.speed); }
  draw() {
    ctx.fillStyle = this.color;
    ctx.fillRect(0, this.level, canvas.width, canvas.height - this.level);
    ctx.strokeStyle = '#214d27';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, this.level, canvas.width, canvas.height - this.level);
  }
  collides(p) { return p.y + p.h > this.level; }
}

// Collectible diamond
class Gem {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    this.w = 18; this.h = 18;
    this.color = color; // 'red' or 'blue'
    this.collected = false;
  }
  rect() { return {x:this.x, y:this.y, w:this.w, h:this.h}; }
  draw() {
    if (this.collected) return;
    ctx.save();
    ctx.translate(this.x + this.w/2, this.y + this.h/2);
    ctx.rotate(Math.PI/4);
    ctx.fillStyle = this.color==='red' ? '#ff3b3b' : '#14b8ff';
    ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
    ctx.restore();
    ctx.save();
    ctx.translate(this.x + this.w/2, this.y + this.h/2);
    ctx.rotate(Math.PI/4);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.strokeRect(-this.w/2, -this.h/2, this.w, this.h);
    ctx.restore();
  }
}

// Pushable crate (extra jump height)
class Crate {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 44; this.h = 26;
    this.dx = 0; this.dy = 0;
    this.maxFall = 12;
    this.gravity = 0.48;
    this.onGround = false;
  }
  rect() { return {x:this.x, y:this.y, w:this.w, h:this.h}; }
  draw() {
    ctx.fillStyle = '#7c5cff';
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.strokeStyle = '#a78bfa';
    ctx.strokeRect(this.x+1, this.y+1, this.w-2, this.h-2);
  }
}

// Rat (patrolling hazard)
class Rat {
  constructor(x, y, left, right, speed = 1.1) {
    this.x = x; this.y = y;
    this.w = 28; this.h = 16;
    this.left = Math.min(left, right);
    this.right = Math.max(left, right);
    this.vx = Math.abs(speed);
  }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  update() {
    this.x += this.vx;
    if (this.x <= this.left) { this.x = this.left; this.vx *= -1; }
    if (this.x + this.w >= this.right) { this.x = this.right - this.w; this.vx *= -1; }
  }
  draw() {
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.fillStyle = '#f87171';
    ctx.fillRect(this.x + (this.vx > 0 ? this.w - 6 : 2), this.y + 4, 4, 4);
  }
}

// ---------------------------
// Level Definition (shaped to your mock)
// ---------------------------
const h = canvas.height;
const w = canvas.width;

// y positions for lanes
const TOP_Y   = 350;
const MID_Y   = h - 200;
const FLOOR_Y = h - 40;

// right vertical pillar that connects up to exits
const PILLAR_W = 120;
const pillar = new Platform(w - 120, h - 150, PILLAR_W, 180);

const level = {
  id: '1-1',
  width: w,
  height: h,
  gravity: 0.48,
  platforms: [
    // Bottom solid block (floor)
    new Platform(0, FLOOR_Y, w - 0, 40),

    // Middle long platform (boy)
    new Platform(0, MID_Y, w - 250, 22),

    // Two small blocks on mid platform (to mark "boy can walk" zone)
    new Platform(w/2 - 100, MID_Y - 22, 60, 22),
    new Platform(w/2 + 60,  MID_Y - 22, 60, 22),

    // Top long platform (girl), leaving gap on far right for pillar/exit
    new Platform(80, TOP_Y, w - PILLAR_W - 60, 22),

    // Right vertical pillar rising up (to top/exit)
    pillar,

    // Tiny step just under the exits (visual)
    new Platform(w - 180, TOP_Y - 40, 180, 40),
  ],
  hazards: [],
  // Pressure plates: one on top-left, one on mid-left
  plates: [
    new Plate(140, TOP_Y - 6, 50, 6),
    new Plate(220, MID_Y - 6, 50, 6),
  ],
  doors: [],
  // Two exits at top-right sitting on the pillar cap
  exits: [
    new Exit(w - 120, TOP_Y - 14, 40, 44, 'red'),
    new Exit(w - 70,  TOP_Y - 14, 40, 44, 'blue'),
  ],
  // Spawns at bottom-left
  spawns: { fireboy: {x: 40, y: FLOOR_Y - 44}, watergirl: {x: 90, y: FLOOR_Y - 44} },

  // Gems: top-left blue, top-mid red; mid-air cyan (we use blue gem sprite),
  // two bottom gems (red & blue) near mid-right; one more red mid-left
  gems: [
    new Gem(150, TOP_Y - 40, 'blue'),           // top-left (blue)
    new Gem(w/2 - 20, TOP_Y - 60, 'red'),       // top-mid (red)
    new Gem(w/2 + 10, MID_Y - 60, 'blue'),      // mid-air cyan spot
    new Gem(300, MID_Y - 50, 'red'),            // mid-left (red)
    new Gem(w - 360, FLOOR_Y - 70, 'blue'),     // low blue
    new Gem(w - 320, FLOOR_Y - 70, 'red'),      // low red
  ],

  // Crate on top lane near the right before the exits
  crates: [
    new Crate(w - PILLAR_W - 120, TOP_Y - 26),
  ],

  // Rats: one on top lane, one on bottom floor
  rats: [
    new Rat(w/2 + 60, TOP_Y - 16, w/2 + 20, w - PILLAR_W - 40, 1.1),
    new Rat(w/2 - 80, FLOOR_Y - 16, w/2 - 120, w/2 + 80, 1.0),
  ],
};

// Gates opened by plates (small blockers on each lane)
const topGate = new Door(w/2 + 10, TOP_Y - 30, 18, 30, '#5f7700', [level.plates[0]]);
const midGate = new Door(w/2 - 30, MID_Y - 30, 18, 30, '#5f7700', [level.plates[1]]);
level.doors.push(topGate, midGate);

// Rising water
const risingWater = new RisingWater(0.05);

// ---------------------------
// Players
// ---------------------------
const fireboy = new Player({
  x: level.spawns.fireboy.x, y: level.spawns.fireboy.y,
  color: 'red',
  controls: { left: 'arrowleft', right: 'arrowright', jump: 'arrowup' },
  immune: { fire: true, water: false }
});
const watergirl = new Player({
  x: level.spawns.watergirl.x, y: level.spawns.watergirl.y,
  color: 'blue',
  controls: { left: 'a', right: 'd', jump: 'w' },
  immune: { fire: false, water: true }
});

// ---------------------------
// Chain (Tether) Config
// ---------------------------
const CHAIN = {
  maxLength: 160,
  stiffness: 0.5,
  allowSnapDeath: false,
};

// ---------------------------
// Game State
// ---------------------------
let deaths = 0;
let levelTime = 0;
let running = false; // start only after popups

// ---------------------------
// Controls & Physics
// ---------------------------
function applyControls(p, dt) {
  const {left,right,jump} = p.controls;

  // Horizontal input with accel/decel
  const moveDir = (keys[left] ? -1 : 0) + (keys[right] ? 1 : 0);
  if (moveDir !== 0) {
    p.dx += moveDir * p.accel;
    p.dx = clamp(p.dx, -p.speed, p.speed);
  } else {
    if (Math.abs(p.dx) < p.decel) p.dx = 0;
    else p.dx -= Math.sign(p.dx) * p.decel;
  }

  // Update timers
  p.coyote = p.onGround ? p.coyoteMax : Math.max(0, p.coyote - dt);
  p.buffer = (keys[jump] && !p.jumpHeld) ? p.bufferMax : Math.max(0, p.buffer - dt);
  p.jumpHeld = keys[jump];

  // Jump if buffered & coyote available
  if (p.buffer > 0 && p.coyote > 0) {
    p.dy = p.jumpPower;
    p.onGround = false;
    p.coyote = 0;
    p.buffer = 0;
  }

  // Variable jump height
  if (!keys[jump] && p.dy < 0) p.dy *= 0.9;
}

// integrate player with world + crate
function integratePlayer(p, dt) {
  // gravity
  p.dy += level.gravity;
  p.dy = clamp(p.dy, -999, p.maxFall);

  // horizontal
  p.x += p.dx;

  // collide X with platforms and doors
  for (const pf of level.platforms) if (aabb(p.rect(), pf)) {
    if (p.dx > 0) p.x = pf.x - p.w;
    else if (p.dx < 0) p.x = pf.x + pf.w;
    p.dx = 0;
  }
  for (const d of level.doors) if (d.isSolid() && aabb(p.rect(), d)) {
    if (p.dx > 0) p.x = d.x - p.w;
    else if (p.dx < 0) p.x = d.x + d.w;
    p.dx = 0;
  }

  // interact with crate horizontally (push)
  for (const crate of level.crates) {
    if (aabb(p.rect(), crate)) {
      if (p.dx > 0) {
        const oldX = crate.x;
        crate.x += p.dx * 0.9;
        if (crateCollidesWorld(crate)) {
          crate.x = oldX;
          p.x = crate.x - p.w;
          p.dx = 0;
        } else {
          crate.dx += p.dx * 0.5;
          p.x = crate.x - p.w;
        }
      } else if (p.dx < 0) {
        const oldX = crate.x;
        crate.x += p.dx * 0.9;
        if (crateCollidesWorld(crate)) {
          crate.x = oldX;
          p.x = crate.x + crate.w;
          p.dx = 0;
        } else {
          crate.dx += p.dx * 0.5;
          p.x = crate.x + crate.w;
        }
      } else {
        if (p.center().cx < crate.x + crate.w/2) p.x = crate.x - p.w;
        else p.x = crate.x + crate.w;
      }
    }
  }

  // vertical
  p.y += p.dy;
  p.onGround = false;

  // collide Y with platforms and doors
  for (const pf of level.platforms) if (aabb(p.rect(), pf)) {
    if (p.dy > 0) { p.y = pf.y - p.h; p.dy = 0; p.onGround = true; }
    else if (p.dy < 0) { p.y = pf.y + pf.h; p.dy = 0; }
  }
  for (const d of level.doors) if (d.isSolid() && aabb(p.rect(), d)) {
    if (p.dy > 0) { p.y = d.y - p.h; p.dy = 0; p.onGround = true; }
    else if (p.dy < 0) { p.y = d.y + d.h; p.dy = 0; }
  }

  // collide with crate vertically (stand on / bonk under)
  for (const crate of level.crates) {
    if (aabb(p.rect(), crate)) {
      if (p.dy > 0 && p.y + p.h - crate.y <= 16) {
        p.y = crate.y - p.h; p.dy = 0; p.onGround = true;
      } else if (p.dy < 0 && crate.y + crate.h - p.y <= 16) {
        p.y = crate.y + crate.h; p.dy = 0;
      } else {
        if (p.center().cx < crate.x + crate.w/2) p.x = crate.x - p.w;
        else p.x = crate.x + crate.w;
        p.dx = 0;
      }
    }
  }

  // fell off world
  if (p.y > level.height + 200) kill(p);
}

// crate world collision helpers
function crateCollidesWorld(c) {
  for (const pf of level.platforms) if (aabb(c, pf)) return true;
  for (const d of level.doors) if (d.isSolid() && aabb(c, d)) return true;
  if (c.x < 0 || c.x + c.w > level.width) return true;
  return false;
}

function updateCrate(crate) {
  crate.dy += crate.gravity;
  crate.dy = clamp(crate.dy, -999, crate.maxFall);

  crate.dx *= 0.92;
  if (Math.abs(crate.dx) < 0.02) crate.dx = 0;

  // move X
  crate.x += crate.dx;
  for (const pf of level.platforms) if (aabb(crate, pf)) {
    if (crate.dx > 0) crate.x = pf.x - crate.w;
    else if (crate.dx < 0) crate.x = pf.x + pf.w;
    crate.dx = 0;
  }
  for (const d of level.doors) if (d.isSolid() && aabb(crate, d)) {
    if (crate.dx > 0) crate.x = d.x - crate.w;
    else if (crate.dx < 0) crate.x = d.x + d.w;
    crate.dx = 0;
  }
  if (crate.x < 0) { crate.x = 0; crate.dx = 0; }
  if (crate.x + crate.w > level.width) { crate.x = level.width - crate.w; crate.dx = 0; }

  // move Y
  crate.y += crate.dy;
  crate.onGround = false;

  for (const pf of level.platforms) if (aabb(crate, pf)) {
    if (crate.dy > 0) { crate.y = pf.y - crate.h; crate.dy = 0; crate.onGround = true; }
    else if (crate.dy < 0) { crate.y = pf.y + pf.h; crate.dy = 0; }
  }
  for (const d of level.doors) if (d.isSolid() && aabb(crate, d)) {
    if (crate.dy > 0) { crate.y = d.y - crate.h; crate.dy = 0; crate.onGround = true; }
    else if (crate.dy < 0) { crate.y = d.y + d.h; crate.dy = 0; }
  }
}

// ---------------------------
// Tether mechanics
// ---------------------------
function currentChainLength() {
  const c1 = fireboy.center(), c2 = watergirl.center();
  const dx = c2.cx - c1.cx, dy = c2.cy - c1.cy;
  return Math.hypot(dx, dy);
}
function applyChainConstraint(p1, p2) {
  const c1 = p1.center(), c2 = p2.center();
  let dx = c2.cx - c1.cx, dy = c2.cy - c1.cy;
  let dist = Math.hypot(dx, dy);
  if (dist === 0 || dist <= CHAIN.maxLength) return;

  if (CHAIN.allowSnapDeath) { kill(p1); kill(p2); return; }

  const excess = dist - CHAIN.maxLength;
  const nx = dx / dist, ny = dy / dist;
  const adjust = excess * CHAIN.stiffness;

  // Move both symmetrically
  p1.x += nx * adjust * 0.5; p1.y += ny * adjust * 0.5;
  p2.x -= nx * adjust * 0.5; p2.y -= ny * adjust * 0.5;

  resolveGround(p1);
  resolveGround(p2);
}
function resolveGround(p) {
  p.onGround = false;
  for (const pf of level.platforms) if (aabb(p.rect(), pf)) {
    if (p.dy >= 0 && p.y + p.h > pf.y && p.y < pf.y) {
      p.y = pf.y - p.h; p.dy = 0; p.onGround = true;
    }
  }
  for (const d of level.doors) if (aabb(p.rect(), d) && d.isSolid()) {
    if (p.dy >= 0 && p.y + p.h > d.y && p.y < d.y) {
      p.y = d.y - p.h; p.dy = 0; p.onGround = true;
    }
  }
}

// ---------------------------
// Hazards, Gems & Goals
// ---------------------------
function checkHazards(p) {
  // rats
  for (const r of level.rats) if (aabb(p.rect(), r.rect())) { kill(p); return; }
  // rising water
  if (risingWater.collides(p)) kill(p);
  // other hazards if you add later
}

function checkGems(p) {
  for (const gem of level.gems) {
    if (!gem.collected && aabb(p.rect(), gem)) {
      if ((gem.color==='red' && p.color==='red') ||
          (gem.color==='blue' && p.color==='blue')) {
        gem.collected = true;
        p.collected++;
      }
    }
  }
}

function allColorGemsCollected() {
  return level.gems.every(g => g.collected);
}

function updatePlates() {
  for (const pl of level.plates) {
    pl.active =
      (aabb(fireboy.rect(), pl) && fireboy.y+fireboy.h <= pl.y+pl.h+2) ||
      (aabb(watergirl.rect(), pl) && watergirl.y+watergirl.h <= pl.y+pl.h+2) ||
      level.crates.some(c => aabb(c, pl)); // crate can press
  }
}
function updateDoors() { for (const d of level.doors) d.update(); }

function kill(_p) {
  deaths++; HUD.deaths.textContent = deaths;
  fireboy.reset(); watergirl.reset();
  levelTime = 0;
  risingWater.level = canvas.height;
  resetDynamicLevelObjects();
  resetRats();
}

function resetDynamicLevelObjects() {
  // Reset crate
  level.crates = [ new Crate(w - PILLAR_W - 120, TOP_Y - 26) ];
  // Reset gems
  level.gems.forEach(g => g.collected = false);
  fireboy.collected = 0; watergirl.collected = 0;
}

function resetRats() {
  level.rats = [
    new Rat(w/2 + 60, TOP_Y - 16, w/2 + 20, w - PILLAR_W - 40, 1.1),
    new Rat(w/2 - 80, FLOOR_Y - 16, w/2 - 120, w/2 + 80, 1.0),
  ];
}

function bothAtExits() {
  const redExit = level.exits.find(e => e.forColor==='red');
  const blueExit = level.exits.find(e => e.forColor==='blue');
  return aabb(fireboy.rect(), redExit) && aabb(watergirl.rect(), blueExit);
}

// ---------------------------
// Render
// ---------------------------
function drawChain() {
  const f = fireboy.center(), w2 = watergirl.center();
  const dist = Math.min(currentChainLength(), CHAIN.maxLength);
  const t = dist / CHAIN.maxLength; // 0..1
  const color = t < 0.66 ? '#d1d5db' : (t < 0.9 ? '#f59e0b' : '#ef4444');

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(f.cx, f.cy);
  ctx.lineTo(w2.cx, w2.cy);
  ctx.stroke();
}

function draw() {
  // bg
  ctx.fillStyle = '#121a0f';
  ctx.fillRect(0,0,w,h);

  // world
  level.platforms.forEach(p=>p.draw());
  level.plates.forEach(p=>p.draw());
  level.doors.forEach(d=>d.draw());
  level.exits.forEach(e=>e.draw());

  // gems
  level.gems.forEach(g => g.draw());

  // crate
  level.crates.forEach(c => c.draw());

  // rats
  level.rats.forEach(r => r.draw());

  // chain
  drawChain();

  // players
  ctx.fillStyle = '#ef4444'; ctx.fillRect(fireboy.x, fireboy.y, fireboy.w, fireboy.h);
  ctx.fillStyle = '#14b8ff'; ctx.fillRect(watergirl.x, watergirl.y, watergirl.w, watergirl.h);

  // rising water (on top so it covers)
  risingWater.draw();

  // HUD gems
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '12px sans-serif';
  ctx.fillText(`🔴 ${fireboy.collected} | 🔵 ${watergirl.collected}  (Total: ${level.gems.filter(g=>g.collected).length}/${level.gems.length})`, 10, 16);
}

// ---------------------------
// Game Loop
// ---------------------------
let last = performance.now();
function tick(ts) {
  const dt = (ts-last)/1000; last=ts;
  if (running) levelTime += dt;
  HUD.level.textContent = level.id;
  HUD.time.textContent = levelTime.toFixed(1)+'s';

  if (running) {
    applyControls(fireboy, dt); applyControls(watergirl, dt);
    integratePlayer(fireboy, dt); integratePlayer(watergirl, dt);

    // crate physics after possible push
    level.crates.forEach(updateCrate);

    // tether after integrating both
    applyChainConstraint(fireboy, watergirl);

    // interactions
    checkGems(fireboy); checkGems(watergirl);
    checkHazards(fireboy); checkHazards(watergirl);
    updatePlates(); updateDoors();

    // rat patrols
    level.rats.forEach(r => r.update());

    // water
    risingWater.update();
  }

  HUD.chain.textContent = `${Math.round(currentChainLength())} / ${CHAIN.maxLength}`;
  draw();

  if (bothAtExits()) {
    running=false;
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#f8fafc'; ctx.font='bold 28px sans-serif';
    const bonus = allColorGemsCollected() ? ' + Gem Master!' : '';
    ctx.fillText('Level Complete!' + bonus, w/2-140, h/2);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------------------------
// UI (Reset / Pause)
// ---------------------------
document.getElementById('btnReset').addEventListener('click', ()=>{
  fireboy.reset(); watergirl.reset(); levelTime=0; running=true;
  risingWater.level = canvas.height;
  resetDynamicLevelObjects();
  resetRats();
});
document.getElementById('btnPause').addEventListener('click', (e)=>{
  running=!running; e.currentTarget.textContent=running?'Pause':'Resume';
});
