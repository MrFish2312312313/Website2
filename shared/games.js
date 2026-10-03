/* ==========================================================
   GAME REGISTRY
   To add a new game or toy:
     1. Create a folder in /games/<id>/ with an index.html
     2. Add an entry below. `preview` picks an animated card
        thumbnail from js/previews.js (or "generic").
   ========================================================== */
window.ARCADE_GAMES = [
  {
    id: "snake",
    title: "Neon Snake",
    type: "game",
    tags: ["arcade", "classic"],
    color: "#39ff14",
    description: "Eat, grow, and dodge walls. Grab power-ups and survive the speed-up levels.",
    path: "games/snake/index.html",
    preview: "snake",
  },
  {
    id: "platformer",
    title: "Pixel Jumper",
    type: "game",
    tags: ["platformer", "action"],
    color: "#ffe600",
    description: "Run, double-jump, stomp slimes and collect coins across hand-built levels.",
    path: "games/platformer/index.html",
    preview: "platformer",
  },
  {
    id: "sandbox",
    title: "Sand Box",
    type: "toy",
    tags: ["sandbox", "physics"],
    color: "#ff8a00",
    description: "A falling-sand playground: sand, water, fire, lava, acid, plants, gunpowder and more.",
    path: "games/sandbox/index.html",
    preview: "sandbox",
  },
  {
    id: "life",
    title: "Life Lab",
    type: "toy",
    tags: ["simulation", "cellular"],
    color: "#00f0ff",
    description: "Conway's Game of Life with a neon glow. Paint cells, drop patterns, watch them evolve.",
    path: "games/life/index.html",
    preview: "life",
  },
  {
    id: "nosignal",
    title: "No Signal",
    type: "game",
    tags: ["horror", "survival"],
    color: "#ff2a2a",
    theme: "horror",
    description: "3:00 AM. The cable is out. Keep the old TV tuned until dawn... and whatever you hear, don't turn around.",
    path: "games/nosignal/index.html",
    preview: "nosignal",
  },
];
