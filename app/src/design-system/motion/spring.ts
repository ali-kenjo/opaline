// The in-house spring solver (docs/DESIGN.md §6): a damped harmonic oscillator with mass 1,
// stepped with its exact solution, so it's stable at any frame time and stiffness, and it
// keeps its velocity when the target changes mid-flight.
import { type SpringToken, springs } from "../tokens/tokens";

export interface SpringParams {
  stiffness: number;
  /** Damping ratio ζ: 1 = critically damped (no overshoot), < 1 overshoots. */
  damping: number;
}

const REST_DELTA = 1e-3;
const REST_VELOCITY = 1e-2;

/** Advances displacement `d` (value − target) and velocity `v` by `dt` seconds. */
export function stepSpring(
  d: number,
  v: number,
  dt: number,
  { stiffness, damping }: SpringParams,
): [number, number] {
  const w0 = Math.sqrt(stiffness);
  const z = damping;
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w0 * dt);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    const b = (v + z * w0 * d) / wd;
    const nd = e * (d * c + b * s);
    const nv = e * (-z * w0 * (d * c + b * s) + (-d * wd * s + b * wd * c));
    return [nd, nv];
  }
  if (z === 1) {
    const e = Math.exp(-w0 * dt);
    const b = v + w0 * d;
    return [(d + b * dt) * e, (v - w0 * b * dt) * e];
  }
  // Overdamped.
  const r1 = -w0 * (z - Math.sqrt(z * z - 1));
  const r2 = -w0 * (z + Math.sqrt(z * z - 1));
  const c2 = (v - r1 * d) / (r2 - r1);
  const c1 = d - c2;
  const e1 = Math.exp(r1 * dt);
  const e2 = Math.exp(r2 * dt);
  return [c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
}

export function params(token: SpringToken | SpringParams): SpringParams {
  return typeof token === "string" ? springs[token] : token;
}

function resting(value: number, target: number, velocity: number): boolean {
  return Math.abs(value - target) < REST_DELTA && Math.abs(velocity) < REST_VELOCITY;
}

/** One animated number. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  readonly params: SpringParams;

  constructor(initial: number, token: SpringToken | SpringParams = "spatialDefault") {
    this.value = initial;
    this.target = initial;
    this.params = params(token);
  }

  /** Retargets; the current velocity carries over, so interruptions stay smooth. */
  setTarget(target: number): void {
    this.target = target;
  }

  /** Jumps to a value with no motion (reduced motion, first layout). */
  snap(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  get atRest(): boolean {
    return (
      Math.abs(this.value - this.target) < REST_DELTA && Math.abs(this.velocity) < REST_VELOCITY
    );
  }

  /** Advances by `dt` seconds; returns whether it is still moving. */
  step(dt: number): boolean {
    if (this.atRest) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    const [d, v] = stepSpring(this.value - this.target, this.velocity, dt, this.params);
    this.value = this.target + d;
    this.velocity = v;
    if (resting(this.value, this.target, this.velocity)) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}
