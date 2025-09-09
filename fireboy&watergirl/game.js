// ---------------------------
// Setup (Uniform game box + Popups flow)
// ---------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const gameBox = document.getElementById('gameBox');
const deathPopup   = document.getElementById('deathPopup');

// Rat sprite (URL-encode the "&" as %26)
const ratImg = new Image();
ratImg.src = './assets/rat.png';
ratImg.onload  = () => console.log('rat.png loaded');
ratImg.onerror = (e) => console.warn('Failed to load rat.png at', ratImg.src, e);

// Sprites
const bgImg        = new Image(); bgImg.src = './assets/background.png';
const redPlayerImg = new Image(); redPlayerImg.src = './assets/Tagalog_Girl.gif';
const bluePlayerImg= new Image(); bluePlayerImg.src = './assets/Bisaya_Boy.gif';
const blueWaterImg = new Image(); blueWaterImg.src = './assets/blue_water.png';
const redWaterImg  = new Image(); redWaterImg.src = './assets/red_water.png';
const floorImg     = new Image(); floorImg.src = './assets/concrete.png';

// ---------------------------
// Background Music
// ---------------------------
const bgMusic = new Audio("assets/bg_music.mp3"); // place your music file in the same folder
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

// HUD references (top bar)
const HUD = {
  level: document.getElementById('hudLevel'),
  time: document.getElementById('hudTime'),
  deaths: document.getElementById('hudDeaths'),
};

// Start flow popups
const startScreen   = document.getElementById('startScreen');
const controlsPopup = document.getElementById('controlsPopup');
const goalPopup     = document.getElementById('goalPopup');

// Safe key handling (avoid page scroll)
const keys = {};
addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (['arrowup','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
}, { passive: false });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// Canvas size to the game box
function sizeCanvas() {
  const rect = gameBox?.getBoundingClientRect?.();
  if (rect) {
    canvas.width  = Math.max(320, Math.floor(rect.width));
    canvas.height = Math.max(180, Math.floor(rect.height));
  } else {
    // Fallback in case markup changes
    const HUD_HEIGHT = 48;
    canvas.width = window.innerWidth;
    canvas.height = Math.max(240, window.innerHeight - HUD_HEIGHT);
  }
}
sizeCanvas();
window.addEventListener('resize', () => {
  sizeCanvas();
  rebuildLevel(); // rebuild layout on resize for responsive uniformity
});

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
    this.x = x; this.y = y; this.w = 44; this.h = 56;
    this.dx = 0; this.dy = 0;

    // Movement tuning
    this.speed = 2.6;
    this.accel = 0.6;
    this.decel = 0.7;
    this.jumpPower = -15;
    this.maxFall = 11;
    this.gravity = 0.48;
    this.facing = 'right';

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
  constructor(x, y, w, h, colorTag = null) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.colorTag = colorTag; // 'red', 'blue', or null
  }
  draw() {
    // Red/Blue special blocks (keep your sprite logic)
    if (this.colorTag === 'red' && redWaterImg.complete) {
      ctx.drawImage(redWaterImg, this.x, this.y, this.w, this.h);
      return;
    }
    if (this.colorTag === 'blue' && blueWaterImg.complete) {
      ctx.drawImage(blueWaterImg, this.x, this.y, this.w, this.h);
      return;
    }

    // Floor / default platforms: use a repeating tile
    if (floorImg.complete) {
      // Option A: native pattern (simple + fast)
      const pattern = ctx.createPattern(floorImg, 'repeat');
      if (pattern && pattern.setTransform) {
        // Keep the pattern anchored to (0,0) in world space so it doesn't “swim”
        // by translating the pattern so it starts at this platform's origin.
        pattern.setTransform(new DOMMatrix().translateSelf(this.x, this.y));
      }

      const prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;  // crisper pixels for small tiles

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = pattern || '#7b9704';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();

      ctx.imageSmoothingEnabled = prevSmooth;
    } else {
      // Fallback color while the image loads
      ctx.fillStyle = '#7b9704';
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
  }
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
  if (ratImg && ratImg.complete && ratImg.naturalWidth > 0) {
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false; // crisp pixel look

    ctx.save();
    // Sprite points LEFT by default:
    // moving RIGHT → flip; moving LEFT → draw normally
    if (this.vx > 0) {
      ctx.translate(this.x + this.w, this.y);
      ctx.scale(-1, 1);
      ctx.drawImage(ratImg, 0, 0, this.w, this.h);
    } else {
      ctx.drawImage(ratImg, this.x, this.y, this.w, this.h);
    }
    ctx.restore();

    ctx.imageSmoothingEnabled = prevSmooth;
  } else {
    // Fallback box + “eye”
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.fillStyle = '#f87171';
    // eye on the *facing* side (right when moving right, left when moving left)
    ctx.fillRect(this.x + (this.vx > 0 ? this.w - 6 : 2), this.y + 4, 4, 4);
  }
}
}

