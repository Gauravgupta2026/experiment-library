export interface SpringState { x: number; v: number }

/**
 * One integration step of a critically damped spring: a = w^2 (target - x) - 2 w v.
 * Critical damping reaches the target fast and never overshoots, so a state change at any moment is smooth.
 */
export function stepSpring(s: SpringState, target: number, omega: number, dt: number): void {
  const a = omega * omega * (target - s.x) - 2 * omega * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

/**
 * Closed-form unit step response of a spring (mass 1) at time t: 0 at t = 0, settles at 1.
 * Timeline experiments use this because their state must be a pure function of time (seek = play).
 */
export function springAt(t: number, stiffness: number, damping: number): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Hermite ease, same as GLSL smoothstep on 0..1. */
export const smooth = (x: number): number => { const c = clamp01(x); return c * c * (3 - 2 * c); };
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
/** Progress 0..1 of a tween that starts at `start` and lasts `dur` seconds. */
export const span = (t: number, start: number, dur: number): number => clamp01((t - start) / dur);
