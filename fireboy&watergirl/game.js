// ---------------------------
// Setup
// ---------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const HUD = {
  level: document.getElementById('hudLevel'),
  time: document.getElementById('hudTime'),
  deaths: document.getElementById('hudDeaths'),
  chain: document.getElementById('hudChain'),
};

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

    // QoL for platforming
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
  draw() { ctx.fillStyle = '#3f3f46'; ctx.fillRect(this.x,this.y,this.w,this.h); }
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
  draw() { ctx.fillStyle = this.active ? '#f59e0b' : '#a3a3a3'; ctx.fillRect(this.x,this.y,this.w,this.h); }
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
  constructor(speed, color='#14532d') {
    this.level = canvas.height; // starts below screen
    this.speed = speed; // pixels per frame
    this.color = color;
  }
  update() { if (running) this.level = Math.max(0, this.level - this.speed); }
  draw() {
    ctx.fillStyle = this.color;
    ctx.fillRect(0, this.level, canvas.width, canvas.height - this.level);
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
    ctx.fillStyle = this.color==='red' ? '#ef4444' : '#3b82f6';
    ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
    ctx.restore();

    // subtle outline
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
    ctx.fillStyle = '#8b5cf6'; // violet-ish box
    ctx.fillRect(this.x, this.y, this.w, this.h);
    ctx.strokeStyle = '#a78bfa';
    ctx.strokeRect(this.x+1, this.y+1, this.w-2, this.h-2);
  }
}

// ---------------------------
// Level Definition
// ---------------------------
const level = {
  id: '1-1',
  width: canvas.width,
  height: canvas.height,
  gravity: 0.48,
  platforms: [
    // Floor
    new Platform(0, 520, 960, 40),

    // Ascent with staggered jumps and a side puzzle
    new Platform(120, 460, 160, 18),
    new Platform(360, 410, 160, 18),
    new Platform(600, 360, 160, 18),

    // Plate ledge (activates mid-gate)
    new Platform(340, 340, 120, 16),

    // Upper path after gate
    new Platform(520, 280, 120, 16),
    new Platform(680, 220, 120, 16),

    // Top ledge for exits (doors at the top next to each other)
    new Platform(720, 170, 200, 16),
  ],
  hazards: [],
  plates: [ new Plate(360, 324, 40, 16) ],
  doors: [],
  exits: [
    new Exit(820, 126, 40, 44, 'red'),
    new Exit(865, 126, 40, 44, 'blue'),
  ],
  spawns: { fireboy: {x: 80, y: 476}, watergirl: {x: 130, y: 476} },
  gems: [
    new Gem(170, 430, 'red'),
    new Gem(430, 382, 'blue'),
    new Gem(735, 195, 'red'),
    new Gem(885, 195, 'blue'),
  ],
  crates: [
    new Crate(300, 494),
  ]
};

// Gate that blocks the route until the plate is pressed
const puzzleDoor = new Door(500, 300, 40, 60, '#f97316', [level.plates[0]]);
level.doors.push(puzzleDoor);

// Rising water instance (slow, tense climb)
const risingWater = new RisingWater(0.25, '#14532d');

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
let running = true;
let last = performance.now();

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
      // Determine from which side player is pushing
      if (p.dx > 0) {
        // try pushing crate to the right
        const oldX = crate.x;
        crate.x += p.dx * 0.9;
        // If crate hits world, revert and block player
        if (crateCollidesWorld(crate)) {
          crate.x = oldX;
          p.x = crate.x - p.w; // block player
          p.dx = 0;
        } else {
          crate.dx += p.dx * 0.5;
          p.x = crate.x - p.w; // keep player snug
        }
      } else if (p.dx < 0) {
        const oldX = crate.x;
        crate.x += p.dx * 0.9;
        if (crateCollidesWorld(crate)) {
          crate.x = oldX;
          p.x = crate.x + crate.w; // block player
          p.dx = 0;
        } else {
          crate.dx += p.dx * 0.5;
          p.x = crate.x + crate.w;
        }
      } else {
        // no horizontal input: separate minimally to closest side
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
        // landing on crate
        p.y = crate.y - p.h; p.dy = 0; p.onGround = true;
      } else if (p.dy < 0 && crate.y + crate.h - p.y <= 16) {
        // bonk head on crate bottom
        p.y = crate.y + crate.h; p.dy = 0;
      } else {
        // side overlap fallback
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
  // platforms
  for (const pf of level.platforms) if (aabb(c, pf)) return true;
  // solid doors
  for (const d of level.doors) if (d.isSolid() && aabb(c, d)) return true;
  // bounds
  if (c.x < 0 || c.x + c.w > level.width) return true;
  return false;
}

