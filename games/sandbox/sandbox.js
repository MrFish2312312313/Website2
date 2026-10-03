/* ==========================================================
   SAND BOX — falling sand simulation
   Each cell holds an element id. The grid updates bottom-to-top
   with a per-frame stamp so a particle only moves once per tick.
   ========================================================== */
(function () {
  "use strict";

  const W = 200, H = 125;
  const canvas = document.getElementById("game");
  const g = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  /* ---------- Element definitions ---------- */
  // kind: static | powder | liquid | gas
  // density: heavier things sink through lighter movable things
  const E = {};
  const DEFS = [
    { key: "EMPTY",     name: "Eraser",    kind: "none",   color: [10, 6, 18],    vary: 0,  density: 0 },
    { key: "WALL",      name: "Wall",      kind: "static", color: [120, 120, 135], vary: 12 },
    { key: "SAND",      name: "Sand",      kind: "powder", color: [222, 186, 100], vary: 25, density: 6 },
    { key: "WATER",     name: "Water",     kind: "liquid", color: [40, 110, 255],  vary: 18, density: 3, spread: 4 },
    { key: "STONE",     name: "Stone",     kind: "powder", color: [95, 95, 105],   vary: 18, density: 8, noSlide: true },
    { key: "WOOD",      name: "Wood",      kind: "static", color: [120, 70, 35],   vary: 18, burn: 0.04 },
    { key: "FIRE",      name: "Fire",      kind: "gas",    color: [255, 120, 20],  vary: 60, density: -2 },
    { key: "SMOKE",     name: "Smoke",     kind: "gas",    color: [70, 70, 80],    vary: 15, density: -1, hidden: true },
    { key: "STEAM",     name: "Steam",     kind: "gas",    color: [200, 210, 230], vary: 15, density: -1 },
    { key: "OIL",       name: "Oil",       kind: "liquid", color: [70, 45, 20],    vary: 10, density: 2, spread: 3, burn: 0.35 },
    { key: "LAVA",      name: "Lava",      kind: "liquid", color: [255, 70, 10],   vary: 40, density: 5, spread: 1, slow: 0.5 },
    { key: "ACID",      name: "Acid",      kind: "liquid", color: [120, 255, 40],  vary: 30, density: 3, spread: 3 },
    { key: "PLANT",     name: "Plant",     kind: "static", color: [40, 190, 60],   vary: 30, burn: 0.06 },
    { key: "ICE",       name: "Ice",       kind: "static", color: [170, 230, 255], vary: 15 },
    { key: "GUNPOWDER", name: "Gunpowder", kind: "powder", color: [50, 50, 55],    vary: 15, density: 6, burn: 1 },
    { key: "SNOW",      name: "Snow",      kind: "powder", color: [240, 245, 255], vary: 10, density: 4 },
    { key: "SEED",      name: "Seed",      kind: "powder", color: [150, 110, 40],  vary: 15, density: 6, burn: 0.1 },
    { key: "CLONER",    name: "Cloner",    kind: "static", color: [230, 40, 200],  vary: 20 },
  ];
  DEFS.forEach((d, i) => { d.id = i; E[d.key] = i; });
  const MOVABLE = DEFS.map((d) => d.kind === "powder" || d.kind === "liquid" || d.kind === "gas");
  const DENSITY = DEFS.map((d) => (d.density === undefined ? 99 : d.density));

  /* ---------- Grid state ---------- */
  const N = W * H;
  let type = new Uint8Array(N);
  let life = new Int16Array(N);
  let shade = new Uint8Array(N);
  let extra = new Uint8Array(N);   // cloner: element to clone
  const stamp = new Uint8Array(N);
  let tick = 1;

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  function set(i, t) {
    type[i] = t;
    shade[i] = (Math.random() * 256) | 0;
    life[i] = 0;
    extra[i] = 0;
    if (t === E.FIRE) life[i] = 20 + Math.random() * 40;
    else if (t === E.SMOKE) life[i] = 40 + Math.random() * 60;
    else if (t === E.STEAM) life[i] = 80 + Math.random() * 120;
    stamp[i] = tick;
  }

  function swap(a, b) {
    const t = type[a]; type[a] = type[b]; type[b] = t;
    const l = life[a]; life[a] = life[b]; life[b] = l;
    const s = shade[a]; shade[a] = shade[b]; shade[b] = s;
    const x = extra[a]; extra[a] = extra[b]; extra[b] = x;
    stamp[a] = tick;
    stamp[b] = tick;
  }

  /** Can a particle of type t move into cell (x,y)? */
  function canEnter(t, x, y) {
    if (!inside(x, y)) return false;
    const o = type[idx(x, y)];
    if (o === E.EMPTY) return true;
    if (!MOVABLE[o]) return false;
    if (DEFS[t].kind === "gas") return false;
    // sink through lighter stuff (including gases)
    return DENSITY[o] < DENSITY[t];
  }

  function tryMove(i, x, y, nx, ny) {
    if (canEnter(type[i], nx, ny)) { swap(i, idx(nx, ny)); return true; }
    return false;
  }

  /* ---------- Neighbour helpers ---------- */
  const NB = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];

  function ignite(i) {
    const t = type[i];
    if (t === E.GUNPOWDER) { explode(i % W, (i / W) | 0, 6); return; }
    set(i, E.FIRE);
    // solids and oil burn in place as embers instead of floating away
    if (t === E.WOOD || t === E.PLANT || t === E.SEED) { life[i] = 80 + Math.random() * 80; extra[i] = 1; }
    if (t === E.OIL) { life[i] = 50 + Math.random() * 40; extra[i] = 1; }
  }

  let lastBoom = 0;
  function explode(cx, cy, r) {
    const now = performance.now();
    if (now - lastBoom > 120) { Retro.sfx("boom"); lastBoom = now; }
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const nx = cx + x, ny = cy + y;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        const t = type[j];
        if (t === E.WALL || t === E.CLONER) continue;
        if (t === E.GUNPOWDER && (x || y)) { type[j] = E.FIRE; life[j] = 3; continue; } // chain on next tick
        if (Math.random() < 0.7) set(j, E.FIRE);
        else set(j, E.SMOKE);
      }
    }
  }

  /* ---------- Per-element update ---------- */
  function updateCell(x, y) {
    const i = idx(x, y);
    const t = type[i];
    const def = DEFS[t];

    // ---- reactions ----
    switch (t) {
      case E.FIRE: {
        life[i]--;
        for (let k = 0; k < 8; k++) {
          const nx = x + NB[k][0], ny = y + NB[k][1];
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny), o = type[j];
          if (o === E.WATER || o === E.SNOW || o === E.ICE) {
            set(i, E.STEAM);
            if (o !== E.ICE && Math.random() < 0.5) set(j, E.STEAM);
            else if (o === E.ICE) set(j, E.WATER);
            return;
          }
          const burn = DEFS[o].burn;
          if (burn && Math.random() < burn) ignite(j);
        }
        if (life[i] <= 0) {
          set(i, Math.random() < 0.35 ? E.SMOKE : E.EMPTY);
          return;
        }
        if (extra[i]) return;               // embers stay put
        if (Math.random() < 0.45) return;   // flames linger a little
        break;
      }
      case E.SMOKE:
      case E.STEAM: {
        if (--life[i] <= 0) {
          set(i, t === E.STEAM && Math.random() < 0.4 ? E.WATER : E.EMPTY);
          return;
        }
        break;
      }
      case E.LAVA: {
        for (let k = 0; k < 4; k++) {
          const nx = x + NB[k][0], ny = y + NB[k][1];
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny), o = type[j];
          if (o === E.WATER || o === E.SNOW) {
            set(i, E.STONE);
            set(j, E.STEAM);
            return;
          }
          if (o === E.ICE) { set(j, E.WATER); continue; }
          if (o === E.SAND && Math.random() < 0.002) { set(j, E.LAVA); continue; }
          const burn = DEFS[o].burn;
          if (burn && Math.random() < burn * 0.5) ignite(j);
          else if (o === E.EMPTY && ny < y && Math.random() < 0.003) set(j, E.FIRE);
        }
        break;
      }
      case E.ACID: {
        const k = (Math.random() * 4) | 0;
        const nx = x + NB[k][0], ny = y + NB[k][1];
        if (inside(nx, ny)) {
          const j = idx(nx, ny), o = type[j];
          if (o !== E.EMPTY && o !== E.ACID && o !== E.WALL && o !== E.CLONER && Math.random() < 0.15) {
            set(j, Math.random() < 0.3 ? E.SMOKE : E.EMPTY);
            if (Math.random() < 0.4) { set(i, E.EMPTY); return; }
          }
        }
        break;
      }
      case E.PLANT: {
        if (Math.random() < 0.06) {
          const k = (Math.random() * 8) | 0;
          const nx = x + NB[k][0], ny = y + NB[k][1];
          if (inside(nx, ny) && type[idx(nx, ny)] === E.WATER) set(idx(nx, ny), E.PLANT);
        }
        return; // static
      }
      case E.SEED: {
        // sprouts when resting on something with water nearby
        if (y + 1 < H && type[idx(x, y + 1)] !== E.EMPTY && Math.random() < 0.05) {
          for (let k = 0; k < 8; k++) {
            const nx = x + NB[k][0], ny = y + NB[k][1];
            if (inside(nx, ny) && type[idx(nx, ny)] === E.WATER) { set(i, E.PLANT); return; }
          }
        }
        break;
      }
      case E.ICE: {
        if (Math.random() < 0.02) {
          const k = (Math.random() * 4) | 0;
          const nx = x + NB[k][0], ny = y + NB[k][1];
          if (inside(nx, ny)) {
            const j = idx(nx, ny), o = type[j];
            if (o === E.WATER && Math.random() < 0.3) set(j, E.ICE);
            else if (o === E.FIRE || o === E.LAVA) set(i, E.WATER);
          }
        }
        return;
      }
      case E.SNOW: {
        for (let k = 0; k < 4; k++) {
          const nx = x + NB[k][0], ny = y + NB[k][1];
          if (!inside(nx, ny)) continue;
          const o = type[idx(nx, ny)];
          if ((o === E.FIRE || o === E.LAVA || o === E.STEAM) && Math.random() < 0.3) { set(i, E.WATER); return; }
          if (o === E.WATER && Math.random() < 0.002) { set(i, E.WATER); return; }
        }
        break;
      }
      case E.CLONER: {
        // learn the first non-empty neighbour, then emit copies
        for (let k = 0; k < 4; k++) {
          const nx = x + NB[k][0], ny = y + NB[k][1];
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny), o = type[j];
          if (!extra[i] && o !== E.EMPTY && o !== E.CLONER && o !== E.WALL) extra[i] = o;
          else if (extra[i] && o === E.EMPTY && Math.random() < 0.15) set(j, extra[i]);
        }
        return;
      }
    }

    if (def.kind === "static" || def.kind === "none") return;
    if (def.slow && Math.random() > def.slow) return;

    // ---- movement ----
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (def.kind === "powder") {
      if (tryMove(i, x, y, x, y + 1)) return;
      if (def.noSlide && Math.random() < 0.85) return;
      if (tryMove(i, x, y, x + dir, y + 1)) return;
      tryMove(i, x, y, x - dir, y + 1);
    } else if (def.kind === "liquid") {
      if (tryMove(i, x, y, x, y + 1)) return;
      if (tryMove(i, x, y, x + dir, y + 1)) return;
      if (tryMove(i, x, y, x - dir, y + 1)) return;
      // flow sideways up to `spread` cells
      let cx = x, cur = i;
      for (let s = 0; s < def.spread; s++) {
        const nx = cx + dir;
        if (!inside(nx, y) || type[idx(nx, y)] !== E.EMPTY) break;
        swap(cur, idx(nx, y));
        cur = idx(nx, y);
        cx = nx;
        if (inside(cx, y + 1) && type[idx(cx, y + 1)] === E.EMPTY) break;
      }
    } else if (def.kind === "gas") {
      const drift = Math.random();
      if (drift < 0.6) {
        if (gasMove(i, x, y - 1)) return;
        if (gasMove(i, x + dir, y - 1)) return;
      }
      gasMove(i, x + dir, y);
    }
  }

  function gasMove(i, nx, ny) {
    if (!inside(nx, ny)) {
      // gases leave through the top
      if (ny < 0) { set(i, E.EMPTY); return true; }
      return false;
    }
    const j = idx(nx, ny);
    if (type[j] === E.EMPTY) { swap(i, j); return true; }
    // lighter gases bubble up through heavier ones
    if (DEFS[type[j]].kind === "gas" && DENSITY[type[j]] > DENSITY[type[i]] && Math.random() < 0.3) { swap(i, j); return true; }
    // rise through liquids slowly (bubbles)
    if (DEFS[type[j]].kind === "liquid" && Math.random() < 0.15) { swap(i, j); return true; }
    return false;
  }

  function step() {
    tick = tick === 255 ? 1 : tick + 1;
    const ltr = tick & 1;
    for (let y = H - 1; y >= 0; y--) {
      for (let k = 0; k < W; k++) {
        const x = ltr ? k : W - 1 - k;
        const i = y * W + x;
        if (type[i] === E.EMPTY || stamp[i] === tick) continue;
        updateCell(x, y);
      }
    }
  }

  /* ---------- Rendering ---------- */
  const img = g.createImageData(W, H);
  const buf = new Uint32Array(img.data.buffer);
  // pre-compute 16 shades per element as packed ABGR
  const SHADES = DEFS.map((d) => {
    const out = new Uint32Array(16);
    for (let s = 0; s < 16; s++) {
      const v = ((s / 15) - 0.5) * d.vary;
      const r = Math.max(0, Math.min(255, d.color[0] + v)) | 0;
      const gg = Math.max(0, Math.min(255, d.color[1] + v * (d.key === "FIRE" || d.key === "LAVA" ? 1.4 : 1))) | 0;
      const b = Math.max(0, Math.min(255, d.color[2] + v)) | 0;
      out[s] = (255 << 24) | (b << 16) | (gg << 8) | r;
    }
    return out;
  });
  const BG = SHADES[0][0];

  function render() {
    let count = 0;
    for (let i = 0; i < N; i++) {
      const t = type[i];
      if (t === E.EMPTY) { buf[i] = BG; continue; }
      count++;
      let s = shade[i] >> 4;
      if (t === E.FIRE || t === E.LAVA) s = (s + tick) & 15;     // flicker
      if (t === E.WATER || t === E.ACID) s = (s + ((tick >> 2) & 3)) & 15; // shimmer
      buf[i] = SHADES[t][s];
    }
    g.putImageData(img, 0, 0);

    // brush preview
    if (mouse.inside) {
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(mouse.x + 0.5, mouse.y + 0.5, brush, 0, Math.PI * 2);
      g.stroke();
    }
    return count;
  }

  /* ---------- Painting ---------- */
  let current = E.SAND;
  let brush = 4;
  const mouse = { x: 0, y: 0, px: 0, py: 0, down: false, erase: false, inside: false };

  function paint(cx, cy, t) {
    const def = DEFS[t];
    for (let y = -brush; y <= brush; y++) {
      for (let x = -brush; x <= brush; x++) {
        if (x * x + y * y > brush * brush) continue;
        const nx = cx + x, ny = cy + y;
        if (!inside(nx, ny)) continue;
        const i = idx(nx, ny);
        if (t === E.EMPTY) { set(i, E.EMPTY); continue; }
        if (type[i] !== E.EMPTY) continue;
        // scatter loose materials for a natural look
        if ((def.kind === "powder" || def.kind === "liquid" || def.kind === "gas") && Math.random() < 0.55) continue;
        set(i, t);
      }
    }
  }

  function paintLine(x0, y0, x1, y1, t) {
    const dist = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, brush / 2)));
    for (let s = 0; s <= steps; s++) {
      paint(Math.round(x0 + ((x1 - x0) * s) / steps), Math.round(y0 + ((y1 - y0) * s) / steps), t);
    }
  }

  function toGrid(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * W),
      y: Math.floor(((e.clientY - r.top) / r.height) * H),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = toGrid(e);
    mouse.down = true;
    mouse.erase = e.button === 2;
    mouse.x = mouse.px = p.x;
    mouse.y = mouse.py = p.y;
    paint(p.x, p.y, mouse.erase ? E.EMPTY : current);
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = toGrid(e);
    mouse.inside = true;
    mouse.px = mouse.x; mouse.py = mouse.y;
    mouse.x = p.x; mouse.y = p.y;
    if (mouse.down) paintLine(mouse.px, mouse.py, p.x, p.y, mouse.erase ? E.EMPTY : current);
    if (inside(p.x, p.y)) $("hover").textContent = DEFS[type[idx(p.x, p.y)]].key === "EMPTY" ? "EMPTY" : DEFS[type[idx(p.x, p.y)]].name.toUpperCase();
  });
  const stop = () => { mouse.down = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("pointerleave", () => { mouse.inside = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    setBrush(brush + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  function setBrush(v) {
    brush = Math.max(1, Math.min(15, v));
    $("brush").value = brush;
    $("brush-val").textContent = brush;
  }
  $("brush").addEventListener("input", (e) => setBrush(+e.target.value));

  /* ---------- UI ---------- */
  const palette = $("elements");
  DEFS.forEach((d) => {
    if (d.hidden) return;
    const b = document.createElement("button");
    b.className = "el" + (d.id === current ? " active" : "");
    b.dataset.id = d.id;
    const c = d.key === "EMPTY" ? "transparent" : `rgb(${d.color.join(",")})`;
    b.innerHTML = `<i style="background:${c}${d.key === "EMPTY" ? ";border-style:dashed;border-color:#f44" : ""}"></i>${d.name.toUpperCase()}`;
    b.addEventListener("click", () => selectElement(d.id));
    palette.appendChild(b);
  });
  function selectElement(id) {
    current = id;
    palette.querySelectorAll(".el").forEach((x) => x.classList.toggle("active", +x.dataset.id === id));
    Retro.sfx("hover");
  }

  let paused = false;
  function togglePause() {
    paused = !paused;
    $("pause").textContent = paused ? "PLAY" : "PAUSE";
    $("pause").classList.toggle("active", paused);
  }
  $("pause").addEventListener("click", () => { togglePause(); Retro.sfx("click"); });
  $("step").addEventListener("click", () => { step(); Retro.sfx("hover"); });
  $("clear").addEventListener("click", () => { clearAll(); Retro.sfx("hurt"); });
  $("demo").addEventListener("click", () => { demo(); Retro.sfx("power"); });

  addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); togglePause(); }
    else if (e.key === "[") setBrush(brush - 1);
    else if (e.key === "]") setBrush(brush + 1);
    else if (/^[0-9]$/.test(e.key)) {
      // 1-9 pick the first nine materials, 0 is the eraser
      const d = DEFS.filter((x) => !x.hidden)[+e.key];
      if (d) selectElement(d.id);
    }
  });

  function clearAll() {
    type.fill(0); life.fill(0); extra.fill(0);
  }

  /** A little starter scene so the page isn't empty. */
  function demo() {
    clearAll();
    const put = (x, y, t) => { if (inside(x, y)) set(idx(x, y), t); };
    // floor + bowl
    for (let x = 0; x < W; x++) put(x, H - 1, E.WALL);
    for (let x = 20; x < 80; x++) put(x, 95, E.WALL);
    for (let y = 80; y < 96; y++) { put(20, y, E.WALL); put(79, y, E.WALL); }
    // water in bowl
    for (let y = 85; y < 95; y++) for (let x = 21; x < 79; x++) put(x, y, E.WATER);
    // sand pile
    for (let y = 0; y < 25; y++) for (let x = 100 - y; x < 100 + y; x++) if (Math.random() < 0.8) put(x, H - 2 - 25 + y, E.SAND);
    // wooden platform with gunpowder
    for (let x = 130; x < 185; x++) put(x, 70, E.WOOD);
    for (let y = 60; y < 70; y++) for (let x = 140; x < 175; x++) if (Math.random() < 0.85) put(x, y, E.GUNPOWDER);
    // lava falling onto the water side
    for (let y = 10; y < 20; y++) for (let x = 60; x < 70; x++) put(x, y, E.LAVA);
    // a fuse of oil to the gunpowder
    for (let x = 175; x < 195; x++) put(x, 69, E.OIL);
    for (let y = 40; y < 69; y++) put(194, y, E.WOOD);
    put(194, 39, E.FIRE);
    // plant + ice
    for (let x = 30; x < 36; x++) put(x, 84, E.PLANT);
    for (let x = 70; x < 78; x++) put(x, 84, E.ICE);
  }

  /* ---------- Main loop ---------- */
  let frames = 0, lastFps = performance.now();
  function loop(now) {
    if (mouse.down && !paused) paint(mouse.x, mouse.y, mouse.erase ? E.EMPTY : current); // keep pouring while held
    if (!paused) step();
    const count = render();
    frames++;
    if (now - lastFps > 500) {
      $("fps").textContent = Math.round((frames * 1000) / (now - lastFps));
      $("count").textContent = count;
      frames = 0;
      lastFps = now;
    }
    requestAnimationFrame(loop);
  }

  // test hooks
  window.game = {
    E, DEFS, W, H, step, demo, clearAll,
    place: (x, y, t) => set(idx(x, y), t),
    get: (x, y) => type[idx(x, y)],
    count: (t) => { let c = 0; for (let i = 0; i < N; i++) if (type[i] === t) c++; return c; },
    paint: (x, y, t, b) => { const old = brush; brush = b || brush; paint(x, y, t); brush = old; },
    get paused() { return paused; },
  };

  demo();
  requestAnimationFrame(loop);
})();
