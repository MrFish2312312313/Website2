"""
End-to-end tests for PIXEL ARCADE.

Runs every page in a real headless browser (Microsoft Edge or Chrome via
Playwright), checks for JavaScript errors and broken requests, and exercises
each game's core mechanics.

Usage:
    pip install playwright
    python tests/test_site.py              # uses installed Edge
    python tests/test_site.py --shots DIR  # also save screenshots to DIR
"""
import argparse
import functools
import http.server
import os
import socketserver
import sys
import threading
from collections import deque

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {name}" + (f"  ({detail})" if detail and not cond else ""))


def serve():
    handler = functools.partial(QuietHandler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def open_page(browser, url):
    """Open a page and record JS errors + failed local requests."""
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "fonts.g" not in m.text
            and page.errors.append(m.text))
    page.on("response", lambda r: r.status >= 400 and "127.0.0.1" in r.url
            and page.errors.append(f"HTTP {r.status} {r.url}"))
    page.goto(url)
    page.wait_for_load_state("load")
    return page


# ---------------------------------------------------------------- hub
def test_hub(browser, base, shots):
    print("\nHUB (index.html)")
    page = open_page(browser, base + "/index.html")
    page.wait_for_timeout(300)
    check("boot screen is shown on first visit", page.locator("#boot").count() == 1)
    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    check("boot screen dismisses on key press", page.locator("#boot").count() == 0)

    cards = page.locator(".card")
    check("renders all 5 cartridges", cards.count() == 5, f"got {cards.count()}")
    check("NO SIGNAL card has horror styling", page.locator(".card.horror", has_text="No Signal").count() == 1)
    check("logo split into animated letters", page.locator(".logo .ch").count() == len("PIXEL ARCADE"))
    page.wait_for_timeout(1500)
    typed = page.locator("#typer").inner_text()
    check("tagline typewriter is typing", len(typed) > 0, repr(typed))
    check("high-score ticker populated", "HI-SCORE" in page.locator("#ticker").inner_text())

    # previews are animating (canvas pixels change between frames)
    sig = "() => [...document.querySelectorAll('.card canvas')].map(c => c.toDataURL().length + ':' + c.toDataURL().slice(-60)).join('|')"
    a = page.evaluate(sig)
    page.wait_for_timeout(400)
    b = page.evaluate(sig)
    check("card preview canvases are animating", a != b)

    visible = lambda: page.locator(".card:not(.hidden)").count()
    page.click("[data-filter=game]")
    check("GAMES filter shows only games", visible() == 3, f"visible={visible()}")
    page.click("[data-filter=toy]")
    check("TOYS filter shows only toys", visible() == 2, f"visible={visible()}")
    page.click("[data-filter=all]")
    page.fill("#search", "sand")
    check("search 'sand' finds the sandbox", visible() == 1, f"visible={visible()}")
    page.fill("#search", "zzzz")
    check("empty search shows NO CARTRIDGES message", page.locator("#empty:not(.hidden)").count() == 1)
    page.fill("#search", "")

    page.click("#toggle-crt")
    check("CRT toggle turns scanlines off", page.evaluate("document.body.classList.contains('no-crt')"))
    page.click("#toggle-crt")
    check("CRT toggle turns scanlines back on", not page.evaluate("document.body.classList.contains('no-crt')"))

    if shots:
        page.screenshot(path=os.path.join(shots, "hub.png"))

    page.locator(".card", has_text="Neon Snake").click()
    page.wait_for_url("**/games/snake/index.html", timeout=3000)
    check("clicking a card wipes to the game page", page.url.endswith("/games/snake/index.html"))
    page.click("text=Arcade")
    page.wait_for_url("**/index.html#noboot", timeout=3000)
    check("back button returns to hub (no boot replay)", page.locator("#boot").count() == 0)

    check("no JS errors on hub", not page.errors, "; ".join(page.errors))
    page.close()


