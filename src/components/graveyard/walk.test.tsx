import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraveyardGame } from "./GraveyardGame";
import { WalkField } from "./WalkField";
import { approachPoint, BOUNDS, keyAction, layoutSpots, nearestWithin, REACH, SPEED, START, stepKeys, stepToward } from "./walk";

const NONE = { up: false, down: false, left: false, right: false };

describe("walk mode: movement", () => {
  it("walks at SPEED per second, diagonals no faster, and stays inside the field", () => {
    expect(stepKeys(START, { ...NONE, up: true }, 0.1).pos.y).toBeCloseTo(START.y - SPEED * 0.1, 6);
    const d = stepKeys({ x: 50, y: 50 }, { ...NONE, up: true, right: true }, 0.1).pos;
    expect(Math.hypot(d.x - 50, d.y - 50)).toBeCloseTo(SPEED * 0.1, 6);
    let p = { x: 50, y: 50 };
    for (let i = 0; i < 200; i++) p = stepKeys(p, { ...NONE, left: true, up: true }, 0.1).pos;
    expect(p).toEqual({ x: BOUNDS.minX, y: BOUNDS.minY });
  });
  it("a long frame (tab in the background) cannot teleport the visitor", () => {
    expect(START.y - stepKeys(START, { ...NONE, up: true }, 5).pos.y).toBeCloseTo(SPEED * 0.1, 6);
  });
  it("faces the way it walks and stands still with no keys", () => {
    expect(stepKeys(START, { ...NONE, left: true }, 0.05).facing).toBe("left");
    expect(stepKeys(START, { ...NONE, down: true }, 0.05).facing).toBe("down");
    expect(stepKeys(START, NONE, 0.05)).toEqual({ pos: START, facing: null });
  });
  it("tap-to-walk arrives exactly and never overshoots", () => {
    let p = START;
    let arrived = false;
    for (let i = 0; i < 100 && !arrived; i++) ({ pos: p, arrived } = stepToward(p, { x: 20, y: 30 }, 0.05));
    expect(arrived).toBe(true);
    expect(p).toEqual({ x: 20, y: 30 });
  });
});

describe("walk mode: presences", () => {
  it("lays out every presence once, inside the field, the same way every time", () => {
    const a = layoutSpots(6);
    expect(a).toHaveLength(6);
    expect(layoutSpots(6)).toEqual(a);
    for (const s of a) expect(s.x >= BOUNDS.minX && s.x <= BOUNDS.maxX && s.y >= BOUNDS.minY && s.y <= BOUNDS.maxY).toBe(true);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y)).toBeGreaterThan(REACH);
  });
  it("only a presence within reach can be approached, the nearest first, and the start is out of reach of all", () => {
    const spots = layoutSpots(6);
    expect(nearestWithin(START, spots)).toBeNull();
    expect(nearestWithin(approachPoint(spots[2]), spots)).toBe(2);
    expect(nearestWithin({ x: spots[4].x + REACH + 1, y: spots[4].y }, [spots[4]])).toBeNull();
  });
  it("maps arrows, W A S D and the speak keys; other keys do nothing", () => {
    expect(["ArrowUp", "w", "ArrowDown", "s", "ArrowLeft", "a", "ArrowRight", "d"].map(keyAction)).toEqual(["up", "up", "down", "down", "left", "left", "right", "right"]);
    expect(["e", "E", "Enter", " "].map(keyAction)).toEqual(["speak", "speak", "speak", "speak"]);
    expect(keyAction("Tab")).toBeNull();
  });
});

describe("walk mode: markup", () => {
  const hrefs = ["/repo/a/one", "/repo/b/two", "/repo/c/three"];
  it("is one focusable field with instructions; presences are unnamed and hidden from assistive tech", () => {
    const html = renderToStaticMarkup(<WalkField hrefs={hrefs} />);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain("Walk with the arrow keys or W A S D. Press E next to a presence to approach it.");
    expect((html.match(/data-testid="walk-presence"/g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/\/repo\/|one|two|three/); // no repository is named or linked here
    expect(html).toMatch(/data-testid="walk-visitor"/);
  });
});

describe("the home screen as a game", () => {
  const hrefs = ["/repo/a/one", "/repo/b/two", "/repo/c/three"];
  const html = renderToStaticMarkup(<GraveyardGame hrefs={hrefs} />);
  it("is the walkable graveyard, with the page heading, the command line and the controls", () => {
    expect(html).toMatch(/<h1[^>]*>GitGhost<\/h1>/);
    expect(html).toContain('data-testid="walk-field"');
    expect(html).toContain('id="summon-input"'); // speak a name: still a real form
    expect(html).toMatch(/Ghosts are fictional\. Repository facts come from GitHub\./);
  });
  it("offers the same choice as walking, as a plain list of unnamed presences", () => {
    expect((html.match(/data-testid="presence"/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Approach presence 2 of 3"');
    expect(html).not.toMatch(/\/repo\/|>one<|>two<|>three</); // no repository is named or linked
  });
  it("the title card is decoration: the page has exactly one h1", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
});
