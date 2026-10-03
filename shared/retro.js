/* ==========================================================
   PIXEL ARCADE — shared helpers (sound, scores, settings)
   Exposed as window.Retro
   ========================================================== */
(function () {
  "use strict";

  const STORE = "pixelArcade.";

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(STORE + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch (e) { /* storage disabled */ }
  }

  /* ---------- Settings ---------- */
  const settings = Object.assign({ sound: true, crt: true }, load("settings", {}));

  function setSetting(name, value) {
    settings[name] = value;
    save("settings", settings);
    applySettings();
  }
  function applySettings() {
    document.body && document.body.classList.toggle("no-crt", !settings.crt);
  }

  /* ---------- High scores ---------- */
  function getHigh(game) {
    return load("high." + game, 0);
  }
  /** Saves score if it beats the record. Returns true when a new record is set. */
  function submitScore(game, score) {
    if (score > getHigh(game)) {
      save("high." + game, score);
      return true;
    }
    return false;
  }

  /* ---------- Chiptune sound effects (WebAudio, no files) ---------- */
  let ctx = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol || 0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol) {
    const a = audio();
    if (!a) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    const gain = a.createGain();
    gain.gain.value = vol || 0.08;
    src.buffer = buf;
    src.connect(gain).connect(a.destination);
    src.start();
  }

  const SOUNDS = {
    hover:   () => tone(880, 0.04, "square", 0.025),
    click:   () => { tone(520, 0.06, "square", 0.05); tone(1040, 0.08, "square", 0.04, null, 0.05); },
    coin:    () => { tone(988, 0.08, "square", 0.05); tone(1319, 0.25, "square", 0.05, null, 0.08); },
    eat:     () => tone(600, 0.08, "square", 0.05, 1200),
    jump:    () => tone(300, 0.15, "square", 0.05, 700),
    hurt:    () => { tone(300, 0.3, "sawtooth", 0.06, 60); noise(0.2, 0.05); },
    power:   () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, "square", 0.05, null, i * 0.07)),
    win:     () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.14, "square", 0.05, null, i * 0.11)),
    over:    () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, "triangle", 0.08, null, i * 0.18)),
    boom:    () => noise(0.35, 0.1),
    start:   () => [262, 392, 523].forEach((f, i) => tone(f, 0.12, "square", 0.05, null, i * 0.09)),
  };

  function sfx(name) {
    if (!settings.sound) return;
    const fn = SOUNDS[name];
    if (fn) {
      try { fn(); } catch (e) { /* audio is optional */ }
    }
  }

  /* ---------- Misc ---------- */
  function pad(n, len) {
    return String(n).padStart(len || 6, "0");
  }

  document.addEventListener("DOMContentLoaded", applySettings);
  if (document.readyState !== "loading") applySettings();

  window.Retro = { settings, setSetting, getHigh, submitScore, sfx, pad, load, save };
})();