// ---------------------------
// Level Definition (relative to canvas for uniformity)
// ---------------------------
let level; // will be (re)built based on canvas size

function buildLevel() {
  const w = canvas.width;
  const h = canvas.height;

  // y positions for lanes (relative)
  const TOP_Y   = Math.floor(h * 0.30);
  const MID_Y   = Math.floor(h * 0.60);
  const FLOOR_H = Math.floor(h * 0.08);
  const FLOOR_Y = h - FLOOR_H;

  // right vertical pillar that connects up to exits
  const PILLAR_W = Math.floor(w * 0.12);
  const pillar = new Platform(w - PILLAR_W, h - Math.floor(h * 0.30), PILLAR_W, Math.floor(h * 0.28));

  level = {
    id: '1-1',
    width: w,
    height: h,
    gravity: 0.48,
    platforms: [
      // Bottom solid block (floor)
      new Platform(0, FLOOR_Y, w, FLOOR_H),

      // Middle long platform
      new Platform(0, MID_Y, Math.floor(w * 0.80), Math.floor(h * 0.075)),

      // Colored mid blocks (red/blue)
      new Platform(Math.floor(w*0.30), MID_Y - Math.floor(h*0.010), Math.floor(w*0.05), Math.floor(h*0.028), 'red'),
      new Platform(Math.floor(w*0.56), MID_Y - Math.floor(h*0.010), Math.floor(w*0.05), Math.floor(h*0.028), 'blue'),

      // Top long platform (leave gap on far right for pillar/exit)
      new Platform(Math.floor(w*0.06), TOP_Y, w - PILLAR_W - Math.floor(w*0.05), Math.floor(h * 0.028)),

      // Right vertical pillar rising up (to top/exit)
      pillar,

      // Tiny step just under the exits (visual)
      new Platform(w - Math.floor(w * 0.14), TOP_Y - Math.floor(h * 0.045), Math.floor(w * 0.14), Math.floor(h * 0.045)),
    ],
    hazards: [],

    // Pressure plates
    plates: [
      new Plate(Math.floor(w*0.12), TOP_Y - 6, Math.floor(w*0.05), 6),
      new Plate(Math.floor(w*0.17), MID_Y - 6, Math.floor(w*0.05), 6),
    ],
    doors: [],
    // Exits
    exits: [
      new Exit(w - PILLAR_W, TOP_Y - Math.floor(h*0.03), 40, 44, 'red'),
      new Exit(w - Math.floor(PILLAR_W*0.6), TOP_Y - Math.floor(h*0.03), 40, 44, 'blue'),
    ],
    // Spawns
    spawns: { fireboy: {x: Math.floor(w*0.05), y: FLOOR_Y - 55}, watergirl: {x: Math.floor(w*0.10), y: FLOOR_Y - 55} },

    // Gems
    gems: [
      new Gem(Math.floor(w*0.14), TOP_Y - 40, 'blue'),
      new Gem(Math.floor(w*0.50), TOP_Y - 60, 'red'),
      new Gem(Math.floor(w*0.52), MID_Y - 60, 'blue'),
      new Gem(Math.floor(w*0.24), MID_Y - 50, 'red'),
      new Gem(Math.floor(w*0.68), h - FLOOR_H - 70, 'blue'),
      new Gem(Math.floor(w*0.71), h - FLOOR_H - 70, 'red'),
    ],

    // Crates: top lane + bottom-right
    crates: [
      new Crate(Math.floor(w*0.66), FLOOR_Y - 26),
    ],

    // Rats
    rats: [
      new Rat(Math.floor(w*0.55), TOP_Y - 16, Math.floor(w*0.52), w - PILLAR_W - Math.floor(w*0.05), 1.1),
      new Rat(Math.floor(w*0.40), FLOOR_Y - 16, Math.floor(w*0.36), Math.floor(w*0.52), 1.0),
    ],

    constants: { TOP_Y, MID_Y, FLOOR_Y, FLOOR_H, PILLAR_W },
  };

}

