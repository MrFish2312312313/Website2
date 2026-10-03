/* ==========================================================
   PIXEL ARCADE — hub page logic
   ========================================================== */
(function () {
  "use strict";

  const games = window.ARCADE_GAMES || [];
  const $ = (sel) => document.querySelector(sel);

  /* ---------- Boot sequence ---------- */
  function boot() {
    const el = $("#boot");
    if (sessionStorage.getItem("pixelArcade.booted") || location.hash === "#noboot") {
      el.remove();
      return;
    }
    sessionStorage.setItem("pixelArcade.booted", "1");
    const lines = [
      "PIXEL ARCADE BIOS v1.0",
      "(C) 1987 NEON SYSTEMS INC.",
      "",
      "MEMORY TEST ........ 640K OK",
      "LOADING CARTRIDGES . " + games.length + " FOUND",
      "CALIBRATING CRT .... OK",
      "",
      "READY.",
    ];
    const text = $("#boot-text");
    const fill = $("#boot-fill");
    let i = 0;
    let done = false;
    const timer = setInterval(() => {
      if (i < lines.length) {
        text.textContent += lines[i++] + "\n";
        fill.style.width = Math.round((i / lines.length) * 100) + "%";
      } else {
        finish();
      }
    }, 180);
    function finish() {
      if (done) return;
      done = true;
      clearInterval(timer);
      el.classList.add("off");
      Retro.sfx("start");
      setTimeout(() => el.remove(), 600);
      window.removeEventListener("keydown", finish);
      el.removeEventListener("click", finish);
    }
    window.addEventListener("keydown", finish);
    el.addEventListener("click", finish);
  }

  /* ---------- Animated logo ---------- */
  function logo() {
    const el = $("#logo");
    const txt = el.textContent;
    el.textContent = "";
    [...txt].forEach((c, i) => {
      const s = document.createElement("span");
      s.className = "ch";
      s.textContent = c === " " ? " " : c;
      s.style.animationDelay = i * 0.08 + "s";
      el.appendChild(s);
    });
    // Random glitch bursts
    setInterval(() => {
      if (Math.random() < 0.35) {
        el.classList.add("glitch");
        setTimeout(() => el.classList.remove("glitch"), 90 + Math.random() * 160);
      }
    }, 1400);
  }

  /* ---------- Typewriter tagline ---------- */
  function typer() {
    const el = $("#typer");
    const phrases = [
      "SELECT YOUR GAME, PLAYER ONE",
      "NOW WITH 100% MORE PIXELS",
      "HIGH SCORES ARE SAVED LOCALLY",
      "TRY THE KONAMI CODE...",
      "DO NOT PLAY NO SIGNAL ALONE",
    ];
    let p = 0, c = 0, deleting = false;
    function step() {
      const word = phrases[p];
      if (!deleting) {
        el.textContent = word.slice(0, ++c);
        if (c === word.length) { deleting = true; return setTimeout(step, 1800); }
      } else {
        el.textContent = word.slice(0, --c);
        if (c === 0) { deleting = false; p = (p + 1) % phrases.length; }
      }
      setTimeout(step, deleting ? 30 : 65);
    }
    step();
  }

  /* ---------- Starfield ---------- */
  function stars() {
    const cv = $("#stars");
    const g = cv.getContext("2d");
    let w, h, list;
    function resize() {
      w = cv.width = Math.ceil(innerWidth / 2);
      h = cv.height = Math.ceil(innerHeight / 2);
      list = Array.from({ length: 140 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.9 + 0.1,
        t: Math.random() * Math.PI * 2,
      }));
    }
    resize();
    addEventListener("resize", resize);
    const colors = ["#ffffff", "#00f0ff", "#ff2e88", "#ffe600"];
    function frame() {
      g.clearRect(0, 0, w, h);
      for (const s of list) {
        s.x -= s.z * 0.35;
        s.t += 0.05;
        if (s.x < 0) { s.x = w; s.y = Math.random() * h; }
        const a = 0.4 + Math.sin(s.t) * 0.3 + s.z * 0.3;
        g.globalAlpha = Math.max(0, Math.min(1, a));
        g.fillStyle = colors[(s.z * 10 | 0) % colors.length];
        const size = s.z > 0.8 ? 2 : 1;
        g.fillRect(s.x | 0, s.y | 0, size, size);
      }
      g.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---------- Cards ---------- */
  const grid = $("#grid");
  const cards = [];

  function makeCard(game, index) {
    const a = document.createElement("a");
    a.className = "card";
    a.href = game.path;
    a.style.setProperty("--c", game.color);
    a.style.setProperty("--i", index);
    if (game.theme) a.classList.add(game.theme);
    a.dataset.type = game.type;
    a.dataset.search = (game.title + " " + game.description + " " + game.tags.join(" ")).toLowerCase();
    const high = Retro.getHigh(game.id);
    a.innerHTML = `
      <div class="label"><span>${game.type === "game" ? "GAME" : "TOY"}</span><span>#${String(index + 1).padStart(2, "0")}</span></div>
      <div class="screen"><canvas width="160" height="100"></canvas></div>
      <div class="body">
        <h2></h2>
        <p></p>
        <div class="tags">${game.tags.map((t) => `<span class="tag">${t.toUpperCase()}</span>`).join("")}</div>
        <div class="foot"><span>${game.type === "game" ? "HI " + Retro.pad(high) : "&#9733; SANDBOX"}</span><span class="play">PLAY &#9654;</span></div>
      </div>`;
    a.querySelector("h2").textContent = game.title;
    a.querySelector("p").textContent = game.description;

    // After the entrance animation, release `transform` so the tilt effect works.
    a.addEventListener("animationend", () => {
      a.style.animation = game.theme === "horror" ? "horror-flicker 4s infinite" : "none";
    }, { once: true });

    a.addEventListener("mouseenter", () => Retro.sfx(game.theme === "horror" ? "hurt" : "hover"));
    a.addEventListener("mousemove", (e) => {
      const r = a.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      a.style.transform = `perspective(700px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-6px)`;
    });
    a.addEventListener("mouseleave", () => { a.style.transform = ""; });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      Retro.sfx("click");
      wipeTo(game.path);
    });

    const canvas = a.querySelector("canvas");
    window.Previews.attach(canvas, game.preview, game.color);
    return a;
  }

  function buildGrid() {
    games.forEach((g, i) => {
      const c = makeCard(g, i);
      cards.push(c);
      grid.appendChild(c);
    });
  }

  /* ---------- Filtering ---------- */
  let filter = "all";
  function applyFilter() {
    const q = $("#search").value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((c) => {
      const typeOk = filter === "all" || c.dataset.type === filter;
      const textOk = !q || c.dataset.search.includes(q);
      const show = typeOk && textOk;
      c.classList.toggle("hidden", !show);
      if (show) shown++;
    });
    $("#empty").classList.toggle("hidden", shown > 0);
  }
  function filters() {
    document.querySelectorAll("[data-filter]").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("[data-filter]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        filter = b.dataset.filter;
        Retro.sfx("click");
        applyFilter();
      });
    });
    $("#search").addEventListener("input", applyFilter);
  }

  /* ---------- Toggles ---------- */
  function toggles() {
    const s = $("#toggle-sound");
    const c = $("#toggle-crt");
    const render = () => {
      s.textContent = "SFX: " + (Retro.settings.sound ? "ON" : "OFF");
      c.textContent = "CRT: " + (Retro.settings.crt ? "ON" : "OFF");
    };
    s.addEventListener("click", () => { Retro.setSetting("sound", !Retro.settings.sound); render(); Retro.sfx("click"); });
    c.addEventListener("click", () => { Retro.setSetting("crt", !Retro.settings.crt); render(); Retro.sfx("click"); });
    render();
  }

  /* ---------- High score ticker ---------- */
  function ticker() {
    const parts = games
      .filter((g) => g.type === "game")
      .map((g) => `<span>${g.title.toUpperCase()} HI-SCORE <em>${Retro.pad(Retro.getHigh(g.id))}</em></span>`);
    parts.push("<span>&#9733; WELCOME TO PIXEL ARCADE &#9733;</span>");
    parts.push(`<span>${games.length} CARTRIDGES LOADED</span>`);
    $("#ticker").innerHTML = parts.join("");
  }

  /* ---------- Pixel wipe transition ---------- */
  function wipeTo(url) {
    const w = $("#wipe");
    if (!w.children.length) {
      for (let i = 0; i < 96; i++) w.appendChild(document.createElement("i"));
    }
    [...w.children].forEach((cell, i) => {
      const col = i % 12, row = (i / 12) | 0;
      cell.style.transitionDelay = (col + row) * 18 + "ms";
    });
    requestAnimationFrame(() => w.classList.add("on"));
    setTimeout(() => { location.href = url; }, 520);
  }
  // Reset the wipe if the user navigates back (bfcache).
  addEventListener("pageshow", () => $("#wipe").classList.remove("on"));

  /* ---------- Konami code ---------- */
  function konami() {
    const code = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let pos = 0;
    addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      pos = e.key === code[pos] ? pos + 1 : e.key === code[0] ? 1 : 0;
      if (pos === code.length) {
        pos = 0;
        document.body.classList.toggle("rainbow");
        Retro.sfx("power");
      }
    });
  }

  boot();
  logo();
  typer();
  stars();
  buildGrid();
  filters();
  toggles();
  ticker();
  konami();
})();
