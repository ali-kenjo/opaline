// Animated palette changes (docs/DESIGN.md §3): every --md-* role moves from its current color
// to the new scheme on one effects spring, in the same scheduler as everything else.
import { type Animator, reducedMotion, scheduler } from "./scheduler";
import { Spring } from "./spring";

type Triples = Record<string, [number, number, number]>;

const parse = (t: string): [number, number, number] => {
  const [r = 0, g = 0, b = 0] = t.trim().split(/\s+/).map(Number);
  return [r, g, b];
};

class PaletteTransition implements Animator {
  private readonly spring = new Spring(0, "effectsSlow");

  constructor(
    private readonly el: HTMLElement,
    private readonly from: Triples,
    private readonly to: Triples,
  ) {
    this.spring.setTarget(1);
  }

  step(dt: number): boolean {
    const moving = this.spring.step(dt);
    const t = Math.min(1, Math.max(0, this.spring.value));
    for (const [name, end] of Object.entries(this.to)) {
      const start = this.from[name] ?? end;
      const mix = (i: 0 | 1 | 2) => Math.round(start[i] + (end[i] - start[i]) * t);
      this.el.style.setProperty(name, `${mix(0)} ${mix(1)} ${mix(2)}`);
    }
    return moving;
  }
}

let current: PaletteTransition | null = null;

/** Moves the CSS color roles on `el` to `vars` (`--md-primary: "R G B"`, …). */
export function applyPalette(
  vars: Record<string, string>,
  el: HTMLElement = document.documentElement,
): void {
  const style = getComputedStyle(el);
  const from: Triples = {};
  const to: Triples = {};
  for (const [name, value] of Object.entries(vars)) {
    to[name] = parse(value);
    const now = style.getPropertyValue(name);
    if (now) from[name] = parse(now);
  }
  if (current) scheduler.remove(current);
  if (reducedMotion() || Object.keys(from).length === 0) {
    for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
    current = null;
    return;
  }
  current = new PaletteTransition(el, from, to);
  scheduler.add(current);
}