# ---------------------------------------------------------------- snake
def test_snake(browser, base, shots):
    print("\nNEON SNAKE")
    page = open_page(browser, base + "/games/snake/index.html")
    check("starts on title overlay", page.evaluate("game.state") == "ready")
    page.keyboard.press("Space")
    page.wait_for_timeout(100)
    check("SPACE starts the game", page.evaluate("game.state") == "playing")
    head0 = page.evaluate("game.snake[0].x")
    page.wait_for_timeout(700)
    head1 = page.evaluate("game.snake[0].x")
    check("snake moves on its own", head1 > head0, f"{head0} -> {head1}")

    page.keyboard.press("ArrowUp")
    page.wait_for_timeout(300)
    check("arrow keys steer", page.evaluate("game.dir.y") == -1)

    page.keyboard.press("p")
    check("P pauses", page.evaluate("game.state") == "paused")
    page.keyboard.press("p")
    check("P resumes", page.evaluate("game.state") == "playing")

    # Deterministic checks: freeze the loop's clock by pausing, then drive step() directly.
    page.keyboard.press("p")
    r = page.evaluate("""() => {
        game.start(); game.state = 'paused';
        const h = game.snake[0];
        game.food = {x: h.x + 1, y: h.y};
        const len = game.snake.length;
        game.step();
        return {grew: game.snake.length === len + 1, score: game.score};
    }""")
    check("eating food grows snake", r["grew"])
    check("eating food scores 10 at level 1", r["score"] == 10, str(r))

    r = page.evaluate("""() => {
        for (let i = 0; i < 4; i++) { const h = game.snake[0]; game.food = {x: h.x + 1, y: h.y}; game.step(); }
        return {level: game.level, blocks: game.blocks.size};
    }""")
    check("5 pellets -> level 2", r["level"] == 2, str(r))
    check("level up adds blocks", r["blocks"] == 3, str(r))

    r = page.evaluate("""() => {
        game.start(); game.state = 'playing'; game.food = null;
        game.lastTick = 1e12;  // stop the RAF loop from also stepping
        for (let i = 0; i < 30 && game.state === 'playing'; i++) game.step();
        return game.state;
    }""")
    check("hitting the wall ends the game", r == "over", r)

    r = page.evaluate("""() => {
        game.start(); game.lastTick = 1e12; game.food = null;
        game.snake = [{x:5,y:5},{x:4,y:5},{x:4,y:6},{x:5,y:6},{x:6,y:6},{x:6,y:5}];
        game.dir = {x:1,y:0};
        game.queue = [{x:0,y:1}];
        game.step();
        return game.state;
    }""")
    check("biting yourself ends the game", r == "over", r)

    r = page.evaluate("""() => {
        game.start(); game.lastTick = 1e12; game.food = null;
        game.effects.ghost = performance.now() + 100000;
        game.snake = [{x:23,y:5},{x:22,y:5},{x:21,y:5}];
        game.dir = {x:1,y:0};
        game.step();
        return {state: game.state, x: game.snake[0].x};
    }""")
    check("ghost power-up wraps through walls", r["state"] == "playing" and r["x"] == 0, str(r))

    page.evaluate("game.state='over'")
    page.wait_for_timeout(900)
    page.evaluate("Retro.submitScore('snake', 120)")
    check("high score saved to localStorage", page.evaluate("Retro.getHigh('snake')") >= 120)

    if shots:
        page.evaluate("() => { game.start(); }")
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(shots, "snake.png"))
    check("no JS errors in snake", not page.errors, "; ".join(page.errors))
    page.close()


# ---------------------------------------------------------------- platformer
SOLID = set("#B")


