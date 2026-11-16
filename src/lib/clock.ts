export type TickFn = (t: number, dt: number) => void;

const MAX_DT = 1 / 30;

/**
 * The only time source for an experiment.
 * One requestAnimationFrame loop per clock. dt is clamped so a slow frame cannot make physics jump.
 */
export class Clock {
  now = 0;
  rate = 1;
  playing = true;
  loop = true;
  /** Timeline length in seconds. Undefined = the clock runs without end. */
  duration: number | undefined;
  private cbs = new Set<TickFn>();
  private raf = 0;
  private last = 0;
  private suspended = false;
  private listeners = new Set<() => void>();

  constructor(duration?: number) { this.duration = duration; }

  /** Subscribe to frames. Returns the unsubscribe function. */
  onTick(cb: TickFn): () => void { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  /** Subscribe to play/pause/seek changes (for the transport UI). */
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  start(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    this.last = performance.now();
    const loop = (ms: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(MAX_DT, (ms - this.last) / 1000);
      this.last = ms;
      if (this.playing && !this.suspended) this.advance(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Move time forward by dt seconds (already clamped by the caller) and emit one frame. */
  advance(dt: number): void {
    const step = dt * this.rate;
    let t = this.now + step;
    if (this.duration !== undefined && t >= this.duration) {
      if (this.loop) t %= this.duration;
      else { t = this.duration; this.playing = false; this.changed(); }
    }
    this.now = t;
    this.emit(step);
  }

  seek(t: number): void {
    this.now = this.duration !== undefined ? Math.max(0, Math.min(this.duration, t)) : Math.max(0, t);
    this.emit(0);
    this.changed();
  }

  setPlaying(p: boolean): void {
    if (p && this.duration !== undefined && !this.loop && this.now >= this.duration) this.now = 0;
    this.playing = p;
    this.changed();
  }

  /** Stop frames while the tab is hidden or the stage is off screen. Does not change `playing`. */
  setSuspended(s: boolean): void { this.suspended = s; this.last = typeof performance !== 'undefined' ? performance.now() : 0; }

  /** Emit a frame with dt = 0. Used after a parameter change while paused. */
  refresh(): void { this.emit(0); }

  destroy(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.cbs.clear(); this.listeners.clear(); }

  private emit(dt: number): void { for (const cb of this.cbs) cb(this.now, dt); }
  private changed(): void { for (const cb of this.listeners) cb(); }
}