function updateCrate(crate) {
  // gravity
  crate.dy += crate.gravity;
  crate.dy = clamp(crate.dy, -999, crate.maxFall);

  // horizontal friction
  crate.dx *= 0.92;
  if (Math.abs(crate.dx) < 0.02) crate.dx = 0;

  // move X
  crate.x += crate.dx;
  // collide X with world
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

  // collide Y with world
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
  for (const d of level.doors) if (d.isSolid() && aabb(p.rect(), d)) {
    if (p.dy >= 0 && p.y + p.h > d.y && p.y < d.y) {
      p.y = d.y - p.h; p.dy = 0; p.onGround = true;
    }
  }
}

// ---------------------------
// Hazards, Gems & Goals
// ---------------------------
function checkHazards(p) {
  if (risingWater.collides(p)) kill(p);
  for (const hz of level.hazards) if (aabb(p.rect(), hz)) {
    const bad = (hz.type==='fire' && !p.immune.fire) ||
                (hz.type==='water' && !p.immune.water) ||
                hz.type==='poison';
    if (bad) kill(p);
  }
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
  // Both players must collect their own-color gems (optional: enforce all)
  // Here we just check if every gem is collected for level completion bonus, but
  // we still allow finishing without them.
  return level.gems.every(g => g.collected);
}

function updatePlates() {
  for (const pl of level.plates) {
    pl.active =
      (aabb(fireboy.rect(), pl) && fireboy.y+fireboy.h <= pl.y+pl.h+2) ||
      (aabb(watergirl.rect(), pl) && watergirl.y+watergirl.h <= pl.y+pl.h+2);
  }
}
function updateDoors() { for (const d of level.doors) d.update(); }

function kill(_p) {
  deaths++; HUD.deaths.textContent = deaths;
  fireboy.reset(); watergirl.reset();
  levelTime = 0;
  risingWater.level = canvas.height;
  // reset crate & gems
  resetDynamicLevelObjects();
}

function resetDynamicLevelObjects() {
  // Reset crate(s)
  level.crates = [ new Crate(300, 494) ];
  // Reset gems
  level.gems.forEach(g => g.collected = false);
  fireboy.collected = 0; watergirl.collected = 0;
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
  const f = fireboy.center(), w = watergirl.center();
  const dist = Math.min(currentChainLength(), CHAIN.maxLength);
  const t = dist / CHAIN.maxLength; // 0..1
  const color = t < 0.66 ? '#d1d5db' : (t < 0.9 ? '#f59e0b' : '#ef4444');

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(f.cx, f.cy);
  ctx.lineTo(w.cx, w.cy);
  ctx.stroke();
}

function draw() {
  // background
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // world
  level.platforms.forEach(p=>p.draw());
  level.hazards.forEach(h=>h.draw());
  level.plates.forEach(p=>p.draw());
  level.doors.forEach(d=>d.draw());
  level.exits.forEach(e=>e.draw());

  // gems
  level.gems.forEach(g => g.draw());

  // crate(s)
  level.crates.forEach(c => c.draw());

  // chain
  drawChain();

  // players
  ctx.fillStyle = '#ef4444'; ctx.fillRect(fireboy.x, fireboy.y, fireboy.w, fireboy.h);
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(watergirl.x, watergirl.y, watergirl.w, watergirl.h);

  // rising water (draw after players so it visually covers them when submerged)
  risingWater.draw();

  // gem HUD overlay
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '12px sans-serif';
  ctx.fillText(`🔴 ${fireboy.collected} | 🔵 ${watergirl.collected}  (Total: ${level.gems.filter(g=>g.collected).length}/${level.gems.length})`, 10, 16);
}

// ---------------------------
// Game Loop
// ---------------------------
function tick(ts) {
  const dt = (ts-last)/1000; last=ts;
  if (running) levelTime += dt;
  HUD.level.textContent = level.id;
  HUD.time.textContent = levelTime.toFixed(1)+'s';

  if (running) {
    applyControls(fireboy, dt); applyControls(watergirl, dt);
    integratePlayer(fireboy, dt); integratePlayer(watergirl, dt);

    // After players have potentially shoved the crate, update crate physics
    level.crates.forEach(updateCrate);

    // Tether after integrating both
    applyChainConstraint(fireboy, watergirl);

    // Interactions
    checkGems(fireboy); checkGems(watergirl);
    checkHazards(fireboy); checkHazards(watergirl);
    updatePlates(); updateDoors();

    risingWater.update();
  }

  HUD.chain.textContent = `${Math.round(currentChainLength())} / ${CHAIN.maxLength}`;
  draw();

  if (bothAtExits()) {
    running=false;
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#f8fafc'; ctx.font='bold 28px sans-serif';
    const bonus = allColorGemsCollected() ? ' + Gem Master!' : '';
    ctx.fillText('Level Complete!' + bonus, canvas.width/2-140, canvas.height/2);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------------------------
// UI
// ---------------------------
document.getElementById('btnReset').addEventListener('click', ()=>{
  fireboy.reset(); watergirl.reset(); levelTime=0; running=true;
  risingWater.level = canvas.height;
  resetDynamicLevelObjects();
});
document.getElementById('btnPause').addEventListener('click', (e)=>{
  running=!running; e.currentTarget.textContent=running?'Pause':'Resume';
});