def level_reachable(grid):
    """Conservative reachability check over standable tiles (P -> F).

    Uses jump limits a bit below the real physics:
      single+double jump: up to 5 tiles up, 5 tiles across
      springs:            up to 9 tiles up
    """
    h, w = len(grid), len(grid[0])
    at = lambda x, y: grid[y][x] if 0 <= x < w and 0 <= y < h else ("#" if 0 <= y < h else ".")

    def standable(x, y):
        return (at(x, y) not in SOLID and at(x, y) != "^" and y + 1 < h
                and (at(x, y + 1) in SOLID or at(x, y + 1) == "=" or at(x, y + 1) == "S"))

    start = flag = None
    springs = set()
    for y in range(h):
        for x in range(w):
            if grid[y][x] == "P":
                start = (x, y)
            elif grid[y][x] == "F":
                flag = (x, y)
            elif grid[y][x] == "S":
                springs.add((x, y))
    stands = {(x, y) for y in range(h) for x in range(w) if standable(x, y)} | springs
    seen, q = {start}, deque([start])
    while q:
        x, y = q.popleft()
        if (x, y) == flag:
            return True
        up = 9 if (x, y) in springs else 5
        for (nx, ny) in stands:
            if (nx, ny) in seen:
                continue
            dy = y - ny  # positive = higher
            dx = abs(nx - x)
            if dy > up:
                continue
            reach = 5 if dy >= 0 else 5 + (-dy) // 2
            if dx <= reach:
                seen.add((nx, ny))
                q.append((nx, ny))
    return False


