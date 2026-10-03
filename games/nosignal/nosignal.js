/* ==========================================================
   NO SIGNAL
   Keep the old TV tuned from 3:00 to 4:00 AM.
   Something lives in the static between the channels.
   ========================================================== */
(function () {
  "use strict";

  const SW = 320, SH = 240;              // screen resolution
  const NIGHT = 300;                      // seconds of real time for 3:00 -> 4:00 AM
  const $ = (id) => document.getElementById(id);

  const screen = $("screen");
  const sg = screen.getContext("2d");
  const tv = document.createElement("canvas");      // station picture
  tv.width = SW; tv.height = SH;
  const tg = tv.getContext("2d");
  const nz = document.createElement("canvas");      // static noise
  nz.width = SW; nz.height = SH;
  const ng = nz.getContext("2d");
  const noiseImg = ng.createImageData(SW, SH);
  const noiseBuf = new Uint32Array(noiseImg.data.buffer);

  /* ---------- Story / rules shown on the emergency channel ---------- */
  const EAS_LINES = [
    { t: 0,   text: "THIS IS NOT A TEST. REMAIN INDOORS. REMAIN TUNED." },
    { t: 20,  text: "RULE ONE. KEEP THE SIGNAL. IT LIVES IN THE STATIC." },
    { t: 45,  text: "RULE TWO. IF THE PICTURE SMILES AT YOU, CHANGE THE CHANNEL." },
    { t: 90,  text: "RULE THREE. WHATEVER YOU HEAR, DO NOT TURN AROUND." },
    { t: 140, text: "WE HAVE LOST CONTACT WITH CAMERA FOUR." },
    { t: 190, text: "IT IS INSIDE THE HOUSE. DO NOT LOOK AWAY FROM THE SCREEN." },
    { t: 240, text: "BROADCAST RESUMES AT FOUR A.M. HOLD ON." },
  ];

  const STATIONS = [
    { id: "weather", name: "WTHR 6", glow: "60, 110, 220" },
    { id: "kids",    name: "SUNNY TIME", glow: "230, 190, 60" },
    { id: "eas",     name: "EMERGENCY", glow: "200, 30, 30" },
    { id: "bars",    name: "TEST SIGNAL", glow: "170, 170, 200" },
    { id: "cam",     name: "CAM 04", glow: "90, 140, 100" },
  ];

  /* ---------- State ---------- */
  const game = {
    state: "title",     // title | intro | play | paused | dying | dead | won
    time: 0,            // seconds since 3:00
    dial: 6,            // 0..100
    dread: 0,           // 0..100
    cause: "static",
    stations: [],
    hijack: null,       // { station, until }
    turn: null,         // { until }
    blackout: 0,        // seconds remaining
    flickerStation: null,
    next: {},           // scheduled event times
    easSpoken: -1,
    calm: false,
    frame: 0,
  };
  window.game = game;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  const progress = () => clamp(game.time / NIGHT, 0, 1);

  function reset() {
    const base = [14, 32, 51, 70, 88];
    game.stations = STATIONS.map((s, i) => ({ ...s, f: base[i] + rand(-3, 3), v: 0, fade: 0 }));
    // shuffle positions so the layout differs each night
    const fs = game.stations.map((s) => s.f).sort(() => Math.random() - 0.5);
    game.stations.forEach((s, i) => { s.f = fs[i]; });
    game.time = 0;
    game.dial = 2;
    game.dread = 0;
    game.cause = "static";
    game.hijack = null;
    game.turn = null;
    game.blackout = 0;
    game.easSpoken = -1;
    game.next = {
      jump: 30 + rand(0, 10),
      hijack: 50 + rand(0, 15),
      turn: 95 + rand(0, 20),
      blackout: 60 + rand(0, 20),
      whisper: 25 + rand(0, 15),
    };
    $("turn").classList.add("hidden");
  }

  /** Signal lock: which station is tuned, and how cleanly. */
  function tuned() {
    let best = null, sig = 0;
    for (const s of game.stations) {
      let v = clamp(1 - Math.abs(game.dial - s.f) / 2.6, 0, 1);
      if (s.fade > 0) v *= 0.35 + Math.random() * 0.4;   // station about to drop out
      if (v > sig) { sig = v; best = s; }
    }
    if (game.state === "won") return { station: game.stations.find((s) => s.id === "eas"), signal: 1 };
    return { station: best, signal: sig };
  }

  /* ======================================================
     AUDIO (all synthesized)
     ====================================================== */
  const A = {
    ctx: null,
    init() {
      if (this.ctx) { this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(c.destination);

      // white noise buffer reused everywhere
      const len = c.sampleRate * 2;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // static hiss
      const st = c.createBufferSource();
      st.buffer = this.noiseBuf;
      st.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 600;
      this.staticGain = c.createGain();
      this.staticGain.gain.value = 0;
      st.connect(hp).connect(this.staticGain).connect(this.master);
      st.start();

      // low dread drone
      this.droneGain = c.createGain();
      this.droneGain.gain.value = 0;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 220;
      [[41.2, "sawtooth"], [55, "sine"], [55.8, "sine"], [82.4, "triangle"]].forEach(([f, type]) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.connect(lp);
        o.start();
      });
      lp.connect(this.droneGain).connect(this.master);

      // emergency alert two-tone (853 + 960 Hz) — the real EAS attention signal
      this.easGain = c.createGain();
      this.easGain.gain.value = 0;
      const elp = c.createBiquadFilter();
      elp.type = "lowpass";
      elp.frequency.value = 2500;
      [853, 960].forEach((f) => {
        const o = c.createOscillator();
        o.type = "square";
        o.frequency.value = f;
        o.connect(elp);
        o.start();
      });
      elp.connect(this.easGain).connect(this.master);

      // test-pattern 1 kHz tone
      this.barsGain = c.createGain();
      this.barsGain.gain.value = 0;
      const bo = c.createOscillator();
      bo.frequency.value = 1000;
      bo.connect(this.barsGain).connect(this.master);
      bo.start();

      // camera room hum
      this.humGain = c.createGain();
      this.humGain.gain.value = 0;
      const ho = c.createOscillator();
      ho.type = "sawtooth";
      ho.frequency.value = 60;
      const hlp = c.createBiquadFilter();
      hlp.type = "lowpass";
      hlp.frequency.value = 180;
      ho.connect(hlp).connect(this.humGain).connect(this.master);
      ho.start();

      // music bus (station melodies)
      this.musicGain = c.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);
    },
    set(param, value, speed) {
      if (!this.ctx) return;
      param.setTargetAtTime(value, this.ctx.currentTime, speed || 0.05);
    },
    note(freq, dur, type, vol, detuneCents) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator();
      const gn = c.createGain();
      o.type = type || "triangle";
      o.frequency.value = freq;
      o.detune.value = detuneCents || 0;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(this.musicGain);
      o.start(t);
      o.stop(t + dur + 0.05);
    },
    heartbeat(vol) {
      if (!this.ctx) return;
      const c = this.ctx;
      [0, 0.22].forEach((off, i) => {
        const t = c.currentTime + off;
        const o = c.createOscillator();
        const gn = c.createGain();
        o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(vol * (i ? 0.7 : 1), t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(gn).connect(this.master);
        o.start(t);
        o.stop(t + 0.3);
      });
    },
    whisper(pan, dur) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      dur = dur || 1.8;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = rand(1400, 2600);
      bp.Q.value = 3;
      const gn = c.createGain();
      // syllable-like amplitude pattern
      const curve = new Float32Array(48);
      for (let i = 0; i < curve.length; i++) {
        const env = Math.sin((i / (curve.length - 1)) * Math.PI);
        curve[i] = env * (Math.random() < 0.6 ? rand(0.2, 0.55) : 0.02);
      }
      gn.gain.setValueCurveAtTime(curve, t, dur);
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      if (p) p.pan.value = pan;
      src.connect(bp).connect(gn);
      (p ? gn.connect(p) : gn).connect(this.master);
      src.start(t, rand(0, 1));
      src.stop(t + dur + 0.1);
    },
    thud() {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator();
      const gn = c.createGain();
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      gn.gain.setValueAtTime(0.5, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(gn).connect(this.master);
      o.start(t);
      o.stop(t + 0.8);
    },
    screech(dur) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const shaper = c.createWaveShaper();
      const k = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; k[i] = Math.tanh(x * 6); }
      shaper.curve = k;
      const gn = c.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.55, t + 0.03);
      gn.gain.setValueAtTime(0.55, t + dur - 0.3);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      shaper.connect(gn).connect(this.master);
      for (let i = 0; i < 4; i++) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        const f0 = rand(300, 700);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * rand(2, 3.5), t + dur * 0.4);
        o.frequency.exponentialRampToValueAtTime(f0 * rand(1.2, 2), t + dur);
        const og = c.createGain();
        og.gain.value = 0.25;
        o.connect(og).connect(shaper);
        o.start(t);
        o.stop(t + dur);
      }
      const n = c.createBufferSource();
      n.buffer = this.noiseBuf;
      const ng2 = c.createGain();
      ng2.gain.value = 0.6;
      n.connect(ng2).connect(shaper);
      n.start(t);
      n.stop(t + dur);
    },
    silence() {
      if (!this.ctx) return;
      [this.staticGain, this.droneGain, this.easGain, this.barsGain, this.humGain, this.musicGain]
        .forEach((p) => this.set(p.gain, 0, 0.02));
    },
  };

  /* ---------- Creepy text-to-speech (optional) ---------- */
  function say(text, opts) {
    if (!("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = (opts && opts.rate) || 0.72;
      u.pitch = (opts && opts.pitch) || 0.1;
      u.volume = (opts && opts.volume) || 0.9;
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => /en/i.test(x.lang) && /david|male|guy|mark/i.test(x.name)) ||
                voices.find((x) => /en/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* speech is optional */ }
  }
  function hush() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  /* ======================================================
     DRAWING HELPERS
     ====================================================== */

  /** The thing in the static. */
  function drawFace(c, cx, cy, s, o) {
    o = o || {};
    const w = s * 0.62, h = s;
    const grin = o.grin === undefined ? 0.4 : o.grin;
    c.save();
    c.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
    // dark hair / shadow behind
    c.fillStyle = "#000";
    c.beginPath();
    c.ellipse(cx, cy - h * 0.06, w * 0.62, h * 0.64, 0, 0, Math.PI * 2);
    c.fill();
    // pale face
    const grd = c.createRadialGradient(cx, cy - h * 0.12, s * 0.04, cx, cy, h * 0.62);
    grd.addColorStop(0, o.tint || "#f1eee4");
    grd.addColorStop(0.65, "#a9a596");
    grd.addColorStop(1, "#1c1b18");
    c.fillStyle = grd;
    c.beginPath();
    c.ellipse(cx, cy, w * 0.5, h * 0.52, 0, 0, Math.PI * 2);
    c.fill();
    // hollow eyes
    const ey = cy - h * 0.1, ex = w * 0.2, er = w * 0.105 * (o.wide ? 1.35 : 1);
    c.fillStyle = "#000";
    c.beginPath();
    c.ellipse(cx - ex, ey, er, er * 1.6, 0.12, 0, Math.PI * 2);
    c.ellipse(cx + ex, ey, er, er * 1.6, -0.12, 0, Math.PI * 2);
    c.fill();
    if (o.bleed) {
      c.fillStyle = "#300";
      c.fillRect(cx - ex - 1, ey + er, Math.max(1, s * 0.015), h * 0.22);
      c.fillRect(cx + ex, ey + er, Math.max(1, s * 0.015), h * 0.3);
    }
    if (o.pupils !== false) {
      c.fillStyle = "#fff";
      const ps = Math.max(1, s * 0.02);
      c.fillRect(cx - ex - ps / 2, ey - ps / 2, ps, ps);
      c.fillRect(cx + ex - ps / 2, ey - ps / 2, ps, ps);
    }
    // mouth: corners pull up as the grin widens
    const my = cy + h * 0.2, mw = w * (0.18 + grin * 0.3);
    const lift = grin * h * 0.09;
    c.fillStyle = "#000";
    c.beginPath();
    c.moveTo(cx - mw, my - lift);
    c.quadraticCurveTo(cx, my + h * (0.03 + grin * 0.26 + (o.open || 0) * 0.3), cx + mw, my - lift);
    c.quadraticCurveTo(cx, my + h * 0.02, cx - mw, my - lift);
    c.fill();
    if (grin > 0.45) {
      c.fillStyle = "#d9d4bf";
      const n = 9, tw = Math.max(1, s * 0.022);
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const tx = cx - mw * 0.82 + k * mw * 1.64;
        const ty = my - lift * (1 - Math.sin(k * Math.PI)) + h * 0.02 + Math.sin(k * Math.PI) * h * 0.01;
        c.fillRect(tx - tw / 2, ty, tw, Math.max(2, s * 0.05));
      }
    }
    c.restore();
  }

  /** Tall thin silhouette. */
  function drawFigure(c, x, footY, height, color, alpha, faceAlpha) {
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = color;
    const head = height * 0.09;
    const sh = height * 0.2;
    // legs
    c.fillRect(x - sh * 0.35, footY - height * 0.45, sh * 0.22, height * 0.45);
    c.fillRect(x + sh * 0.13, footY - height * 0.45, sh * 0.22, height * 0.45);
    // torso
    c.beginPath();
    c.moveTo(x - sh * 0.5, footY - height * 0.8);
    c.lineTo(x + sh * 0.5, footY - height * 0.8);
    c.lineTo(x + sh * 0.35, footY - height * 0.42);
    c.lineTo(x - sh * 0.35, footY - height * 0.42);
    c.fill();
    // long arms
    c.fillRect(x - sh * 0.62, footY - height * 0.79, sh * 0.14, height * 0.52);
    c.fillRect(x + sh * 0.48, footY - height * 0.79, sh * 0.14, height * 0.52);
    // neck + head
    c.fillRect(x - head * 0.2, footY - height * 0.86, head * 0.4, height * 0.08);
    c.beginPath();
    c.ellipse(x, footY - height * 0.9, head * 0.55, head * 0.75, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    if (faceAlpha > 0) drawFace(c, x, footY - height * 0.9, head * 1.4, { alpha: faceAlpha, grin: 0.9 });
  }

  function text(c, str, x, y, size, color, align) {
    c.font = size + "px 'VT323', monospace";
    c.textAlign = align || "left";
    c.fillStyle = "#000";
    c.fillText(str, x + 1, y + 1);
    c.fillStyle = color;
    c.fillText(str, x, y);
    c.textAlign = "left";
  }

  function wrap(c, str, maxW) {
    const words = str.split(" "), lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* ======================================================
     STATIONS
     ====================================================== */
  const DRAW = {
    weather(c, t, hj) {
      const grd = c.createLinearGradient(0, 0, 0, SH);
      grd.addColorStop(0, hj ? "#1a0c2a" : "#0b2a6b");
      grd.addColorStop(1, hj ? "#000" : "#2457b5");
      c.fillStyle = grd;
      c.fillRect(0, 0, SW, SH);
      // state map blob
      c.fillStyle = hj ? "#2d2a24" : "#3a8a3a";
      c.beginPath();
      c.moveTo(60, 70); c.lineTo(150, 55); c.lineTo(230, 68); c.lineTo(250, 120);
      c.lineTo(210, 175); c.lineTo(120, 182); c.lineTo(70, 150); c.lineTo(50, 105);
      c.closePath();
      c.fill();
      if (hj) {
        drawFace(c, 152, 118, 120, { grin: 0.95, wide: true, tint: "#d8d0b8" });
      } else {
        // rotating storm cell
        for (let i = 0; i < 3; i++) {
          c.strokeStyle = ["#fff", "#ccd", "#99a"][i];
          c.beginPath();
          c.arc(170, 110, 14 + i * 7, t * 1.5 + i, t * 1.5 + i + 4);
          c.stroke();
        }
        text(c, "31°", 92, 120, 22, "#fff");
        text(c, "28°", 200, 160, 18, "#fff");
      }
      c.fillStyle = hj ? "#400" : "#c21d1d";
      c.fillRect(0, 0, SW, 22);
      text(c, "WTHR 6  STORM WATCH", 8, 16, 16, "#fff");
      c.fillStyle = "#000a";
      c.fillRect(0, SH - 22, SW, 22);
      const crawl = hj
        ? "SMILE  SMILE  SMILE  SMILE  SMILE  SMILE  SMILE  SMILE  "
        : "SEVERE STORM WARNING UNTIL 4 AM ... POWER OUTAGES REPORTED ... NO ONE IS OUTSIDE ... STAY IN YOUR HOMES ... ";
      c.font = "16px 'VT323', monospace";
      const w = c.measureText(crawl).width;
      const off = (t * 45) % w;
      text(c, crawl + crawl, SW - off - w / 2, SH - 6, 16, hj ? "#f33" : "#fff");
    },

    kids(c, t, hj) {
      c.fillStyle = hj ? "#2a0000" : "#ffd23f";
      c.fillRect(0, 0, SW, SH);
      // rays
      c.save();
      c.translate(160, 120);
      c.rotate(t * (hj ? -0.1 : 0.3));
      c.fillStyle = hj ? "#400" : "#ffb703";
      for (let i = 0; i < 12; i++) {
        c.rotate(Math.PI / 6);
        c.beginPath();
        c.moveTo(0, 0); c.lineTo(-16, -200); c.lineTo(16, -200);
        c.fill();
      }
      c.restore();
      const bob = Math.sin(t * 3) * 4;
      if (hj) {
        drawFace(c, 160, 118, 130, { grin: 1, wide: true, bleed: true, tint: "#f4d98a" });
      } else {
        c.fillStyle = "#ff8c00";
        c.beginPath(); c.arc(160, 118 + bob, 52, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#ffe066";
        c.beginPath(); c.arc(160, 118 + bob, 46, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#222";
        c.beginPath(); c.arc(143, 108 + bob, 6, 0, Math.PI * 2); c.arc(177, 108 + bob, 6, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#222";
        c.lineWidth = 4;
        c.beginPath(); c.arc(160, 122 + bob, 20, 0.2, Math.PI - 0.2); c.stroke();
        c.lineWidth = 1;
        c.fillStyle = "#f88";
        c.fillRect(126, 122 + bob, 10, 5); c.fillRect(184, 122 + bob, 10, 5);
      }
      text(c, hj ? "SMILE BACK" : "SUNNY TIME!", 160, 34, 28, hj ? "#f22" : "#e63946", "center");
      text(c, hj ? "IT'S RIGHT BEHIND YOU" : "SING ALONG, FRIENDS!", 160, 216, 18, hj ? "#a00" : "#1d3557", "center");
    },

    eas(c, t) {
      c.fillStyle = "#000";
      c.fillRect(0, 0, SW, SH);
      const flash = Math.floor(t * 2) % 2 === 0;
      c.fillStyle = flash ? "#b00000" : "#700000";
      c.fillRect(0, 10, SW, 30);
      text(c, "EMERGENCY ALERT SYSTEM", 160, 32, 20, "#fff", "center");
      const line = currentEas();
      c.font = "20px 'VT323', monospace";
      const lines = wrap(c, line.text, SW - 40);
      lines.forEach((l, i) => text(c, l, 160, 90 + i * 22, 20, "#f2f2f2", "center"));
      text(c, "STAY TUNED. DO NOT LEAVE THE SIGNAL.", 160, 210, 16, "#888", "center");
      // tiny countdown to keep the clock visible
      text(c, clockString(), 160, 228, 14, "#555", "center");
    },

    bars(c, t, hj) {
      const cols = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
      const bw = SW / 7;
      cols.forEach((col, i) => {
        c.fillStyle = hj ? desat(col) : col;
        c.fillRect(i * bw, 0, bw + 1, SH * 0.67);
      });
      const rev = ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"];
      rev.forEach((col, i) => { c.fillStyle = hj ? desat(col) : col; c.fillRect(i * bw, SH * 0.67, bw + 1, SH * 0.08); });
      c.fillStyle = "#101010";
      c.fillRect(0, SH * 0.75, SW, SH * 0.25);
      if (hj) {
        const a = clamp((game.hijack.until - game.time) < 13 ? 1 : 0.6, 0, 1);
        drawFace(c, 160, 100, 140, { grin: 0.85, alpha: a, wide: true });
      }
      c.fillStyle = "#000";
      c.fillRect(70, 186, 180, 26);
      text(c, hj ? "PLEASE SMILE" : "PLEASE STAND BY", 160, 205, 20, "#fff", "center");
    },

    cam(c, t, hj) {
      // night-vision security camera of YOUR living room
      c.fillStyle = "#0b120c";
      c.fillRect(0, 0, SW, SH);
      // floor perspective
      c.strokeStyle = "#16241a";
      for (let i = -6; i <= 6; i++) {
        c.beginPath(); c.moveTo(160 + i * 18, 110); c.lineTo(160 + i * 60, SH); c.stroke();
      }
      for (let y = 110; y < SH; y += 14 + (y - 110) * 0.2) {
        c.beginPath(); c.moveTo(0, y); c.lineTo(SW, y); c.stroke();
      }
      // back wall + doorway
      c.fillStyle = "#132017";
      c.fillRect(0, 20, SW, 90);
      c.fillStyle = "#020302";
      c.fillRect(214, 34, 36, 76);
      // window with rain
      c.fillStyle = "#1a2c20";
      c.fillRect(40, 40, 60, 40);
      c.strokeStyle = "#2f4a36";
      for (let i = 0; i < 6; i++) {
        const rx = 40 + ((i * 13 + t * 30) % 60);
        c.beginPath(); c.moveTo(rx, 40 + ((t * 80 + i * 17) % 30)); c.lineTo(rx - 2, 50 + ((t * 80 + i * 17) % 30)); c.stroke();
      }
      // the TV glow + you in the chair
      const glow = c.createRadialGradient(150, 175, 4, 150, 175, 70);
      glow.addColorStop(0, "rgba(160,220,170,0.45)");
      glow.addColorStop(1, "rgba(160,220,170,0)");
      c.fillStyle = glow;
      c.fillRect(70, 110, 160, 130);
      c.fillStyle = "#9fd3a8";
      c.fillRect(132, 160, 36, 26);       // TV
      c.fillStyle = "#050805";
      c.fillRect(128, 186, 44, 6);
      // chair + head silhouette (facing the TV, away from camera)
      c.fillStyle = "#040604";
      c.fillRect(126, 196, 48, 30);
      c.beginPath(); c.ellipse(150, 192, 11, 13, 0, 0, Math.PI * 2); c.fill();

      // the figure creeps closer through the night
      const p = progress();
      if (hj) {
        drawFigure(c, 182, 232, 190, "#000", 1, 0);
        drawFace(c, 182, 64, 52, { grin: 1, wide: true });
      } else if (p > 0.22) {
        let fx, fy, fh, a;
        if (p < 0.45) { fx = 232; fy = 110; fh = 70; a = 0.55; }
        else if (p < 0.7) { fx = 205; fy = 160; fh = 110; a = 0.85; }
        else { fx = 172; fy = 214; fh = 150; a = 1; }
        // it twitches
        if (Math.random() < 0.03) fx += rand(-3, 3);
        drawFigure(c, fx, fy, fh, "#000", a, 0);
      }
      text(c, "CAM 04  LIVING RM", 8, 16, 16, "#c8f0cf");
      if (Math.floor(t * 1.5) % 2) {
        c.fillStyle = "#e00";
        c.beginPath(); c.arc(270, 11, 4, 0, Math.PI * 2); c.fill();
        text(c, "REC", 278, 16, 16, "#c8f0cf");
      }
      text(c, "OCT 03  " + clockString(true), 8, 230, 16, "#c8f0cf");
    },
  };

  function desat(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const v = Math.round((r + g + b) / 3 * 0.6);
    return `rgb(${v},${v * 0.9 | 0},${v * 0.9 | 0})`;
  }

  function currentEas() {
    let line = EAS_LINES[0], idx = 0;
    EAS_LINES.forEach((l, i) => { if (game.time >= l.t) { line = l; idx = i; } });
    if (game.state === "won") return { text: "BROADCAST RESTORED. GOOD MORNING.", idx: 99 };
    return { text: line.text, idx };
  }

  function clockString(seconds) {
    const mins = Math.min(60, Math.floor((game.time / NIGHT) * 60));
    const h = mins >= 60 ? 4 : 3;
    const m = mins % 60;
    let s = h + ":" + String(m).padStart(2, "0");
    if (seconds) s += ":" + String(Math.floor(((game.time / NIGHT) * 3600) % 60)).padStart(2, "0");
    return s + " AM";
  }

  /* ======================================================
     STATIC + COMPOSITING
     ====================================================== */
  let seed = 1234567;
  function fillNoise(dark) {
    // xorshift: much faster than Math.random for 76k pixels
    const n = noiseBuf.length;
    for (let i = 0; i < n; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      let v = (seed >>> 24) & 255;
      if (dark) v = (v * v) >> 9;
      noiseBuf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
    }
    ng.putImageData(noiseImg, 0, 0);
  }

  const osd = { dial: -1, until: 0 };
  const NOSIG_TEXT = ["NO SIGNAL", "NO SIGNAL", "NO ESCAPE", "I SEE YOU", "LET ME IN", "BEHIND YOU", "TURN AROUND", "NO SIGNAL"];

  function render() {
    const t = game.time;
    const { station, signal } = tuned();
    const hj = game.hijack && station && game.hijack.station === station.id && signal > 0.3;
    const d = game.dread / 100;

    if (game.blackout > 0) return drawBlackout();

    // 1. station picture
    if (station && signal > 0.05) DRAW[station.id](tg, t, hj);
    else { tg.fillStyle = "#000"; tg.fillRect(0, 0, SW, SH); }

    // 2. compose with tearing
    sg.fillStyle = "#000";
    sg.fillRect(0, 0, SW, SH);
    const noiseAmt = signal >= 0.98 ? 0.04 : clamp(1.05 - signal, 0, 1);
    const tear = (1 - signal) * 22 + d * 3;
    if (tear > 0.5) {
      for (let y = 0; y < SH; y += 4) {
        const off = (Math.sin(y * 0.09 + t * 7) * 0.6 + (Math.random() - 0.5)) * tear;
        sg.drawImage(tv, 0, y, SW, 4, off, y, SW, 4);
      }
    } else {
      sg.drawImage(tv, 0, 0);
    }

    // 3. static
    fillNoise(false);
    sg.globalAlpha = noiseAmt;
    sg.drawImage(nz, 0, 0);
    sg.globalAlpha = 1;

    // 4. the face in the static
    if (signal < 0.75 && game.state === "play") {
      const fa = (1 - signal) * (0.06 + d * 0.8);
      const size = 70 + d * 230;
      const drift = Math.sin(t * 0.7) * 10 * (1 - d);
      drawFace(sg, 160 + drift, 118 + d * 20, size, { alpha: fa, grin: 0.3 + d * 0.7, wide: d > 0.6 });
      // re-bury it in noise so it is only half-visible
      sg.globalAlpha = noiseAmt * 0.45;
      sg.drawImage(nz, 0, 0);
      sg.globalAlpha = 1;
      // subliminal single-frame flashes when dread is high
      if (!game.calm && d > 0.55 && Math.random() < 0.012 + d * 0.02) {
        sg.fillStyle = "#000";
        sg.fillRect(0, 0, SW, SH);
        drawFace(sg, 160, 128, 260, { grin: 1, wide: true });
      }
    }

    // 5. "NO SIGNAL" box
    if (signal < 0.3 && game.state === "play") {
      const k = d > 0.35 && Math.random() < d * 0.12 ? (Math.random() * NOSIG_TEXT.length) | 0 : 0;
      const label = NOSIG_TEXT[k];
      sg.fillStyle = "#0000aa";
      sg.fillRect(100, 104, 120, 30);
      sg.strokeStyle = "#fff";
      sg.strokeRect(102.5, 106.5, 115, 25);
      text(sg, label, 160, 125, 22, k ? "#ff4040" : "#fff", "center");
    }

    // 6. rolling hum bar
    const barY = ((t * 40) % (SH + 80)) - 40;
    const bar = sg.createLinearGradient(0, barY - 30, 0, barY + 30);
    bar.addColorStop(0, "rgba(0,0,0,0)");
    bar.addColorStop(0.5, `rgba(0,0,0,${0.18 + (1 - signal) * 0.2})`);
    bar.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = bar;
    sg.fillRect(0, barY - 30, SW, 60);

    // 7. VCR on-screen display
    if (game.dial !== osd.dial) { osd.dial = game.dial; osd.until = t + 2.5; }
    if ((game.state === "play" || game.state === "paused") && (t < osd.until || signal < 0.3 || game.state === "paused")) {
      const mhz = (54 + game.dial * 1.62).toFixed(1);
      text(sg, "CH " + mhz, SW - 8, 18, 18, "#3cff6b", "right");
      text(sg, clockString(), 8, 18, 18, "#3cff6b");
      if (game.time < 12) text(sg, "◀ TUNE ▶", 160, 228, 18, "#3cff6b", "center");
    }
    if (game.state === "paused") {
      sg.fillStyle = "rgba(0,0,0,0.6)";
      sg.fillRect(0, 0, SW, SH);
      text(sg, "❚❚ PAUSE", 160, 125, 26, "#3cff6b", "center");
    }

    // 8. room light follows the picture
    const light = station && signal > 0.3 ? 0.35 + signal * 0.55 : 0.35 + Math.random() * 0.15;
    document.body.style.setProperty("--glow", station && signal > 0.3 ? station.glow : "150, 150, 160");
    document.body.style.setProperty("--light", light.toFixed(2));
  }

  /** Power flicker: black glass shows your reflection... and what stands behind you. */
  function drawBlackout() {
    sg.fillStyle = "#030303";
    sg.fillRect(0, 0, SW, SH);
    const p = progress();
    // faint glass reflection
    sg.save();
    sg.globalAlpha = 0.85;
    const room = sg.createRadialGradient(150, 120, 10, 150, 120, 210);
    room.addColorStop(0, "#2c2c2e");
    room.addColorStop(0.6, "#141415");
    room.addColorStop(1, "#040404");
    sg.fillStyle = room;
    sg.fillRect(0, 0, SW, SH);
    sg.restore();
    // the figure behind you (gets closer every time)
    const size = 120 + p * 200;
    const fx = 160 + (p < 0.5 ? 70 : 30);
    drawFigure(sg, fx, SH + size * 0.25, size, "#000", 0.95, 0);
    if (p > 0.6) drawFace(sg, fx, SH + size * 0.25 - size * 0.9, size * 0.12, { alpha: 0.25, grin: 0.9, pupils: true });
    // your own head & shoulders
    sg.fillStyle = "#070707";
    sg.beginPath(); sg.ellipse(150, 180, 28, 34, 0, 0, Math.PI * 2); sg.fill();
    sg.fillRect(95, 205, 110, 40);
    document.body.style.setProperty("--light", "0.05");
  }

  /* ======================================================
     UPDATE
     ====================================================== */
  let musicClock = 0, musicStep = 0, heartClock = 0;
  const KIDS_SONG = [72, 72, 79, 79, 81, 81, 79, 0, 77, 77, 76, 76, 74, 74, 72, 0];
  const WEATHER_SONG = [60, 64, 67, 71, 57, 60, 64, 67, 62, 65, 69, 72, 55, 59, 62, 65];
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function update(dt) {
    game.frame++;
    if (game.state !== "play" && game.state !== "won") return;
    game.time += dt;
    const p = progress();

    // ---- win
    if (game.state === "play" && game.time >= NIGHT) return win();
    if (game.state === "won") { updateUI(1); return; }

    // ---- station drift (faster as the night goes on)
    const maxV = 0.12 + p * 0.55;
    for (const s of game.stations) {
      s.v = clamp(s.v + rand(-1, 1) * dt * (0.4 + p), -maxV, maxV);
      s.f += s.v * dt;
      if (s.f < 3 || s.f > 97) { s.v = -s.v; s.f = clamp(s.f, 3, 97); }
      if (s.fade > 0) {
        s.fade -= dt;
        if (s.fade <= 0) {
          s.f = newFreq(s);   // station jumps elsewhere on the dial
          s.v = 0;
        }
      }
    }
    // keep stations apart
    for (const a of game.stations) for (const b of game.stations) {
      if (a !== b && Math.abs(a.f - b.f) < 9) a.f += (a.f < b.f ? -1 : 1) * dt * 2;
    }

    const { station, signal } = tuned();
    const watching = station && signal > 0.3 ? station.id : null;
    const hijacked = game.hijack && watching === game.hijack.station;

    // ---- dread
    if (game.state === "play") {
      let rate;
      if (signal < 0.3) { rate = 6 * (1 + p * 0.8); game.cause = "static"; }
      else if (hijacked) { rate = 14; game.cause = "smile"; }
      else if (signal < 0.75) { rate = 2.2; game.cause = "static"; }
      else rate = -4.5;
      if (watching === "cam" && p > 0.6 && !hijacked) rate += 2;   // it notices you watching
      if (game.time < 8) rate = Math.min(rate, 0);                  // grace period
      if (game.blackout > 0) rate = 1;
      game.dread = clamp(game.dread + rate * dt, 0, 100);
      if (game.dread >= 100) return die(game.cause);
    }

    // ---- events
    const n = game.next;
    if (game.time > n.jump) {
      // the station you're watching is the one most likely to drop out
      const pool = watching && Math.random() < 0.6 ? [station] : game.stations;
      const s = pool[(Math.random() * pool.length) | 0];
      s.fade = 1.6;
      n.jump = game.time + rand(22, 38) * (1 - p * 0.5);
    }
    if (game.time > n.hijack && !game.hijack) {
      const choices = game.stations.filter((s) => s.id !== "eas");
      // favour the channel the player is on
      const st = watching && watching !== "eas" && Math.random() < 0.55 ? watching : choices[(Math.random() * choices.length) | 0].id;
      game.hijack = { station: st, until: game.time + 14 };
      n.hijack = game.time + rand(30, 50) * (1 - p * 0.4);
    }
    if (game.hijack && game.time > game.hijack.until) game.hijack = null;

    if (game.time > n.turn && !game.turn && game.blackout <= 0) startTurn();
    if (game.turn && game.time > game.turn.until) endTurn(true);

    if (game.time > n.blackout && game.blackout <= 0 && !game.turn) {
      game.blackout = 1.3 + p;
      A.thud();
      n.blackout = game.time + rand(30, 50);
    }
    if (game.blackout > 0) game.blackout -= dt;

    if (game.time > n.whisper) {
      A.whisper(rand(-1, 1), rand(1.2, 2.2));
      n.whisper = game.time + rand(14, 30) * (1 - p * 0.5);
    }

    // ---- emergency broadcast narration
    if (watching === "eas" && signal > 0.6) {
      const line = currentEas();
      if (line.idx > game.easSpoken) {
        game.easSpoken = line.idx;
        say(line.text);
      }
    }

    updateAudio(dt, station, signal, watching, hijacked);
    updateUI(signal);
  }

  function newFreq(s) {
    for (let tries = 0; tries < 50; tries++) {
      const f = rand(4, 96);
      if (game.stations.every((o) => o === s || Math.abs(o.f - f) > 12) && Math.abs(f - game.dial) > 10) return f;
    }
    return rand(4, 96);
  }

  function updateAudio(dt, station, signal, watching, hijacked) {
    if (!A.ctx) return;
    const d = game.dread / 100;
    const live = game.blackout <= 0;
    A.set(A.staticGain.gain, live ? (1 - signal) * 0.22 : 0, 0.03);
    A.set(A.droneGain.gain, 0.03 + d * 0.32, 0.3);
    const easOn = live && watching === "eas" && (game.time % 6) < 2.4;
    A.set(A.easGain.gain, easOn ? 0.035 * signal : 0, 0.02);
    A.set(A.barsGain.gain, live && watching === "bars" ? 0.03 * signal : 0, 0.05);
    A.set(A.humGain.gain, live && watching === "cam" ? 0.08 * signal : 0, 0.1);
    const musical = live && (watching === "kids" || watching === "weather");
    A.set(A.musicGain.gain, musical ? signal * 0.9 : 0, 0.05);

    // melodies (music-box detunes as dread rises, inverts when hijacked)
    musicClock -= dt;
    if (musicClock <= 0 && musical) {
      if (watching === "kids") {
        let m = KIDS_SONG[musicStep % KIDS_SONG.length];
        if (m) {
          if (hijacked) m = 2 * 72 - m - 12;   // mirrored, lower: wrong
          const det = (Math.random() - 0.5) * d * 140 + (hijacked ? -60 : 0);
          A.note(midi(m), 0.6, "triangle", 0.1, det);
          A.note(midi(m + 12), 0.4, "sine", 0.04, det);
        }
        musicClock = hijacked ? 0.55 : 0.32;
      } else {
        const m = WEATHER_SONG[musicStep % WEATHER_SONG.length] - (hijacked ? 1 : 0);
        A.note(midi(m), 0.5, "sine", 0.08, (Math.random() - 0.5) * d * 80);
        musicClock = 0.24;
      }
      musicStep++;
    }

    // heartbeat
    if (game.dread > 40 && game.state === "play") {
      heartClock -= dt;
      if (heartClock <= 0) {
        A.heartbeat(0.25 + d * 0.5);
        heartClock = 1.2 - d * 0.75;
      }
    }
  }

  function updateUI(signal) {
    $("needle").style.left = game.dial + "%";
    $("knob").style.transform = `rotate(${game.dial * 3.2 - 160}deg)`;
    const bars = Math.round(signal * 5);
    const meter = $("meter");
    [...meter.children].forEach((b, i) => b.classList.toggle("lit", i < bars));
    meter.classList.toggle("weak", signal < 0.75 && signal >= 0.3);
    meter.classList.toggle("dead", signal < 0.3);
    document.body.style.setProperty("--dread", (game.dread / 100).toFixed(3));
    $("tv").classList.toggle("shake", game.dread > 72 && game.state === "play");
  }

  /* ---------- Turn-around temptation ---------- */
  function startTurn() {
    game.turn = { until: game.time + 7 };
    $("turn").classList.remove("hidden");
    A.whisper(rand(-1, 1) < 0 ? -0.9 : 0.9, 2.4);
    setTimeout(() => game.turn && say("turn around", { rate: 0.55, pitch: 0.1, volume: 0.6 }), 600);
  }
  function endTurn(resisted) {
    game.turn = null;
    $("turn").classList.add("hidden");
    game.next.turn = game.time + rand(35, 60);
    if (resisted) game.dread = Math.max(0, game.dread - 12);
  }
  function turnAround() {
    if (game.state !== "play") return;
    endTurn(false);
    die("turn");
  }

  /* ======================================================
     GAME FLOW
     ====================================================== */
  function startGame() {
    A.init();
    hush();
    game.calm = $("calm").checked;
    reset();
    $("title").classList.add("hidden");
    $("end").classList.add("hidden");
    $("tvwrap").classList.add("on");
    screen.classList.remove("power-off");
    screen.classList.remove("power-on");
    void screen.offsetWidth;
    screen.classList.add("power-on");
    game.state = "intro";
    A.thud();
    setTimeout(() => { game.state = "play"; }, 900);
  }

  function die(cause) {
    if (game.state !== "play") return;
    game.state = "dying";
    game.cause = cause;
    hush();
    A.silence();
    $("turn").classList.add("hidden");
    $("tv").classList.remove("shake");
    // a beat of silence and pure static... then it comes through.
    const silenceMs = cause === "turn" ? 250 : 900;
    setTimeout(jumpscare, silenceMs);
  }

  function jumpscare() {
    const c = $("scare");
    c.width = innerWidth;
    c.height = innerHeight;
    c.classList.add("on");
    const g = c.getContext("2d");
    A.screech(1.6);
    const t0 = performance.now();
    const calm = game.calm;
    (function frame(now) {
      const k = (now - t0) / 1000;
      const W = c.width, H = c.height;
      const strobe = !calm && Math.floor(k * 18) % 3 === 0;
      g.fillStyle = strobe ? "#600" : "#000";
      g.fillRect(0, 0, W, H);
      const s = Math.min(W, H) * (1.1 + k * 0.9) + (calm ? 0 : rand(-30, 30));
      const jx = calm ? 0 : rand(-25, 25), jy = calm ? 0 : rand(-25, 25);
      const fx = W / 2 + jx, fy = H / 2 + jy + s * 0.08;
      const open = 0.3 + Math.abs(Math.sin(k * 9)) * 0.4;   // jaw works up and down
      if (!calm) {
        g.globalCompositeOperation = "lighter";
        drawFace(g, fx - 14, fy, s, { grin: 1, wide: true, open, tint: "#ff3030", pupils: false });
        drawFace(g, fx + 14, fy, s, { grin: 1, wide: true, open, tint: "#30ffff", pupils: false });
        g.globalCompositeOperation = "source-over";
      }
      drawFace(g, fx, fy, s, { grin: 1, wide: true, bleed: true, open, pupils: true, alpha: calm ? 1 : 0.85 });
      // chunky CRT grain on top
      fillNoise(true);
      g.globalAlpha = 0.22;
      g.imageSmoothingEnabled = false;
      g.drawImage(nz, 0, 0, W, H);
      g.globalAlpha = 1;
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(90,0,0,0.85)");
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
      // scanlines + noise speckle
      g.fillStyle = "rgba(0,0,0,0.35)";
      for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
      if (!calm && Math.random() < 0.3) {
        g.globalCompositeOperation = "difference";
        g.fillStyle = "#fff";
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = "source-over";
      }
      if (k < 1.5) requestAnimationFrame(frame);
      else {
        c.classList.remove("on");
        screen.classList.add("power-off");
        setTimeout(showDeath, 700);
      }
    })(t0);
  }

  const DEATH_TEXT = {
    static: "You lost the signal for too long.<br>It came through the static.",
    smile: "The picture smiled at you.<br>You didn't look away.",
    turn: "You turned around.",
  };

  function showDeath() {
    game.state = "dead";
    const survived = Math.floor(game.time);
    const rec = Retro.submitScore("nosignal", survived * 10);
    $("end-title").textContent = "SIGNAL LOST";
    $("end-title").dataset.text = "SIGNAL LOST";
    $("end-text").innerHTML = `${DEATH_TEXT[game.cause] || ""}<br><br>You lasted until ${clockString()}.` +
      (rec ? "<br><span style='color:#c00'>A new record. It will remember you.</span>" : "");
    $("again").textContent = "TRY AGAIN";
    $("end").classList.remove("hidden");
    $("tvwrap").classList.remove("on");
    A.set(A.droneGain.gain, 0.05, 1);
    showBest();
  }

  function win() {
    game.state = "won";
    game.hijack = null;
    endTurn(false);
    game.dread = 0;
    hush();
    say("Broadcast restored. Good morning.", { pitch: 0.8, rate: 0.9 });
    A.silence();
    setTimeout(() => {
      Retro.submitScore("nosignal", NIGHT * 10 + 1000);
      screen.classList.add("power-off");
      $("end-title").textContent = "4:00 AM";
      $("end-title").dataset.text = "4:00 AM";
      $("end-text").innerHTML = "The signal is back. The storm has passed.<br>You survived the night.";
      $("again").textContent = "PLAY AGAIN";
      $("end").classList.remove("hidden");
      $("tvwrap").classList.remove("on");
      game.state = "dead";
      showBest();
      // ...but it isn't over.
      setTimeout(() => {
        if (game.state !== "dead") return;
        $("end-text").innerHTML = "The signal is back. The storm has passed.<br>You survived the night.<br><br><span style='color:#a00'>see you tomorrow night.</span>";
        A.init();
        A.whisper(0.8, 2.5);
      }, 4500);
    }, 3500);
  }

  function togglePause() {
    if (game.state === "play") {
      game.state = "paused";
      hush();
      A.ctx && A.ctx.suspend();
    } else if (game.state === "paused") {
      game.state = "play";
      A.ctx && A.ctx.resume();
    }
  }

  function showBest() {
    const best = Retro.getHigh("nosignal");
    if (!best) { $("best").textContent = ""; return; }
    const secs = Math.min(NIGHT, best / 10);
    const mins = Math.min(60, Math.floor((secs / NIGHT) * 60));
    $("best").textContent = best > NIGHT * 10 ? "BEST: SURVIVED THE NIGHT" : "BEST: 3:" + String(mins).padStart(2, "0") + " AM";
  }

  /* ======================================================
     INPUT
     ====================================================== */
  const held = { left: false, right: false, fine: false };
  addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { held.left = true; e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { held.right = true; e.preventDefault(); }
    else if (e.key === "Shift") held.fine = true;
    else if (e.key === "t" || e.key === "T") turnAround();
    else if (e.key === "p" || e.key === "P" || e.key === "Escape") togglePause();
    else if ((e.key === "Enter" || e.key === " ") && (game.state === "title")) { e.preventDefault(); startGame(); }
  });
  addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") held.left = false;
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") held.right = false;
    else if (e.key === "Shift") held.fine = false;
  });
  function nudge(delta) {
    if (game.state !== "play") return;
    game.dial = clamp(game.dial + delta, 0, 100);
  }
  addEventListener("wheel", (e) => {
    if (game.state !== "play") return;
    nudge((e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 0.25 : 0.9));
  }, { passive: true });
  const tuner = $("tuner");
  let dragging = false;
  function dragTo(e) {
    const r = tuner.getBoundingClientRect();
    if (game.state === "play") game.dial = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
  }
  tuner.addEventListener("pointerdown", (e) => { dragging = true; tuner.setPointerCapture(e.pointerId); dragTo(e); });
  tuner.addEventListener("pointermove", (e) => dragging && dragTo(e));
  tuner.addEventListener("pointerup", () => { dragging = false; });

  $("start").addEventListener("click", startGame);
  $("again").addEventListener("click", startGame);
  $("turn").addEventListener("click", turnAround);
  document.addEventListener("visibilitychange", () => { if (document.hidden && game.state === "play") togglePause(); });

  /* ======================================================
     MAIN LOOP
     ====================================================== */
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (game.state === "play") {
      const speed = held.fine ? 2.5 : 11;
      if (held.left) nudge(-speed * dt);
      if (held.right) nudge(speed * dt);
    }
    update(dt);
    if (game.state !== "title" && game.state !== "dead") render();
    requestAnimationFrame(loop);
  }

  // test hooks
  Object.assign(game, {
    reset, startGame, tuned, turnAround, startTurn, die, update,
    tuneTo(id) { const s = game.stations.find((x) => x.id === id); game.dial = s.f; return s.f; },
    hijackNow(id) { game.hijack = { station: id, until: game.time + 14 }; },
    blackoutNow() { game.blackout = 1.5; },
    skipTo(t) { game.time = t; },
  });

  reset();
  showBest();
  // pre-load voices (Chrome/Edge populate them asynchronously)
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  requestAnimationFrame(loop);
})();