buildLevel();

// Rising water
const risingWater = new RisingWater(0.05);

// ---------------------------
// Players (no tether)
// ---------------------------
let fireboy = new Player({
  x: level.spawns.fireboy.x, y: level.spawns.fireboy.y,
  color: 'red',
  controls: { left: 'arrowleft', right: 'arrowright', jump: 'arrowup' },
  immune: { fire: true, water: false }
});
let watergirl = new Player({
  x: level.spawns.watergirl.x, y: level.spawns.watergirl.y,
  color: 'blue',
  controls: { left: 'a', right: 'd', jump: 'w' },
  immune: { fire: false, water: true }
});

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

  if (keys[left] && !keys[right]) p.facing = 'left';
  else if (keys[right] && !keys[left]) p.facing = 'right';
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

  // collide X with platforms (color rules) and doors
  for (const pf of level.platforms) {
    if (!aabb(p.rect(), pf)) continue;

    if (pf.colorTag) {
      // death if wrong color touches
      if (p.color === 'red' && pf.colorTag === 'blue') { kill(p); return; }
      if (p.color === 'blue' && pf.colorTag === 'red') { kill(p); return; }
      // same color = pass-through
      if (pf.colorTag === p.color) continue;
    }

    // normal collision
    if (p.dx > 0) p.x = pf.x - p.w;
    else if (p.dx < 0) p.x = pf.x + pf.w;
    p.dx = 0;
  }

  // collide X with doors
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

  // world X bounds
  if (p.x < 0) { p.x = 0; p.dx = 0; }
  if (p.x + p.w > level.width) { p.x = level.width - p.w; p.dx = 0; }

  // vertical
  p.y += p.dy;
  p.onGround = false;

  // collide Y with platforms (color rules) and doors
  for (const pf of level.platforms) {
    if (!aabb(p.rect(), pf)) continue;

    if (pf.colorTag) {
      // death if wrong color touches
      if (p.color === 'red' && pf.colorTag === 'blue') { kill(p); return; }
      if (p.color === 'blue' && pf.colorTag === 'red') { kill(p); return; }
      // same color = pass-through
      if (pf.colorTag === p.color) continue;
    }

    if (p.dy > 0) { p.y = pf.y - p.h; p.dy = 0; p.onGround = true; }
    else if (p.dy < 0) { p.y = pf.y + pf.h; p.dy = 0; }
  }

  // collide Y with doors
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

  // fell far below world (safety)
  if (p.y > level.height + 200) kill(p);
}

// crate world collision helpers
function crateCollidesWorld(c) {
  for (const pf of level.platforms) if (aabb(c, pf)) return true; // crates collide with all platforms
  for (const d of level.doors) if (d.isSolid() && aabb(c, d)) return true;
  if (c.x < 0 || c.x + c.w > level.width) return true;
  return false;
}