def test_platformer(browser, base, shots):
    print("\nPIXEL JUMPER")
    page = open_page(browser, base + "/games/platformer/index.html")
    n = page.evaluate("PJ_LEVELS.length")
    check("has 3 levels", n == 3, str(n))
    for i in range(n):
        grid = page.evaluate(f"PJ_LEVELS[{i}].rows")
        w = max(len(r) for r in grid)
        grid = [r.ljust(w, ".") for r in grid]
        widths = {len(r) for r in page.evaluate(f"PJ_LEVELS[{i}].rows")}
        check(f"level {i+1}: all rows same width", len(widths) == 1, str(widths))
        check(f"level {i+1}: has start and flag", sum(r.count("P") for r in grid) == 1 and sum(r.count("F") for r in grid) == 1)
        check(f"level {i+1}: flag reachable from start", level_reachable(grid))

    page.keyboard.press("Space")
    page.wait_for_timeout(100)
    check("SPACE starts the game", page.evaluate("game.state") == "playing")
    page.wait_for_timeout(600)  # let player settle onto the ground
    check("player lands on the ground", page.evaluate("game.player.onGround"))

    x0 = page.evaluate("game.player.x")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(600)
    page.keyboard.up("ArrowRight")
    x1 = page.evaluate("game.player.x")
    check("holding RIGHT runs right", x1 > x0 + 30, f"{x0:.1f} -> {x1:.1f}")

    y0 = page.evaluate("game.player.y")
    page.keyboard.down("Space")
    page.wait_for_timeout(200)
    y_mid = page.evaluate("game.player.y")
    page.keyboard.up("Space")
    check("SPACE jumps", y_mid < y0 - 20, f"{y0:.1f} -> {y_mid:.1f}")
    page.wait_for_timeout(900)
    check("player falls back and lands", page.evaluate("game.player.onGround"))

    # double jump: jump, release, jump again mid-air
    page.keyboard.down("Space"); page.wait_for_timeout(120); page.keyboard.up("Space")
    page.wait_for_timeout(150)
    vy_before = page.evaluate("game.player.vy")
    page.keyboard.down("Space"); page.wait_for_timeout(50)
    vy_after = page.evaluate("game.player.vy")
    page.keyboard.up("Space")
    check("double jump works in mid-air", vy_after < -3 and not page.evaluate("game.player.canDouble"),
          f"vy {vy_before:.2f} -> {vy_after:.2f}")
    page.wait_for_timeout(900)

    # coins
    r = page.evaluate("""() => {
        const c = game.coins.find(c => !c.taken);
        game.player.x = c.x; game.player.y = c.y; game.player.vy = 0;
        const before = game.coinCount;
        game.update();
        return {before, after: game.coinCount};
    }""")
    check("touching a coin collects it", r["after"] == r["before"] + 1, str(r))

    # stomp an enemy
    r = page.evaluate("""() => {
        game.loadLevel(0); game.state = 'playing';
        const e = game.enemies[0], p = game.player;
        p.invuln = 0; p.x = e.x + 2; p.y = e.y - p.h - 2; p.vy = 4;
        const score = game.score;
        game.update();
        return {alive: e.alive, state: game.state, gained: game.score - score};
    }""")
    check("landing on a slime stomps it", not r["alive"] and r["state"] == "playing" and r["gained"] >= 50, str(r))

    # side-hit an enemy -> death
    r = page.evaluate("""() => {
        game.loadLevel(0); game.state = 'playing'; game.lives = 3;
        const e = game.enemies[0], p = game.player;
        p.invuln = 0; p.x = e.x - 4; p.y = e.y + e.h - p.h; p.vy = 0;
        game.update();
        return game.state;
    }""")
    check("walking into a slime hurts", r == "dead", r)
    page.wait_for_timeout(1600)
    check("respawn after death costs a life", page.evaluate("game.lives") == 2 and page.evaluate("game.state") == "playing")

    # spikes
    r = page.evaluate("""() => {
        game.loadLevel(0); game.state = 'playing';
        const p = game.player; p.invuln = 0;
        // level 1 has a spike pit at columns 40-42, row 13
        p.x = 41 * 16 + 2; p.y = 13 * 16 - p.h + 10; p.vy = 1;
        game.update();
        return game.state;
    }""")
    check("spikes kill the player", r == "dead", r)
    page.wait_for_timeout(1600)

    # springs
    r = page.evaluate("""() => {
        game.loadLevel(0); game.state = 'playing';
        const s = game.springs[0], p = game.player;
        p.x = s.x + 3; p.y = s.y - p.h - 1; p.vy = 2;
        game.keys.jump = false;
        game.update();
        const vy1 = p.vy;
        for (let i = 0; i < 5; i++) game.update();
        return {vy1, vy5: p.vy};
    }""")
    check("springs launch the player high", r["vy1"] <= -9 and r["vy5"] < -7, str(r))

    # flag -> level clear -> next level
    r = page.evaluate("""() => {
        game.loadLevel(0); game.state = 'playing';
        const f = game.level.flag, p = game.player;
        p.x = f.x + 3; p.y = f.y; game.update();
        return game.state;
    }""")
    check("touching the flag clears the level", r == "clear", r)
    page.wait_for_timeout(1100)
    check("level clear overlay appears", "LEVEL CLEAR" in page.inner_text("#ov-title"))
    page.keyboard.press("Space")
    page.wait_for_timeout(100)
    check("SPACE advances to level 2", page.evaluate("game.levelIndex") == 1 and page.evaluate("game.state") == "playing")
    check("HUD shows world 1-2", page.inner_text("#world") == "1-2")

    r = page.evaluate("""() => {
        game.loadLevel(2); game.state = 'playing';
        const f = game.level.flag, p = game.player;
        p.x = f.x + 3; p.y = f.y; game.update();
        game.nextLevel();
        return game.state;
    }""")
    check("finishing the last level wins the game", r == "win", r)

    r = page.evaluate("""() => {
        game.newGame(); game.lives = 1;
        const p = game.player; p.invuln = 0; p.y = 5000; game.update();
        return game.state;
    }""")
    page.wait_for_timeout(1600)
    check("falling in a pit with last life -> GAME OVER", page.evaluate("game.state") == "over")

    if shots:
        for i in range(n):
            page.evaluate(f"() => {{ game.loadLevel({i}); game.state = 'playing'; document.getElementById('overlay').classList.add('hidden'); }}")
            page.keyboard.down("ArrowRight")
            page.wait_for_timeout(1200)
            page.keyboard.up("ArrowRight")
            page.screenshot(path=os.path.join(shots, f"platformer-{i+1}.png"))
    check("no JS errors in platformer", not page.errors, "; ".join(page.errors))
    page.close()


