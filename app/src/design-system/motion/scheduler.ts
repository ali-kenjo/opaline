// One requestAnimationFrame loop for every animation (docs/DESIGN.md §6): springs step first,
// then frame callbacks (DOM writes, the glass compositor) run with the same timestamp, so
// glass and content never drift apart. No frames at all while nothing moves.

export interface Animator {
  /** Advances by `dt` seconds; returns `true` while it still needs frames. */
  step(dt: number): boolean;
}

type FrameCallback = (now: number) => void;

export interface Clock {
  request(cb: (now: number) => void): number;
  cancel(id: number): void;
}

const browserClock: Clock = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => {
    cancelAnimationFrame(id);
  },
};

/** Longest step a frame may take (a stalled tab must not explode the springs' time). */
const MAX_DT = 1 / 15;

export class Scheduler {
  private readonly animators = new Set<Animator>();
  private readonly frameCallbacks = new Set<FrameCallback>();
  private frame: number | null = null;
  private last: number | null = null;
  /** Frames rendered since creation (for tests and the Lab's frame meter). */
  frames = 0;

  constructor(private readonly clock: Clock = browserClock) {}

  get running(): boolean {
    return this.frame !== null;
  }

  /** Runs `animator` until it reports it's done. */
  add(animator: Animator): void {
    this.animators.add(animator);
    this.wake();
  }

  remove(animator: Animator): void {
    this.animators.delete(animator);
  }

  /** Called on every frame while anything animates (and once after `invalidate`). */
  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.add(cb);
    return () => this.frameCallbacks.delete(cb);
  }

  /** Requests one frame even if nothing animates (layout or theme changed). */
  invalidate(): void {
    this.wake();
  }

  private wake(): void {
    this.frame ??= this.clock.request(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = null;
    const dt =
      this.last === null ? 1 / 60 : Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    for (const a of this.animators) {
      if (!a.step(dt)) this.animators.delete(a);
    }
    for (const cb of this.frameCallbacks) cb(now);
    this.frames++;
    if (this.animators.size > 0) this.wake();
    else this.last = null;
  };
}

/** The scheduler every layer window shares. */
export const scheduler = new Scheduler(
  typeof requestAnimationFrame === "function" ? browserClock : undefined,
);

/** Reduced motion (GNOME `enable-animations = false` or reduced-motion): springs snap. */
let reduced =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function reducedMotion(): boolean {
  return reduced;
}

export function setReducedMotion(value: boolean): void {
  reduced = value;
}
