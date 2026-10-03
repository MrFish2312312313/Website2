/* ==========================================================
   Animated thumbnails for hub cards (160x100 canvases).
   Previews.attach(canvas, kind, color)
   ========================================================== */
(function () {
  "use strict";

  const W = 160, H = 100;
  const active = [];

  const kinds = {
    /* Snake slithering around, eating dots */
    snake(g, color) {
      const S = 8, cols = W / S, rows = Math.floor(H / S);
      let body = [{ x: 5, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 6 }];
      let dir = { x: 1, y: 0 };
      let food = { x: 14, y: 4 };
      let tick = 0;
      return () => {
        if (++tick % 6 === 0) {
          const h = body[0];
          // simple chase AI
          const opts = [];
          if (food.x > h.x) opts.push({ x: 1, y: 0 });
          if (food.x < h.x) opts.push({ x: -1, y: 0 });
          if (food.y > h.y) opts.push({ x: 0, y: 1 });
          if (food.y < h.y) opts.push({ x: 0, y: -1 });
          const pick = opts.find((o) => !(o.x === -dir.x && o.y === -dir.y));
          if (pick) dir = pick;
          const nh = { x: (h.x + dir.x + cols) % cols, y: (h.y + dir.y + rows) % rows };
          body.unshift(nh);
          if (nh.x === food.x && nh.y === food.y) {
            food = { x: (Math.random() * cols) | 0, y: (Math.random() * rows) | 0 };
            if (body.length > 18) body = body.slice(0, 3);
          } else body.pop();
        }
        g.fillStyle = "#050a05";
        g.fillRect(0, 0, W, H);
        g.fillStyle = "#0f2a0f";
        for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) if ((x + y) % 2) g.fillRect(x * S, y * S, S, S);
        g.fillStyle = tick % 20 < 10 ? "#ff2e88" : "#ffe600";
        g.fillRect(food.x * S + 2, food.y * S + 2, S - 4, S - 4);
        body.forEach((p, i) => {
          g.fillStyle = i === 0 ? "#b6ff9e" : color;
          g.fillRect(p.x * S + 1, p.y * S + 1, S - 2, S - 2);
        });
      };
    },

    /* Little guy jumping between platforms collecting coins */
    platformer(g) {
      let t = 0;
      const plats = [[0, 84, 60], [70, 66, 40], [120, 48, 40]];
      return () => {
        t++;
        g.fillStyle = "#1a2a6c";
        g.fillRect(0, 0, W, H);
        // parallax hills
        g.fillStyle = "#2b3d8f";
        for (let i = 0; i < 6; i++) {
          const x = ((i * 50 - t * 0.3) % 300 + 300) % 300 - 40;
          g.beginPath();
          g.moveTo(x, H);
          g.lineTo(x + 30, 50);
          g.lineTo(x + 60, H);
          g.fill();
        }
        g.fillStyle = "#8b5a2b";
        plats.forEach(([x, y, w]) => g.fillRect(x, y, w, H - y));
        g.fillStyle = "#39ff14";
        plats.forEach(([x, y, w]) => g.fillRect(x, y, w, 4));
        // coins
        g.fillStyle = "#ffe600";
        [[90, 50], [140, 32]].forEach(([x, y], i) => {
          const wdt = Math.abs(Math.sin(t * 0.1 + i)) * 5 + 1;
          g.fillRect(x - wdt / 2, y + Math.sin(t * 0.08 + i) * 2, wdt, 6);
        });
        // hero path: loops across platforms
        const p = (t % 180) / 180;
        let x, y;
        if (p < 0.33) {
          const k = p / 0.33;
          x = 20 + k * 65; y = 76 - Math.sin(k * Math.PI) * 30 - k * 18;
        } else if (p < 0.66) {
          const k = (p - 0.33) / 0.33;
          x = 85 + k * 50; y = 58 - Math.sin(k * Math.PI) * 26 - k * 18;
        } else {
          const k = (p - 0.66) / 0.34;
          x = 135 - k * 115; y = 40 + k * 36 - Math.sin(k * Math.PI) * 20;
        }
        g.fillStyle = "#ff2e88";
        g.fillRect(x - 4, y - 8, 8, 8);
        g.fillStyle = "#fff";
        g.fillRect(x + 0, y - 6, 2, 2);
        g.fillStyle = "#00f0ff";
        g.fillRect(x - 4, y - 2, 8, 2);
      };
    },

    /* Mini falling sand */
    sandbox(g) {
      const w = 80, h = 50;
      const grid = new Uint8Array(w * h);
      const img = g.createImageData(w, h);
      const off = document.createElement("canvas");
      off.width = w; off.height = h;
      const og = off.getContext("2d");
      const pal = [[0, 0, 0], [230, 190, 90], [40, 120, 255], [130, 130, 140]];
      // a few stone ledges
      for (let x = 10; x < 35; x++) grid[30 * w + x] = 3;
      for (let x = 45; x < 70; x++) grid[38 * w + x] = 3;
      let t = 0;
      return () => {
        t++;
        if (t % 400 === 0) for (let i = 0; i < w * h; i++) if (grid[i] !== 3) grid[i] = 0;
        grid[1 * w + 20 + ((Math.random() * 4) | 0)] = 1;
        grid[1 * w + 58 + ((Math.random() * 4) | 0)] = 2;
        for (let y = h - 2; y >= 0; y--) {
          const ltr = Math.random() < 0.5;
          for (let i = 0; i < w; i++) {
            const x = ltr ? i : w - 1 - i;
            const k = y * w + x, v = grid[k];
            if (v !== 1 && v !== 2) continue;
            const below = k + w;
            const d = Math.random() < 0.5 ? -1 : 1;
            if (!grid[below]) { grid[below] = v; grid[k] = 0; }
            else if (x + d >= 0 && x + d < w && !grid[below + d]) { grid[below + d] = v; grid[k] = 0; }
            else if (v === 2 && x + d >= 0 && x + d < w && !grid[k + d]) { grid[k + d] = v; grid[k] = 0; }
          }
        }
        for (let i = 0; i < w * h; i++) {
          const c = pal[grid[i]];
          img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
        }
        og.putImageData(img, 0, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(off, 0, 0, W, H);
      };
    },

    /* Game of Life with glider gun-ish soup */
    life(g, color) {
      const w = 40, h = 25;
      let cells = new Uint8Array(w * h).map(() => (Math.random() < 0.3 ? 1 : 0));
      let t = 0;
      return () => {
        if (++t % 8 === 0) {
          const next = new Uint8Array(w * h);
          let alive = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if (dx || dy) n += cells[((y + dy + h) % h) * w + ((x + dx + w) % w)];
            }
            const c = cells[y * w + x];
            next[y * w + x] = (c && (n === 2 || n === 3)) || (!c && n === 3) ? 1 : 0;
            alive += next[y * w + x];
          }
          cells = alive < 40 ? next.map(() => (Math.random() < 0.3 ? 1 : 0)) : next;
        }
        g.fillStyle = "rgba(0,0,10,0.45)";
        g.fillRect(0, 0, W, H);
        g.fillStyle = color;
        for (let i = 0; i < w * h; i++) if (cells[i]) g.fillRect((i % w) * 4, ((i / w) | 0) * 4, 3, 3);
      };
    },

    /* NO SIGNAL: static, a blue box... and sometimes a face */
    nosignal(g) {
      const img = g.createImageData(W, H);
      let t = 0, flash = 0;
      return () => {
        t++;
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 140;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        if (flash > 0 || Math.random() < 0.006) {
          if (flash <= 0) flash = 4;
          flash--;
          // pale face with hollow eyes
          g.fillStyle = "#000";
          g.fillRect(0, 0, W, H);
          g.fillStyle = "#d8d4c8";
          g.beginPath(); g.ellipse(80, 52, 26, 40, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#000";
          g.beginPath(); g.ellipse(70, 44, 6, 9, 0, 0, Math.PI * 2); g.ellipse(90, 44, 6, 9, 0, 0, Math.PI * 2); g.fill();
          g.beginPath(); g.moveTo(64, 66); g.quadraticCurveTo(80, 84, 96, 66); g.quadraticCurveTo(80, 70, 64, 66); g.fill();
          return;
        }
        // faint face buried in the noise
        g.globalAlpha = 0.08 + Math.sin(t * 0.03) * 0.05;
        g.fillStyle = "#fff";
        g.beginPath(); g.ellipse(80, 50, 22, 32, 0, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = "#0000aa";
        g.fillRect(44, 40, 72, 20);
        g.fillStyle = Math.random() < 0.04 ? "#ff3030" : "#fff";
        g.font = "10px monospace";
        g.textAlign = "center";
        g.fillText(g.fillStyle === "#ff3030" ? "BEHIND YOU" : "NO SIGNAL", 80, 54);
        // rolling bar
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(0, (t * 1.5) % (H + 20) - 20, W, 14);
      };
    },

    /* TV static for empty slots */
    static(g) {
      const img = g.createImageData(W, H);
      let t = 0;
      return () => {
        if (++t % 3) return;
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 120;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        g.fillStyle = "#000";
        g.fillRect(44, 40, 72, 20);
        g.fillStyle = "#8a7fb0";
        g.font = "10px monospace";
        g.textAlign = "center";
        g.fillText("NO SIGNAL", 80, 54);
      };
    },

    /* Fallback: bouncing pixel logo */
    generic(g, color) {
      let x = 20, y = 20, vx = 1, vy = 0.8;
      return () => {
        x += vx; y += vy;
        if (x < 0 || x > W - 30) vx *= -1;
        if (y < 0 || y > H - 14) vy *= -1;
        g.fillStyle = "#000";
        g.fillRect(0, 0, W, H);
        g.fillStyle = color;
        g.fillRect(x, y, 30, 14);
      };
    },
  };

  function attach(canvas, kind, color) {
    const g = canvas.getContext("2d");
    const make = kinds[kind] || kinds.generic;
    active.push({ canvas, draw: make(g, color || "#00f0ff") });
  }

  function loop() {
    for (const p of active) {
      // Skip offscreen / hidden canvases to save CPU.
      if (!p.canvas.offsetParent) continue;
      const r = p.canvas.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      p.draw();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.Previews = { attach };
})();