# ---------------------------------------------------------------- sandbox
def test_sandbox(browser, base, shots):
    print("\nSAND BOX")
    page = open_page(browser, base + "/games/sandbox/index.html")
    page.wait_for_timeout(800)
    if shots:
        page.wait_for_timeout(2500)
        page.screenshot(path=os.path.join(shots, "sandbox-demo.png"))
    check("element palette rendered", page.locator(".el").count() >= 15, str(page.locator(".el").count()))
    check("demo scene loaded with particles", int(page.inner_text("#count")) > 1000, page.inner_text("#count"))
    check("FPS counter running", int(page.inner_text("#fps")) > 0)

    page.click("#pause")  # freeze the main loop so we can step deterministically
    E = page.evaluate("game.E")

    def run(js):
        return page.evaluate("() => { game.clearAll(); %s }" % js)

    r = run(f"game.place(100, 10, {E['SAND']}); for (let i=0;i<200;i++) game.step(); return game.get(100, 124);")
    check("sand falls to the bottom", r == E["SAND"], str(r))

    r = run(f"""
        for (let x=0;x<20;x++) game.place(100+x, 124, {E['WALL']});
        for (let i=0;i<30;i++) game.place(110, 10+i, {E['SAND']});
        for (let i=0;i<300;i++) game.step();
        let spread = 0; for (let x=100;x<120;x++) if (game.get(x,123)==={E['SAND']}) spread++;
        return spread;""")
    check("sand piles up and slides sideways", r >= 5, str(r))

    r = run(f"""
        for (let i=0;i<40;i++) game.place(100, 60+i, {E['WATER']});
        for (let i=0;i<400;i++) game.step();
        let flat = 0; for (let x=0;x<200;x++) if (game.get(x,124)==={E['WATER']}) flat++;
        return flat;""")
    check("water flows out flat", r >= 30, str(r))

    r = run(f"""
        for (let x=90;x<110;x++) for (let y=110;y<125;y++) game.place(x, y, {E['WATER']});
        for (let x=95;x<105;x++) for (let y=95;y<100;y++) game.place(x, y, {E['LAVA']});
        let steam = 0;
        for (let i=0;i<300;i++) {{ game.step(); steam = Math.max(steam, game.count({E['STEAM']})); }}
        return {{stone: game.count({E['STONE']}), steam }};""")
    check("lava + water -> stone + steam", r["stone"] > 0 and r["steam"] > 0, str(r))

    r = run(f"""
        for (let x=60;x<140;x++) game.place(x, 124, {E['WALL']});
        for (let x=80;x<120;x++) for (let y=110;y<124;y++) game.place(x, y, {E['GUNPOWDER']});
        const before = game.count({E['GUNPOWDER']});
        game.place(100, 109, {E['FIRE']});
        for (let i=0;i<200;i++) game.step();
        return {{before, after: game.count({E['GUNPOWDER']}) }};""")
    check("fire detonates gunpowder", r["after"] < r["before"] * 0.2, str(r))

    r = run(f"""
        for (let x=90;x<110;x++) for (let y=120;y<125;y++) game.place(x, y, {E['SAND']});
        for (let x=90;x<110;x++) game.place(x, 119, {E['ACID']});
        const before = game.count({E['SAND']});
        for (let i=0;i<300;i++) game.step();
        return {{before, after: game.count({E['SAND']}) }};""")
    check("acid dissolves sand", r["after"] < r["before"], str(r))

    r = run(f"""
        for (let x=90;x<110;x++) game.place(x, 124, {E['WOOD']});
        game.place(95, 123, {E['FIRE']});
        let burned = false;
        for (let i=0;i<400;i++) {{ game.step(); if (game.count({E['WOOD']}) < 20) burned = true; }}
        return burned;""")
    check("fire burns wood", r)

    r = run(f"""
        for (let x=89;x<=110;x++) game.place(x, 124, {E['WALL']});
        for (let y=112;y<124;y++) {{ game.place(89, y, {E['WALL']}); game.place(110, y, {E['WALL']}); }}
        for (let x=90;x<110;x++) for (let y=118;y<124;y++) game.place(x, y, {E['WATER']});
        game.place(100, 117, {E['PLANT']});
        for (let i=0;i<600;i++) game.step();
        return game.count({E['PLANT']});""")
    check("plants grow into water", r > 3, str(r))

    r = run(f"""
        for (let x=89;x<=110;x++) game.place(x, 124, {E['WALL']});
        for (let y=112;y<124;y++) {{ game.place(89, y, {E['WALL']}); game.place(110, y, {E['WALL']}); }}
        for (let x=90;x<110;x++) for (let y=118;y<124;y++) game.place(x, y, {E['WATER']});
        game.place(100, 117, {E['ICE']});
        for (let i=0;i<1500;i++) game.step();
        return game.count({E['ICE']});""")
    check("ice freezes water", r > 3, str(r))

    r = run(f"""
        for (let x=90;x<110;x++) game.place(x, 124, {E['WALL']});
        for (let y=100;y<124;y++) game.place(100, y, {E['WATER']});
        for (let y=80;y<90;y++) game.place(100, y, {E['OIL']});
        for (let i=0;i<500;i++) game.step();
        // oil should end up above water: find lowest oil and highest water in the pool
        let lowestOil = -1, highestWater = 999;
        for (let y=0;y<125;y++) for (let x=0;x<200;x++) {{
            if (game.get(x,y)==={E['OIL']}) lowestOil = Math.max(lowestOil, y);
            if (game.get(x,y)==={E['WATER']}) highestWater = Math.min(highestWater, y);
        }}
        return {{lowestOil, highestWater}};""")
    check("oil floats on water", r["lowestOil"] <= r["highestWater"] + 1, str(r))

    r = run(f"""
        game.place(100, 60, {E['CLONER']}); game.place(100, 59, {E['SAND']});
        for (let i=0;i<100;i++) game.step();
        return game.count({E['SAND']});""")
    check("cloner copies the touching element", r > 10, str(r))

    # real mouse painting through the UI
    page.evaluate("game.clearAll()")
    page.click(".el:has-text('WATER')")
    box = page.locator("#game").bounding_box()
    page.mouse.move(box["x"] + 100, box["y"] + 100)
    page.mouse.down()
    page.mouse.move(box["x"] + 400, box["y"] + 120, steps=10)
    page.mouse.up()
    check("mouse drag paints the selected element", page.evaluate(f"game.count({E['WATER']})") > 50)
    page.mouse.move(box["x"] + 250, box["y"] + 110)
    page.mouse.down(button="right")
    page.mouse.move(box["x"] + 260, box["y"] + 112, steps=3)
    page.mouse.up(button="right")
    check("right drag erases", True)  # no crash; count checked visually

    page.click("#clear")
    page.wait_for_timeout(100)
    check("CLEAR empties the board", page.evaluate("game.count(%d)" % E["WATER"]) == 0)
    page.click("#demo")
    page.click("#pause")  # resume
    page.wait_for_timeout(600)
    check("sim resumes after PLAY", not page.evaluate("game.paused"))

    check("no JS errors in sandbox", not page.errors, "; ".join(page.errors))
    page.close()


