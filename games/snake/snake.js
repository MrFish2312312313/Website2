/* ==========================================================
   NEON SNAKE
   ========================================================== */
(function () {
  "use strict";

  const N = 24;            // grid cells per side
  const S = 20;            // pixel size of a cell
  const canvas = document.getElementById("game");
  const g = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  const POWERS = {
    gold:  { color: "#ffe600", life: 7000 },
    ice:   { color: "#00f0ff", life: 7000, duration: 6000 },
    ghost: { color: "#9d4dff", life: 7000, duration: 6000 },
  };

  const game = {
    state: "ready",
    snake: [],
    dir: { x: 1, y: 0 },
    queue: [],
    food: null,
    power: null,           // { kind, x, y, born }
    effects: {},           // kind -> expiry timestamp
    blocks: new Set(),
    score: 0,
    eaten: 0,
    level: 1,
    particles: [],
    shake: 0,
    lastTick: 0,
    time: 0,
  };
  window.game = game; // exposed for tests / debugging

  const key = (x, y) => x + "," + y;

  function occupied(x, y) {
    return game.blocks.has(key(x, y)) || game.snake.some((p) => p.x === x && p.y === y);
  }

  function freeCell(minDistFromHead) {
    const head = game.snake[0] || { x: -99, y: -99 };
    for (let tries = 0; tries < 500; tries++) {
      const x = (Math.random() * N) | 0;
      const y = (Math.random() * N) | 0;
      if (occupied(x, y)) continue;
      if (game.food && game.food.x === x && game.food.y === y) continue;
      if (game.power && game.power.x === x && game.power.y === y) continue;
      if (Math.abs(x - head.x) + Math.abs(y - head.y) < (minDistFromHead || 0)) continue;
      return { x, y };
    }
    return null;
  }

  function reset() {
    const mid = N >> 1;
    game.snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    game.dir = { x: 1, y: 0 };
    game.queue = [];
    game.blocks = new Set();
    game.power = null;
    game.effects = {};
    game.score = 0;
    game.eaten = 0;
    game.level = 1;
    game.particles = [];
    game.food = freeCell(3);
    hud();
  }

  function start() {
    reset();
    game.state = "playing";
    game.lastTick = performance.now();
    hideOverlay();
    Retro.sfx("start");
  }

  function addBlocks(count) {
    for (let i = 0; i < count; i++) {
      const c = freeCell(6);
      if (c) game.blocks.add(key(c.x, c.y));
    }
  }

  function tickInterval() {
    let ms = Math.max(55, 130 - (game.level - 1) * 10);
    if (active("ice")) ms *= 1.8;
    return ms;
  }

  function active(kind) {
    return (game.effects[kind] || 0) > game.time;
  }

  function burst(cx, cy, color, n) {
    for (let i = 0; i < (n || 14); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * 3 + 1;
      game.particles.push({
        x: cx * S + S / 2, y: cy * S + S / 2,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 30 + Math.random() * 20, color,
      });
    }
  }

  /* ---------- One logic step ---------- */
  function step() {
    if (game.queue.length) {
      const d = game.queue.shift();
      if (!(d.x === -game.dir.x && d.y === -game.dir.y)) game.dir = d;
    }
    const head = game.snake[0];
    let nx = head.x + game.dir.x;
    let ny = head.y + game.dir.y;
    const ghost = active("ghost");

    if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
      if (!ghost) return die();
      nx = (nx + N) % N;
      ny = (ny + N) % N;
    }
    if (!ghost && game.blocks.has(key(nx, ny))) return die();
    // The tail moves out of the way this tick, so it's safe to move into.
    const hitSelf = game.snake.some((p, i) => i < game.snake.length - 1 && p.x === nx && p.y === ny);
    if (hitSelf && !ghost) return die();

    game.snake.unshift({ x: nx, y: ny });

    let grow = false;
    if (game.food && nx === game.food.x && ny === game.food.y) {
      grow = true;
      game.eaten++;
      game.score += 10 * game.level;
      burst(nx, ny, "#ff2e88");
      Retro.sfx("eat");
      if (game.eaten % 5 === 0) levelUp();
      game.food = freeCell(2);
      if (!game.power && Math.random() < 0.3) {
        const kinds = Object.keys(POWERS);
        const c = freeCell(4);
        if (c) game.power = { kind: kinds[(Math.random() * kinds.length) | 0], x: c.x, y: c.y, born: game.time };
      }
    }
    if (game.power && nx === game.power.x && ny === game.power.y) {
      const p = game.power;
      burst(nx, ny, POWERS[p.kind].color, 24);
      Retro.sfx("power");
      if (p.kind === "gold") game.score += 50;
      else game.effects[p.kind] = game.time + POWERS[p.kind].duration;
      game.power = null;
    }
    if (!grow) game.snake.pop();
    hud();
  }

  function levelUp() {
    game.level++;
    addBlocks(3);
    Retro.sfx("coin");
    flashText = { text: "LEVEL " + game.level, until: game.time + 1200 };
  }

  function die() {
    game.state = "over";
    game.shake = 14;
    game.snake.forEach((p, i) => i % 2 === 0 && burst(p.x, p.y, "#39ff14", 4));
    Retro.sfx("hurt");
    setTimeout(() => Retro.sfx("over"), 250);
    const record = Retro.submitScore("snake", game.score);
    hud();
    setTimeout(() => showOverlay(
      "GAME OVER",
      (record ? "NEW HIGH SCORE! " : "") + "Score: " + game.score + " · Length: " + game.snake.length,
      "PLAY AGAIN"
    ), 700);
  }

  /* ---------- HUD + overlay ---------- */
  function hud() {
    $("score").textContent = Retro.pad(game.score);
    $("level").textContent = game.level;
    $("high").textContent = Retro.pad(Math.max(game.score, Retro.getHigh("snake")));
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
  function togglePause() {
    if (game.state === "playing") {
      game.state = "paused";
      showOverlay("PAUSED", "Take a breather.", "RESUME");
    } else if (game.state === "paused") {
      game.state = "playing";
      game.lastTick = performance.now();
      hideOverlay();
    }
  }
  function primary() {
    if (game.state === "paused") togglePause();
    else if (game.state !== "playing") start();
  }

  /* ---------- Rendering ---------- */
  let flashText = null;

  function draw() {
    g.save();
    if (game.shake > 0) {
      g.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
      game.shake *= 0.85;
      if (game.shake < 0.5) game.shake = 0;
    }

    // board
    g.fillStyle = "#050a08";
    g.fillRect(-20, -20, N * S + 40, N * S + 40);
    g.fillStyle = "#0b1712";
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x + y) & 1) g.fillRect(x * S, y * S, S, S);

    // ghost mode tint on border
    if (active("ghost")) {
      g.strokeStyle = "rgba(157,77,255," + (0.5 + Math.sin(game.time / 80) * 0.4) + ")";
      g.lineWidth = 4;
      g.strokeRect(2, 2, N * S - 4, N * S - 4);
    }

    // blocks
    game.blocks.forEach((k) => {
      const [x, y] = k.split(",").map(Number);
      g.fillStyle = "#5a2d82";
      g.fillRect(x * S, y * S, S, S);
      g.fillStyle = "#9d4dff";
      g.fillRect(x * S, y * S, S, 3);
      g.fillRect(x * S, y * S, 3, S);
      g.fillStyle = "#2a0f45";
      g.fillRect(x * S + 3, y * S + S - 3, S - 3, 3);
    });

    // food (pulsing)
    if (game.food) {
      const pulse = Math.sin(game.time / 120) * 2;
      g.shadowColor = "#ff2e88";
      g.shadowBlur = 14;
      g.fillStyle = "#ff2e88";
      g.fillRect(game.food.x * S + 4 - pulse / 2, game.food.y * S + 4 - pulse / 2, S - 8 + pulse, S - 8 + pulse);
      g.shadowBlur = 0;
    }

    // power-up (blinks when about to expire)
    if (game.power) {
      const p = game.power;
      const age = game.time - p.born;
      const left = POWERS[p.kind].life - age;
      if (left <= 0) game.power = null;
      else if (left > 2000 || Math.floor(game.time / 120) % 2) {
        g.shadowColor = POWERS[p.kind].color;
        g.shadowBlur = 18;
        g.fillStyle = POWERS[p.kind].color;
        const cx = p.x * S + S / 2, cy = p.y * S + S / 2;
        g.beginPath();
        g.moveTo(cx, cy - 8); g.lineTo(cx + 8, cy); g.lineTo(cx, cy + 8); g.lineTo(cx - 8, cy);
        g.fill();
        g.shadowBlur = 0;
      }
    }

    // snake
    const ghost = active("ghost");
    const len = game.snake.length;
    game.snake.forEach((p, i) => {
      const t = i / Math.max(1, len - 1);
      const r = Math.round(57 + (0 - 57) * t);
      const gg = Math.round(255 + (160 - 255) * t);
      const b = Math.round(20 + (90 - 20) * t);
      g.globalAlpha = ghost ? 0.55 : 1;
      g.fillStyle = game.state === "over" ? "#3a3a3a" : `rgb(${r},${gg},${b})`;
      g.fillRect(p.x * S + 1, p.y * S + 1, S - 2, S - 2);
      if (i === 0) {
        g.fillStyle = "#000";
        const dx = game.dir.x, dy = game.dir.y;
        const cx = p.x * S + S / 2 + dx * 3, cy = p.y * S + S / 2 + dy * 3;
        g.fillRect(cx - dy * 4 - 1.5, cy + dx * 4 - 1.5, 3, 3);
        g.fillRect(cx + dy * 4 - 1.5, cy - dx * 4 - 1.5, 3, 3);
      }
    });
    g.globalAlpha = 1;

    // particles
    game.particles = game.particles.filter((pt) => {
      pt.x += pt.vx; pt.y += pt.vy; pt.vx *= 0.94; pt.vy *= 0.94; pt.life--;
      g.globalAlpha = Math.max(0, pt.life / 50);
      g.fillStyle = pt.color;
      g.fillRect(pt.x, pt.y, 3, 3);
      return pt.life > 0;
    });
    g.globalAlpha = 1;

    // ice overlay
    if (active("ice")) {
      g.fillStyle = "rgba(0,240,255,0.08)";
      g.fillRect(0, 0, N * S, N * S);
    }

    // effect timers
    let y = 14;
    ["ice", "ghost"].forEach((k) => {
      if (active(k)) {
        const frac = (game.effects[k] - game.time) / POWERS[k].duration;
        g.fillStyle = POWERS[k].color;
        g.fillRect(8, y, 80 * frac, 6);
        g.font = "10px 'Press Start 2P', monospace";
        g.fillText(k.toUpperCase(), 94, y + 7);
        y += 14;
      }
    });

    if (flashText && flashText.until > game.time) {
      g.font = "28px 'Press Start 2P', monospace";
      g.textAlign = "center";
      g.fillStyle = "#ffe600";
      g.shadowColor = "#ff2e88";
      g.shadowBlur = 0;
      g.fillText(flashText.text, N * S / 2 + 3, N * S / 2 + 3);
      g.fillStyle = Math.floor(game.time / 100) % 2 ? "#ffe600" : "#ff2e88";
      g.fillText(flashText.text, N * S / 2, N * S / 2);
      g.textAlign = "left";
    }

    g.restore();
  }

  /* ---------- Main loop ---------- */
  function frame(now) {
    game.time = now;
    if (game.state === "playing") {
      // catch up on missed ticks but cap to avoid spiral after tab switch
      let guard = 0;
      while (now - game.lastTick >= tickInterval() && guard++ < 5 && game.state === "playing") {
        game.lastTick += tickInterval();
        step();
      }
      if (now - game.lastTick > 1000) game.lastTick = now;
    }
    draw();
    requestAnimationFrame(frame);
  }

  /* ---------- Input ---------- */
  const DIRS = {
    ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, S: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }, D: { x: 1, y: 0 },
  };
  function queueDir(d) {
    const last = game.queue[game.queue.length - 1] || game.dir;
    if ((d.x === last.x && d.y === last.y) || (d.x === -last.x && d.y === -last.y)) return;
    if (game.queue.length < 3) game.queue.push(d);
  }
  addEventListener("keydown", (e) => {
    if (DIRS[e.key]) {
      e.preventDefault();
      if (game.state === "playing") queueDir(DIRS[e.key]);
      else if (game.state === "ready" || game.state === "over") { primary(); queueDir(DIRS[e.key]); }
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      primary();
    } else if (e.key === "p" || e.key === "P" || e.key === "Escape") {
      togglePause();
    }
  });
  $("ov-btn").addEventListener("click", () => { Retro.sfx("click"); primary(); });

  // touch swipe
  let touch = null;
  canvas.addEventListener("touchstart", (e) => { touch = e.touches[0]; e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.clientX, dy = t.clientY - touch.clientY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) {
      queueDir(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
    }
    if (game.state !== "playing") primary();
    touch = null;
  });

  // pause automatically when the tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game.state === "playing") togglePause();
  });

  // test hooks
  game.start = start;
  game.step = step;
  game.queueDir = queueDir;

  reset();
  requestAnimationFrame(frame);
})();
