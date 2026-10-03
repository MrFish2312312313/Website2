/* ==========================================================
   PIXEL JUMPER — a small retro platformer
   ========================================================== */
(function () {
  "use strict";

  const T = 16;                       // tile size
  const VW = 384, VH = 216;           // view size (canvas is CSS-scaled 2x)
  const canvas = document.getElementById("game");
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  const $ = (id) => document.getElementById(id);

  // physics (per 60Hz frame)
  const GRAVITY = 0.36;
  const MAX_FALL = 7;
  const ACCEL = 0.32;
  const AIR_ACCEL = 0.22;
  const FRICTION = 0.78;
  const MAX_RUN = 2.3;
  const JUMP_V = 6.3;
  const DOUBLE_JUMP_V = 5.6;
  const SPRING_V = 10;
  const COYOTE = 6;
  const BUFFER = 7;

  const SOLID = { "#": 1, B: 1 };

  const game = {
    state: "ready",     // ready | playing | paused | clear | dead | over | win
    levelIndex: 0,
    level: null,
    player: null,
    enemies: [],
    coins: [],
    springs: [],
    particles: [],
    cam: { x: 0, y: 0 },
    shake: 0,
    score: 0,
    coinCount: 0,
    lives: 3,
    frame: 0,
    timer: 0,
  };
  window.game = game;

  /* ---------- Level loading ---------- */
  function loadLevel(i) {
    const def = window.PJ_LEVELS[i];
    const width = Math.max(...def.rows.map((r) => r.length));
    const grid = def.rows.map((r) => r.padEnd(width, ".").split(""));
    const lvl = { def, grid, w: width, h: grid.length, flag: null, start: null };
    game.enemies = [];
    game.coins = [];
    game.springs = [];
    game.particles = [];

    for (let y = 0; y < lvl.h; y++) {
      for (let x = 0; x < lvl.w; x++) {
        const c = grid[y][x];
        if (c === "P") { lvl.start = { x: x * T + 3, y: y * T + 2 }; grid[y][x] = "."; }
        else if (c === "F") { lvl.flag = { x: x * T, y: y * T }; grid[y][x] = "."; }
        else if (c === "o") { game.coins.push({ x: x * T + 4, y: y * T + 3, taken: false, phase: x * 0.7 }); grid[y][x] = "."; }
        else if (c === "E") { game.enemies.push(makeSlime(x * T + 1, y * T + 6)); grid[y][x] = "."; }
        else if (c === "S") { game.springs.push({ x: x * T, y: y * T + 8, squish: 0 }); grid[y][x] = "."; }
      }
    }
    game.level = lvl;
    game.levelIndex = i;
    game.levelFrame = 0;
    spawnPlayer();
    $("world").textContent = "1-" + (i + 1);
    hud();
  }

  function makeSlime(x, y) {
    return { x, y, w: 14, h: 10, vx: -0.6, vy: 0, alive: true, squash: 0, anim: Math.random() * 10 };
  }

  function spawnPlayer() {
    const s = game.level.start;
    game.player = {
      x: s.x, y: s.y, w: 10, h: 14,
      vx: 0, vy: 0,
      onGround: false,
      coyote: 0, buffer: 0,
      canDouble: true,
      facing: 1,
      invuln: 60,
      runAnim: 0,
      squash: 1,
    };
    game.cam.x = clamp(s.x - VW / 2, 0, game.level.w * T - VW);
    game.cam.y = clamp(s.y - VH / 2, 0, game.level.h * T - VH);
  }

  /* ---------- Helpers ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function tileAt(tx, ty) {
    const L = game.level;
    if (tx < 0 || tx >= L.w) return "#";       // invisible side walls
    if (ty < 0 || ty >= L.h) return ".";
    return L.grid[ty][tx];
  }
  function solidAt(tx, ty) { return !!SOLID[tileAt(tx, ty)]; }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** Move an entity with tile collisions. Returns {hitX, hitY, landed}. */
  function moveBody(e, oneWay) {
    const res = { hitX: false, hitY: false, landed: false };

    // horizontal
    e.x += e.vx;
    const top = Math.floor(e.y / T), bot = Math.floor((e.y + e.h - 1) / T);
    if (e.vx > 0) {
      const tx = Math.floor((e.x + e.w) / T);
      for (let ty = top; ty <= bot; ty++) if (solidAt(tx, ty)) { e.x = tx * T - e.w; e.vx = 0; res.hitX = true; break; }
    } else if (e.vx < 0) {
      const tx = Math.floor(e.x / T);
      for (let ty = top; ty <= bot; ty++) if (solidAt(tx, ty)) { e.x = (tx + 1) * T; e.vx = 0; res.hitX = true; break; }
    }

    // vertical
    const prevBottom = e.y + e.h;
    e.y += e.vy;
    const left = Math.floor(e.x / T), right = Math.floor((e.x + e.w - 1) / T);
    if (e.vy > 0) {
      const ty = Math.floor((e.y + e.h) / T);
      for (let tx = left; tx <= right; tx++) {
        const t = tileAt(tx, ty);
        const plank = oneWay && t === "=" && prevBottom <= ty * T + 0.01;
        if (SOLID[t] || plank) { e.y = ty * T - e.h; e.vy = 0; res.hitY = true; res.landed = true; break; }
      }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / T);
      for (let tx = left; tx <= right; tx++) {
        if (solidAt(tx, ty)) { e.y = (ty + 1) * T; e.vy = 0; res.hitY = true; bump(tx, ty); break; }
      }
    }
    return res;
  }

  function bump(tx, ty) {
    if (tileAt(tx, ty) === "B") {
      dust(tx * T + 8, ty * T + T, "#ff8a00", 5);
    }
  }

  function dust(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      game.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 2.5,
        vy: -Math.random() * 2,
        life: 20 + Math.random() * 15,
        color: color || "#d8c8a8",
        size: Math.random() < 0.5 ? 1 : 2,
        grav: 0.1,
      });
    }
  }

  /* ---------- Input ---------- */
  const keys = { left: false, right: false, jump: false };
  let jumpPressed = false;
  const KEYMAP = {
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
    ArrowUp: "jump", w: "jump", W: "jump", " ": "jump", z: "jump", Z: "jump",
  };
  function press(k) {
    if (k === "jump" && !keys.jump) jumpPressed = true;
    keys[k] = true;
  }
  function release(k) { keys[k] = false; }

  addEventListener("keydown", (e) => {
    const k = KEYMAP[e.key];
    if (k) e.preventDefault();
    if (game.state !== "playing") {
      if (e.key === " " || e.key === "Enter") { primary(); return; }
      if ((e.key === "p" || e.key === "P" || e.key === "Escape") && game.state === "paused") togglePause();
      return;
    }
    if (e.key === "p" || e.key === "P" || e.key === "Escape") { togglePause(); return; }
    if (k && !e.repeat) press(k);
  });
  addEventListener("keyup", (e) => {
    const k = KEYMAP[e.key];
    if (k) release(k);
  });
  document.querySelectorAll(".touch [data-key]").forEach((b) => {
    const k = b.dataset.key;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); if (game.state !== "playing") primary(); else press(k); });
    b.addEventListener("pointerup", () => release(k));
    b.addEventListener("pointerleave", () => release(k));
  });
  $("ov-btn").addEventListener("click", () => { Retro.sfx("click"); primary(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game.state === "playing") togglePause();
  });

  /* ---------- Game flow ---------- */
  function newGame() {
    game.score = 0;
    game.coinCount = 0;
    game.lives = 3;
    loadLevel(0);
    play();
  }
  function play() {
    game.state = "playing";
    keys.left = keys.right = keys.jump = false;
    hideOverlay();
    Retro.sfx("start");
  }
  function primary() {
    if (game.state === "ready" || game.state === "over" || game.state === "win") newGame();
    else if (game.state === "paused") togglePause();
    else if (game.state === "clear") nextLevel();
  }
  function togglePause() {
    if (game.state === "playing") {
      game.state = "paused";
      showOverlay("PAUSED", "Catch your breath.", "RESUME");
    } else if (game.state === "paused") {
      game.state = "playing";
      hideOverlay();
    }
  }
  function nextLevel() {
    if (game.levelIndex + 1 < window.PJ_LEVELS.length) {
      loadLevel(game.levelIndex + 1);
      play();
    } else {
      game.state = "win";
      const rec = Retro.submitScore("platformer", game.score);
      Retro.sfx("win");
      showOverlay("YOU WIN!", (rec ? "NEW HIGH SCORE! " : "") + "Final score: " + game.score + " · Coins: " + game.coinCount, "PLAY AGAIN");
    }
  }
  function reachFlag() {
    game.state = "clear";
    game.timer = 0;
    game.score += 500;
    hud();
    Retro.sfx("win");
    for (let i = 0; i < 40; i++) {
      const colors = ["#ff2e88", "#00f0ff", "#ffe600", "#39ff14"];
      game.particles.push({
        x: game.level.flag.x + 8, y: game.level.flag.y - 20,
        vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 5 - 1,
        life: 60 + Math.random() * 30, color: colors[i % 4], size: 2, grav: 0.12,
      });
    }
    const last = game.levelIndex + 1 >= window.PJ_LEVELS.length;
    setTimeout(() => {
      if (game.state === "clear") showOverlay("LEVEL CLEAR!", "+500 bonus · Score: " + game.score, last ? "FINISH" : "NEXT LEVEL");
    }, 900);
  }
  function hurt() {
    const p = game.player;
    if (p.invuln > 0 || game.state !== "playing") return;
    game.state = "dead";
    game.timer = 0;
    game.shake = 10;
    p.vy = -5;
    p.vx = 0;
    Retro.sfx("hurt");
    dust(p.x + 5, p.y + 7, "#ff2e88", 16);
  }
  function afterDeath() {
    game.lives--;
    hud();
    if (game.lives <= 0) {
      game.state = "over";
      const rec = Retro.submitScore("platformer", game.score);
      Retro.sfx("over");
      showOverlay("GAME OVER", (rec ? "NEW HIGH SCORE! " : "") + "Score: " + game.score, "TRY AGAIN");
    } else {
      // reset the level layout but keep score progress
      const keepScore = game.score, keepCoins = game.coinCount;
      loadLevel(game.levelIndex);
      game.score = keepScore;
      game.coinCount = keepCoins;
      hud();
      game.state = "playing";
    }
  }

  /* ---------- Update ---------- */
  function update() {
    game.frame++;
    const p = game.player;

    if (game.state === "dead") {
      // death hop animation
      p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);
      p.y += p.vy;
      if (++game.timer > 70) afterDeath();
      updateParticles();
      return;
    }
    if (game.state === "clear") {
      p.vx *= 0.8;
      moveBody(p, true);
      p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);
      updateParticles();
      return;
    }
    if (game.state !== "playing") { updateParticles(); return; }
    game.levelFrame++;

    // --- horizontal input
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const acc = p.onGround ? ACCEL : AIR_ACCEL;
    if (dir) {
      p.vx = clamp(p.vx + dir * acc, -MAX_RUN, MAX_RUN);
      p.facing = dir;
    } else {
      p.vx *= p.onGround ? FRICTION : 0.94;
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
    }

    // --- jumping (coyote time + input buffer + double jump)
    if (jumpPressed) { p.buffer = BUFFER; jumpPressed = false; }
    if (p.buffer > 0) {
      if (p.onGround || p.coyote > 0) {
        p.vy = -JUMP_V;
        p.onGround = false;
        p.coyote = 0;
        p.buffer = 0;
        p.squash = 0.7;
        Retro.sfx("jump");
        dust(p.x + 5, p.y + p.h, null, 5);
      } else if (p.canDouble) {
        p.vy = -DOUBLE_JUMP_V;
        p.canDouble = false;
        p.buffer = 0;
        Retro.sfx("jump");
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          game.particles.push({ x: p.x + 5, y: p.y + p.h, vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 0.6, life: 18, color: "#00f0ff", size: 1, grav: 0 });
        }
      }
    }
    if (p.buffer > 0) p.buffer--;
    // variable jump height: releasing jump cuts the ascent (not for spring/stomp boosts)
    if (p.vy >= 0) p.boosted = false;
    if (!keys.jump && !p.boosted && p.vy < -2.5) p.vy = -2.5;

    p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);

    const wasGround = p.onGround;
    const res = moveBody(p, true);
    p.onGround = res.landed;
    if (p.onGround) {
      p.coyote = COYOTE;
      p.canDouble = true;
      if (!wasGround) { p.squash = 1.3; dust(p.x + 5, p.y + p.h, null, 4); }
    } else if (p.coyote > 0) p.coyote--;
    p.squash += (1 - p.squash) * 0.2;
    if (p.invuln > 0) p.invuln--;
    if (Math.abs(p.vx) > 0.3 && p.onGround) p.runAnim += Math.abs(p.vx) * 0.15;

    // --- hazards: spikes + falling out
    const cx0 = Math.floor((p.x + 2) / T), cx1 = Math.floor((p.x + p.w - 3) / T);
    const cy0 = Math.floor((p.y + 4) / T), cy1 = Math.floor((p.y + p.h - 1) / T);
    outer: for (let ty = cy0; ty <= cy1; ty++) {
      for (let tx = cx0; tx <= cx1; tx++) {
        if (tileAt(tx, ty) === "^" && p.y + p.h > ty * T + 7) { hurt(); break outer; }
      }
    }
    if (p.y > game.level.h * T + 40) { p.invuln = 0; hurt(); }

    // --- springs
    for (const s of game.springs) {
      if (s.squish > 0) s.squish--;
      if (p.vy >= 0 && overlap(p, { x: s.x + 2, y: s.y, w: 12, h: 8 }) && p.y + p.h - p.vy <= s.y + 4) {
        p.vy = -SPRING_V;
        p.boosted = true;
        p.y = s.y - p.h;
        p.canDouble = true;
        p.onGround = false;
        s.squish = 10;
        Retro.sfx("power");
      }
    }

    // --- coins
    for (const c of game.coins) {
      if (!c.taken && overlap(p, { x: c.x, y: c.y, w: 8, h: 10 })) {
        c.taken = true;
        game.coinCount++;
        game.score += 10;
        Retro.sfx("coin");
        dust(c.x + 4, c.y + 5, "#ffe600", 6);
        hud();
      }
    }

    // --- enemies
    for (const e of game.enemies) {
      if (!e.alive) { e.squash++; continue; }
      e.anim += 0.15;
      e.vy = Math.min(e.vy + GRAVITY, MAX_FALL);
      // turn around at ledges
      if (e.onGround) {
        const aheadX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
        const belowY = e.y + e.h + 2;
        const tile = tileAt(Math.floor(aheadX / T), Math.floor(belowY / T));
        if (!SOLID[tile] && tile !== "=") e.vx = -e.vx;
      }
      const vxBefore = e.vx;
      const r = moveBody(e, true);
      e.onGround = r.landed;
      if (r.hitX) e.vx = -vxBefore;
      if (e.y > game.level.h * T + 40) e.alive = false;

      if (overlap(p, e)) {
        const stomp = p.vy > 0 && p.y + p.h - p.vy <= e.y + 4;
        if (stomp) {
          e.alive = false;
          e.squash = 0;
          p.vy = keys.jump ? -JUMP_V : -4;
          p.boosted = true;
          p.canDouble = true;
          game.score += 50;
          Retro.sfx("eat");
          dust(e.x + 7, e.y + 5, "#39ff14", 10);
          hud();
        } else {
          hurt();
        }
      }
    }
    game.enemies = game.enemies.filter((e) => e.alive || e.squash < 30);

    // --- flag
    const f = game.level.flag;
    if (f && overlap(p, { x: f.x + 4, y: f.y - 48, w: 10, h: 64 })) reachFlag();

    updateParticles();
  }

  function updateParticles() {
    game.particles = game.particles.filter((q) => {
      q.x += q.vx; q.y += q.vy; q.vy += q.grav; q.life--;
      return q.life > 0;
    });
    if (game.shake > 0) game.shake = game.shake < 0.5 ? 0 : game.shake * 0.85;
  }

  /* ---------- Rendering ---------- */
  function draw() {
    const L = game.level;
    const p = game.player;

    // camera follow with look-ahead
    const tx = clamp(p.x + p.facing * 30 - VW / 2, 0, L.w * T - VW);
    const ty = clamp(p.y - VH / 2 + 20, 0, L.h * T - VH);
    game.cam.x += (tx - game.cam.x) * 0.12;
    game.cam.y += (ty - game.cam.y) * 0.12;
    const camX = Math.round(game.cam.x + (Math.random() - 0.5) * game.shake);
    const camY = Math.round(game.cam.y + (Math.random() - 0.5) * game.shake);

    // sky
    const grad = g.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, L.def.sky[0]);
    grad.addColorStop(1, L.def.sky[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);

    // stars
    g.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 97 - camX * 0.05) % VW + VW) % VW;
      const sy = (i * 53) % 110;
      if ((game.frame + i * 7) % 90 > 4) g.fillRect(sx | 0, sy, 1, 1);
    }

    // parallax mountains
    drawHills(camX * 0.2, 150, 60, "rgba(20,10,50,0.55)", 140);
    drawHills(camX * 0.45, 170, 40, "rgba(10,5,30,0.7)", 90);

    // tiles
    const x0 = Math.floor(camX / T), x1 = Math.ceil((camX + VW) / T);
    const y0 = Math.floor(camY / T), y1 = Math.ceil((camY + VH) / T);
    for (let ty2 = y0; ty2 <= y1; ty2++) {
      for (let tx2 = x0; tx2 <= x1; tx2++) {
        if (tx2 < 0 || tx2 >= L.w || ty2 < 0 || ty2 >= L.h) continue;
        drawTile(L.grid[ty2][tx2], tx2, ty2, tx2 * T - camX, ty2 * T - camY);
      }
    }

    // flag
    if (L.flag) {
      const fx = L.flag.x - camX, fy = L.flag.y - camY;
      g.fillStyle = "#ddd";
      g.fillRect(fx + 7, fy - 48, 2, 64);
      g.fillStyle = "#ffe600";
      g.fillRect(fx + 6, fy - 51, 4, 4);
      const wave = Math.sin(game.frame * 0.15);
      g.fillStyle = "#ff2e88";
      g.beginPath();
      g.moveTo(fx + 9, fy - 46);
      g.lineTo(fx + 25, fy - 41 + wave * 2);
      g.lineTo(fx + 9, fy - 34);
      g.fill();
    }

    // springs
    for (const s of game.springs) {
      const sx = s.x - camX, sy = s.y - camY;
      const h = s.squish > 0 ? 4 : 8;
      g.fillStyle = "#888";
      for (let i = 0; i < 3; i++) g.fillRect(sx + 4, sy + 8 - (i + 1) * (h / 3), 8, 1);
      g.fillStyle = "#ff2e88";
      g.fillRect(sx + 1, sy + 8 - h - 2, 14, 3);
      g.fillStyle = "#555";
      g.fillRect(sx + 2, sy + 6, 12, 2);
    }

    // coins (spinning)
    for (const c of game.coins) {
      if (c.taken) continue;
      const spin = Math.abs(Math.cos(game.frame * 0.08 + c.phase));
      const w = Math.max(1, Math.round(8 * spin));
      const bob = Math.round(Math.sin(game.frame * 0.06 + c.phase) * 1.5);
      const cx = c.x - camX + (8 - w) / 2, cy = c.y - camY + bob;
      g.fillStyle = "#b8860b";
      g.fillRect(cx, cy, w, 10);
      g.fillStyle = "#ffe600";
      g.fillRect(cx + (w > 2 ? 1 : 0), cy + 1, Math.max(1, w - 2), 8);
      if (w > 4) { g.fillStyle = "#fff8b0"; g.fillRect(cx + 2, cy + 2, 1, 4); }
    }

    // enemies
    for (const e of game.enemies) {
      const ex = Math.round(e.x - camX), ey = Math.round(e.y - camY);
      if (!e.alive) {
        g.globalAlpha = Math.max(0, 1 - e.squash / 30);
        g.fillStyle = "#39ff14";
        g.fillRect(ex - 1, ey + 7, e.w + 2, 3);
        g.globalAlpha = 1;
        continue;
      }
      const bounce = Math.abs(Math.sin(e.anim)) * 2;
      g.fillStyle = "#1e8f0a";
      g.fillRect(ex, ey + 2 + bounce, e.w, e.h - 2 - bounce);
      g.fillStyle = "#39ff14";
      g.fillRect(ex + 1, ey + 1 + bounce, e.w - 2, e.h - 4 - bounce);
      g.fillStyle = "#b6ff9e";
      g.fillRect(ex + 2, ey + 2 + bounce, 3, 2);
      g.fillStyle = "#000";
      const look = e.vx > 0 ? 2 : 0;
      g.fillRect(ex + 3 + look, ey + 4 + bounce, 2, 2);
      g.fillRect(ex + 8 + look, ey + 4 + bounce, 2, 2);
    }

    // player
    if (!(p.invuln > 0 && Math.floor(game.frame / 4) % 2 && game.state === "playing")) drawPlayer(p, camX, camY);

    // particles
    for (const q of game.particles) {
      g.globalAlpha = Math.min(1, q.life / 20);
      g.fillStyle = q.color;
      g.fillRect(Math.round(q.x - camX), Math.round(q.y - camY), q.size, q.size);
    }
    g.globalAlpha = 1;

    // level name banner at start
    if (game.state === "playing" && game.levelFrame < 120) {
      g.globalAlpha = game.levelFrame < 90 ? 1 : (120 - game.levelFrame) / 30;
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect(0, 20, VW, 22);
      g.fillStyle = "#ffe600";
      g.font = "8px 'Press Start 2P', monospace";
      g.textAlign = "center";
      g.fillText(L.def.name, VW / 2, 35);
      g.textAlign = "left";
      g.globalAlpha = 1;
    }
  }

  function drawHills(offset, base, amp, color, period) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, VH);
    for (let x = 0; x <= VW; x += 4) {
      const wx = x + offset;
      const y = base - Math.abs(Math.sin(wx / period)) * amp - Math.sin(wx / (period * 0.37)) * amp * 0.2;
      g.lineTo(x, Math.round(y / 2) * 2);
    }
    g.lineTo(VW, VH);
    g.fill();
  }

  function drawTile(t, tx, ty, x, y) {
    if (t === "#") {
      const top = !SOLID[tileAt(tx, ty - 1)];
      g.fillStyle = "#6b3f1f";
      g.fillRect(x, y, T, T);
      g.fillStyle = "#4e2c14";
      // deterministic speckles
      for (let i = 0; i < 4; i++) {
        const h = (tx * 73 + ty * 151 + i * 37) % 256;
        g.fillRect(x + (h % 14) + 1, y + ((h >> 4) % 12) + 3, 2, 2);
      }
      if (top) {
        g.fillStyle = "#39ff14";
        g.fillRect(x, y, T, 4);
        g.fillStyle = "#1e8f0a";
        g.fillRect(x, y + 4, T, 2);
        g.fillStyle = "#39ff14";
        if ((tx * 7) % 3 === 0) g.fillRect(x + 3, y - 2, 1, 2);
        if ((tx * 5) % 4 === 1) g.fillRect(x + 11, y - 1, 1, 1);
      }
    } else if (t === "B") {
      g.fillStyle = "#c0502a";
      g.fillRect(x, y, T, T);
      g.fillStyle = "#7a2e14";
      g.fillRect(x, y + 7, T, 1);
      g.fillRect(x, y + 15, T, 1);
      g.fillRect(x + 7, y, 1, 7);
      g.fillRect(x + 3, y + 8, 1, 7);
      g.fillRect(x + 12, y + 8, 1, 7);
      g.fillStyle = "#e8784a";
      g.fillRect(x, y, T, 1);
    } else if (t === "=") {
      g.fillStyle = "#c79a5b";
      g.fillRect(x, y, T, 5);
      g.fillStyle = "#8a6232";
      g.fillRect(x, y + 4, T, 1);
      g.fillRect(x + 7, y, 1, 4);
    } else if (t === "^") {
      g.fillStyle = "#aab";
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.moveTo(x + i * 8, y + T);
        g.lineTo(x + i * 8 + 4, y + 6);
        g.lineTo(x + i * 8 + 8, y + T);
        g.fill();
      }
      g.fillStyle = "#fff";
      g.fillRect(x + 4, y + 7, 1, 2);
      g.fillRect(x + 12, y + 7, 1, 2);
    }
  }

  function drawPlayer(p, camX, camY) {
    const sx = p.squash, sy = 2 - p.squash;
    const w = p.w * sy, h = p.h * sx;
    const x = Math.round(p.x - camX + (p.w - w) / 2);
    const y = Math.round(p.y - camY + (p.h - h));
    const dead = game.state === "dead";
    // body
    g.fillStyle = dead ? "#777" : "#ff2e88";
    g.fillRect(x, y + 2, w, h - 4);
    // head band
    g.fillStyle = "#00f0ff";
    g.fillRect(x, y + 3, w, 2);
    if (!p.onGround) { g.fillRect(x - p.facing * 3 + (p.facing > 0 ? 0 : w), y + 3, 3, 1); }
    // eye
    g.fillStyle = "#fff";
    const ex = p.facing > 0 ? x + w - 4 : x + 1;
    g.fillRect(ex, y + 6, 3, 3);
    g.fillStyle = "#000";
    g.fillRect(ex + (p.facing > 0 ? 1 : 0), y + 7, 2, 2);
    // legs
    g.fillStyle = "#5a1a3a";
    const step = p.onGround && Math.abs(p.vx) > 0.3 ? Math.round(Math.sin(p.runAnim * 3)) : 0;
    g.fillRect(x + 1, y + h - 2, 3, 2 + step);
    g.fillRect(x + w - 4, y + h - 2, 3, 2 - step);
  }

  /* ---------- HUD + overlay ---------- */
  function hud() {
    $("score").textContent = Retro.pad(game.score);
    $("coins").textContent = game.coinCount;
    $("lives").textContent = Math.max(0, game.lives);
  }
  function showOverlay(title, text, btn) {
    $("ov-title").textContent = title;
    $("ov-text").textContent = text;
    $("ov-btn").textContent = btn;
    $("overlay").classList.remove("hidden");
  }
  function hideOverlay() {
    $("overlay").classList.add("hidden");
  }

  /* ---------- Main loop (fixed 60Hz timestep) ---------- */
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= 1000 / 60) {
      update();
      acc -= 1000 / 60;
    }
    draw();
    requestAnimationFrame(loop);
  }

  // test hooks
  game.loadLevel = loadLevel;
  game.newGame = newGame;
  game.update = update;
  game.keys = keys;
  game.pressJump = () => { jumpPressed = true; keys.jump = true; };
  game.nextLevel = nextLevel;

  loadLevel(0);
  requestAnimationFrame(loop);
})();