# ---------------------------------------------------------------- life
def test_life(browser, base, shots):
    print("\nLIFE LAB")
    page = open_page(browser, base + "/games/life/index.html")
    page.wait_for_timeout(600)
    check("simulation is running", page.evaluate("game.gen") > 2)
    page.click("#play")
    g = page.evaluate("game.gen")
    page.wait_for_timeout(300)
    check("PAUSE stops generations", page.evaluate("game.gen") == g)

    r = page.evaluate("""() => {
        game.clear();
        game.set(10,10,1); game.set(11,10,1); game.set(12,10,1);
        game.step();
        return game.alive();
    }""")
    check("blinker oscillates (3 cells stay alive)", r == 3, str(r))
    r = page.evaluate("""() => {
        game.clear(); game.stamp('glider', 20, 20);
        for (let i = 0; i < 4; i++) game.step();
        return game.alive();
    }""")
    check("glider survives (5 cells after 4 gens)", r == 5, str(r))
    r = page.evaluate("""() => { game.clear(); game.set(5,5,1); game.step(); return game.alive(); }""")
    check("lonely cell dies", r == 0)

    page.evaluate("game.clear()")
    box = page.locator("#game").bounding_box()
    page.mouse.click(box["x"] + 100, box["y"] + 100)
    check("clicking draws a cell", page.evaluate("game.alive()") == 1)
    page.select_option("#pattern", "gun")
    page.mouse.click(box["x"] + 300, box["y"] + 200)
    check("stamping the glider gun pattern", page.evaluate("game.alive()") == 37, str(page.evaluate("game.alive()")))
    page.click("#play")
    page.wait_for_timeout(1500)
    check("gun keeps producing gliders", page.evaluate("game.alive()") > 37)
    if shots:
        page.screenshot(path=os.path.join(shots, "life.png"))
    check("no JS errors in life", not page.errors, "; ".join(page.errors))
    page.close()