function updateCrate(crate) {
  crate.dy += 0.48;
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
// Hazards, Gems & Goals
// ---------------------------
function checkHazards(p) {
  for (const r of level.rats) if (aabb(p.rect(), r.rect())) { kill(p); return; }
  if (risingWater.collides(p)) kill(p);
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
function allColorGemsCollected() { return level.gems.every(g => g.collected); }

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
  running = false;
  deathPopup.style.display = 'flex';   // show restart popup
}

function resetDynamicLevelObjects() {
  const { TOP_Y, PILLAR_W, FLOOR_Y } = level.constants;

  // Reset crates (top lane + bottom-right)
  level.crates = [
    new Crate(level.width - PILLAR_W - Math.floor(level.width*0.09), TOP_Y - 26),
    new Crate(Math.floor(level.width*0.66), FLOOR_Y - 26),
  ];

  // Reset gems
  level.gems.forEach(g => g.collected = false);
  fireboy.collected = 0; watergirl.collected = 0;
}
function resetRats() {
  const { TOP_Y, FLOOR_Y, PILLAR_W } = level.constants;
  level.rats = [
    new Rat(Math.floor(level.width*0.55), TOP_Y - 16, Math.floor(level.width*0.52), level.width - PILLAR_W - Math.floor(level.width*0.05), 1.1),
    new Rat(Math.floor(level.width*0.40), FLOOR_Y - 16, Math.floor(level.width*0.36), Math.floor(level.width*0.52), 1.0),
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
function drawPlayer(p, img, fallbackColor) {
  const { x, y, w, h, facing } = p;

  if (img && img.complete) {
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false; // keep pixels crisp

    ctx.save();
    // Assume the GIF faces RIGHT by default.
    // Face left? Flip around the player's box.
    if (facing === 'left') {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.restore();

    ctx.imageSmoothingEnabled = prevSmooth;
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(x, y, w, h);
  }
}


function draw() {
  // bg
  if (bgImg.complete) {
    ctx.drawImage(bgImg, 0, 0, level.width, level.height);
  } else {
    ctx.fillStyle = '#121a0f';
    ctx.fillRect(0,0,level.width,level.height);
  }

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

  // players
  drawPlayer(fireboy,  redPlayerImg,  '#ef4444');
  drawPlayer(watergirl, bluePlayerImg, '#14b8ff');

  // rising water (on top so it covers)
  risingWater.draw();

  // HUD extra (gems)
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

    // interactions
    checkGems(fireboy); checkGems(watergirl);
    checkHazards(fireboy); checkHazards(watergirl);
    updatePlates(); updateDoors();

    // rat patrols
    level.rats.forEach(r => r.update());

    // water
    risingWater.update();
  }

  draw();

  if (bothAtExits()) {
    running=false;
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,level.width,level.height);
    ctx.fillStyle='#f8fafc'; ctx.font='bold 28px sans-serif';
    const bonus = allColorGemsCollected() ? ' + Gem Master!' : '';
    ctx.fillText('Level Complete!' + bonus, level.width/2-140, level.height/2);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------------------------
// UI (Start flow / Reset / Pause / Restart)
// ---------------------------
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

document.getElementById('btnReset').addEventListener('click', ()=>{
  fireboy.reset(); watergirl.reset(); levelTime=0; running=true;
  risingWater.level = canvas.height;
  resetDynamicLevelObjects();
  resetRats();
});
document.getElementById('btnPause').addEventListener('click', (e)=>{
  running=!running; e.currentTarget.textContent=running?'Pause':'Resume';
});
document.getElementById('btnRestart')?.addEventListener('click', () => {
  deathPopup.style.display = 'none';
  fireboy.reset();
  watergirl.reset();
  levelTime = 0;
  risingWater.level = canvas.height;
  resetDynamicLevelObjects();  // recreates the crates
  resetRats();
  running = true;
});
document.getElementById('btnDeathClose')?.addEventListener('click', () => {
  deathPopup.style.display = 'none';
  running = true; // resume if you want continuing after closing
});

// ---------------------------
// Rebuild level on resize
// ---------------------------
function rebuildLevel() {
  // Remember gem counts & deaths but reset dynamic state
  const wasRunning = running;
  running = false;

  // Rebuild layout
  buildLevel();

  // Recreate players at new spawns (no tether)
  fireboy = new Player({
    x: level.spawns.fireboy.x, y: level.spawns.fireboy.y,
    color: 'red',
    controls: { left: 'arrowleft', right: 'arrowright', jump: 'arrowup' },
    immune: { fire: true, water: false }
  });
  watergirl = new Player({
    x: level.spawns.watergirl.x, y: level.spawns.watergirl.y,
    color: 'blue',
    controls: { left: 'a', right: 'd', jump: 'w' },
    immune: { fire: false, water: true }
  });

  // Reset water & dynamic objects
  risingWater.level = canvas.height;
  resetDynamicLevelObjects();
  resetRats();

  running = wasRunning;
}
