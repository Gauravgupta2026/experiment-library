/**
 * Seeded pseudo-random generator (mulberry32).
 * Experiments use this in place of Math.random(), so a given seed always gives the same frames.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash of up to three numbers to 0..1. For values that must be a pure function of time. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(Math.floor(a) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.floor(b) ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ Math.floor(c) ^ (h >>> 16), 0x27d4eb2f);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
