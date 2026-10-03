/* ==========================================================
   LIFE LAB — Conway's Game of Life with neon trails
   ========================================================== */
(function () {
  "use strict";

  const C = 8;
  const canvas = document.getElementById("game");
  const g = canvas.getContext("2d");
  const W = canvas.width / C, H = canvas.height / C;
  const $ = (id) => document.getElementById(id);

  let cells = new Uint8Array(W * H);
  let next = new Uint8Array(W * H);
  const heat = new Float32Array(W * H);   // trail glow
  let gen = 0;
  let running = true;
  let speed = 12;

  const PATTERNS = {
    glider: [".O.", "..O", "OOO"],
    lwss: [".O..O", "O....", "O...O", "OOOO."],
    rpent: [".OO", "OO.", ".O."],
    pulsar: [
      "..OOO...OOO..",
      ".............",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      "..OOO...OOO..",
      ".............",
      "..OOO...OOO..",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      ".............",
      "..OOO...OOO..",
    ],
    gun: [
      "........................O...........",
      "......................O.O...........",
      "............OO......OO............OO",
      "...........O...O....OO............OO",
      "OO........O.....O...OO..............",
      "OO........O...O.OO....O.O...........",
      "..........O.....O.......O...........",
      "...........O...O....................",
      "............OO......................",
    ],
  };

  function stamp(name, cx, cy) {
    const p = PATTERNS[name];
    const ox = cx - (p[0].length >> 1), oy = cy - (p.length >> 1);
    p.forEach((row, y) => [...row].forEach((ch, x) => {
      const nx = (ox + x + W) % W, ny = (oy + y + H) % H;
      if (ch === "O") { cells[ny * W + nx] = 1; heat[ny * W + nx] = 1; }
    }));
  }

  function step() {
    for (let y = 0; y < H; y++) {
      const yu = ((y - 1 + H) % H) * W, yc = y * W, yd = ((y + 1) % H) * W;
      for (let x = 0; x < W; x++) {
        const xl = (x - 1 + W) % W, xr = (x + 1) % W;
        const n = cells[yu + xl] + cells[yu + x] + cells[yu + xr] +
                  cells[yc + xl] + cells[yc + xr] +
                  cells[yd + xl] + cells[yd + x] + cells[yd + xr];
        const c = cells[yc + x];
        next[yc + x] = (c && (n === 2 || n === 3)) || (!c && n === 3) ? 1 : 0;
      }
    }
    [cells, next] = [next, cells];
    gen++;
  }

  function randomize() {
    for (let i = 0; i < cells.length; i++) cells[i] = Math.random() < 0.25 ? 1 : 0;
    gen = 0;
  }
  function clear() {
    cells.fill(0);
    heat.fill(0);
    gen = 0;
  }

  function draw() {
    g.fillStyle = "#04020a";
    g.fillRect(0, 0, canvas.width, canvas.height);
    // faint grid
    g.fillStyle = "#0d0820";
    for (let x = 0; x < W; x++) g.fillRect(x * C, 0, 1, canvas.height);
    for (let y = 0; y < H; y++) g.fillRect(0, y * C, canvas.width, 1);

    let alive = 0;
    for (let i = 0; i < cells.length; i++) {
      const x = (i % W) * C, y = ((i / W) | 0) * C;
      if (cells[i]) {
        alive++;
        heat[i] = 1;
        g.fillStyle = "#00f0ff";
        g.fillRect(x + 1, y + 1, C - 1, C - 1);
        g.fillStyle = "#c8fcff";
        g.fillRect(x + 2, y + 2, 2, 2);
      } else if (heat[i] > 0.02) {
        heat[i] *= running ? 0.9 : 1;
        // trail fades from pink to purple
        g.fillStyle = `rgba(255,46,136,${heat[i] * 0.45})`;
        g.fillRect(x + 1, y + 1, C - 1, C - 1);
      }
    }
    $("gen").textContent = gen;
    $("alive").textContent = alive;
  }

  /* ---------- Input ---------- */
  let drawing = false, drawValue = 1;
  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * W),
      y: Math.floor(((e.clientY - r.top) / r.height) * H),
    };
  }
  canvas.addEventListener("pointerdown", (e) => {
    const p = cellAt(e);
    const pat = $("pattern").value;
    if (pat) { stamp(pat, p.x, p.y); Retro.sfx("eat"); return; }
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    drawValue = cells[p.y * W + p.x] ? 0 : 1;
    cells[p.y * W + p.x] = drawValue;
    Retro.sfx("hover");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = cellAt(e);
    if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) cells[p.y * W + p.x] = drawValue;
  });
  canvas.addEventListener("pointerup", () => { drawing = false; });

  function toggle() {
    running = !running;
    $("play").textContent = running ? "PAUSE" : "PLAY";
    $("play").classList.toggle("active", !running);
    Retro.sfx("click");
  }
  $("play").addEventListener("click", toggle);
  $("step").addEventListener("click", () => { step(); Retro.sfx("hover"); });
  $("random").addEventListener("click", () => { randomize(); Retro.sfx("power"); });
  $("clear").addEventListener("click", () => { clear(); Retro.sfx("hurt"); });
  $("speed").addEventListener("input", (e) => { speed = +e.target.value; });
  addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT") return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "n" || e.key === "N") step();
    else if (e.key === "r" || e.key === "R") randomize();
    else if (e.key === "c" || e.key === "C") clear();
  });

  /* ---------- Loop ---------- */
  let acc = 0, last = performance.now();
  function loop(now) {
    acc += Math.min(250, now - last);
    last = now;
    if (running) {
      const interval = 1000 / speed;
      while (acc >= interval) { step(); acc -= interval; }
    } else acc = 0;
    draw();
    requestAnimationFrame(loop);
  }

  window.game = {
    step, stamp, clear, randomize,
    get gen() { return gen; },
    alive: () => cells.reduce((a, b) => a + b, 0),
    set: (x, y, v) => { cells[y * W + x] = v; },
  };

  // start with a glider gun so there's something to watch
  stamp("gun", 22, 12);
  stamp("pulsar", 62, 34);
  requestAnimationFrame(loop);
})();