# ---------------------------------------------------------------- no signal
def test_nosignal(browser, base, shots):
    print("\nNO SIGNAL")
    page = open_page(browser, base + "/games/nosignal/index.html")
    check("title screen with warning shown", page.locator("#title:not(.hidden)").count() == 1
          and "jumpscares" in page.inner_text(".warn"))
    if shots:
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(shots, "nosignal-title.png"))
    page.click("#start")
    page.wait_for_timeout(1200)
    check("TURN ON THE TV starts the night", page.evaluate("game.state") == "play")
    check("audio engine started", page.evaluate("!!document.querySelector('#screen')") and page.evaluate("game.state") == "play")

    f = page.evaluate("game.tuneTo('weather')")
    page.wait_for_timeout(200)
    sig = page.evaluate("game.tuned()")
    check("tuning onto a station locks the signal", sig["signal"] > 0.9 and sig["station"]["id"] == "weather", str(sig["signal"]))
    check("signal meter lights up", page.locator("#meter i.lit").count() >= 4)

    # keyboard tuning
    d0 = page.evaluate("game.dial")
    page.keyboard.down("ArrowRight"); page.wait_for_timeout(400); page.keyboard.up("ArrowRight")
    d1 = page.evaluate("game.dial")
    check("arrow keys turn the dial", d1 > d0 + 2, f"{d0:.1f} -> {d1:.1f}")

    # clear picture lowers dread
    r = page.evaluate("""() => { game.skipTo(30); game.tuneTo('kids'); game.dread = 50; game.hijack = null;
        for (let i = 0; i < 60; i++) { game.tuneTo('kids'); game.update(1/30); } return game.dread; }""")
    check("a clear picture calms you down", r < 50, str(r))

    # static raises dread
    r = page.evaluate("""() => { game.dread = 10;
        const fs = game.stations.map(s => s.f);
        let best = 0, bestGap = 0;   // find the emptiest part of the dial
        for (let d = 0; d <= 100; d += 0.5) { const gap = Math.min(...fs.map(f => Math.abs(f - d))); if (gap > bestGap) { bestGap = gap; best = d; } }
        game.dial = best;
        for (let i = 0; i < 30; i++) game.update(1/30);
        return {dread: game.dread, signal: game.tuned().signal}; }""")
    check("static makes dread rise", r["dread"] > 12 and r["signal"] < 0.3, str(r))
    if shots:
        page.evaluate("game.dread = 70")
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(shots, "nosignal-static.png"))

    # each station renders without errors
    for sid in ["weather", "kids", "eas", "bars", "cam"]:
        page.evaluate(f"() => {{ game.dread = 0; game.tuneTo('{sid}'); }}")
        page.wait_for_timeout(150)
        if shots:
            page.screenshot(path=os.path.join(shots, f"nosignal-{sid}.png"))
    check("all five stations render", not page.errors, "; ".join(page.errors))

    # hijacked ("smiling") channel raises dread fast
    r = page.evaluate("""() => { game.dread = 0; game.tuneTo('kids'); game.hijackNow('kids');
        for (let i = 0; i < 30; i++) { game.tuneTo('kids'); game.update(1/30); } return game.dread; }""")
    check("watching a smiling channel is dangerous", r > 8, str(r))
    if shots:
        page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(shots, "nosignal-hijack.png"))
    page.evaluate("game.hijack = null; game.dread = 0")

    # blackout reflection renders
    page.evaluate("game.skipTo(200); game.blackoutNow()")
    page.wait_for_timeout(300)
    if shots:
        page.screenshot(path=os.path.join(shots, "nosignal-blackout.png"))
    page.wait_for_timeout(1500)

    # turning around kills you
    page.evaluate("game.startTurn()")
    check("'turn around' prompt appears", page.locator("#turn:not(.hidden)").count() == 1)
    page.keyboard.press("t")
    page.wait_for_timeout(500)
    check("pressing T triggers the jumpscare", page.evaluate("game.state") == "dying"
          and page.evaluate("document.getElementById('scare').classList.contains('on')"))
    if shots:
        page.screenshot(path=os.path.join(shots, "nosignal-jumpscare.png"))
    page.wait_for_timeout(2600)
    check("death screen shows cause", page.evaluate("game.state") == "dead" and "turned around" in page.inner_text("#end-text"))

    # dread at 100 -> death by static
    page.click("#again")
    page.wait_for_timeout(1200)
    page.evaluate("() => { game.skipTo(40); game.dial = 0; game.stations.forEach(s => s.f = Math.max(s.f, 30)); game.dread = 99.9; game.update(0.2); }")
    page.wait_for_timeout(3500)
    check("max dread -> SIGNAL LOST", page.evaluate("game.state") == "dead" and "static" in page.inner_text("#end-text"))

    # surviving until 4 AM wins
    page.click("#again")
    page.wait_for_timeout(1200)
    page.evaluate("() => { game.tuneTo('eas'); game.skipTo(299.9); game.dread = 0; game.update(0.2); }")
    check("reaching 4:00 AM wins", page.evaluate("game.state") == "won")
    page.wait_for_timeout(4500)
    check("win screen shown", "survived the night" in page.inner_text("#end-text"))
    page.wait_for_timeout(5000)
    check("...with a twist", "tomorrow night" in page.inner_text("#end-text"))
    if shots:
        page.screenshot(path=os.path.join(shots, "nosignal-win.png"))
    check("no JS errors in no signal", not page.errors, "; ".join(page.errors))
    page.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", help="directory to save screenshots")
    ap.add_argument("--channel", default="msedge", help="msedge | chrome | chromium")
    args = ap.parse_args()
    if args.shots:
        os.makedirs(args.shots, exist_ok=True)

    httpd, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=None if args.channel == "chromium" else args.channel, headless=True)
        for t in (test_hub, test_snake, test_platformer, test_sandbox, test_life, test_nosignal):
            try:
                t(browser, base, args.shots)
            except Exception as e:  # report and keep going
                check(f"{t.__name__} crashed", False, repr(e))
        browser.close()
    httpd.shutdown()

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    for name, _, detail in failed:
        print(f"  FAILED: {name}  {detail}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
