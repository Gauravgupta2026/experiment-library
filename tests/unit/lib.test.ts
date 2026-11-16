import { describe, expect, it } from 'vitest';
import { Clock } from '../../src/lib/clock';
import { columnsFor, placeMasonry } from '../../src/lib/masonry';
import { decodeParams, encodeParams, snap } from '../../src/lib/params';
import { hash01, mulberry32 } from '../../src/lib/prng';
import { springAt, stepSpring } from '../../src/lib/spring';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../../src/lib/color';
import { color, num, segmented, text, toggle, image, type ControlGroup, type Params } from '../../src/experiments/types';

const groups: ControlGroup[] = [{
  title: 'G',
  controls: [num('size', 'Size', 0, 10, 0.5), color('tint', 'Tint'), segmented('mode', 'Mode', ['A', 'B']), toggle('on', 'On'), text('title', 'Title', 8), image('img', 'Image')],
}];
const defaults: Params = { size: 2, tint: '#FF0000', mode: 'A', on: true, title: 'hi', img: '' };

describe('params codec', () => {
  it('round trips a change', () => {
    const p = { ...defaults, size: 7.5, tint: '#00FF00', mode: 'B', on: false, title: 'héllo' };
    expect(decodeParams(encodeParams(p, defaults, groups), defaults, groups)).toEqual(p);
  });
  it('encodes nothing when nothing differs', () => { expect(encodeParams(defaults, defaults, groups)).toBe(''); });
  it('never puts images in the link', () => {
    const enc = encodeParams({ ...defaults, img: 'blob:x' }, defaults, groups);
    expect(enc).toBe('');
  });
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  it('rejects a wrong type', () => { expect(decodeParams(enc({ size: '7' }), defaults, groups).size).toBe(2); });
  it('rejects a value out of range', () => { expect(decodeParams(enc({ size: 99 }), defaults, groups).size).toBe(2); });
  it('rejects NaN and Infinity', () => { expect(decodeParams(enc({ size: null }), defaults, groups).size).toBe(2); });
  it('drops an unknown key', () => { expect(decodeParams(enc({ evil: 1, __proto__: { x: 1 } }), defaults, groups)).toEqual(defaults); });
  it('rejects an unknown option', () => { expect(decodeParams(enc({ mode: 'C' }), defaults, groups).mode).toBe('A'); });
  it('rejects a bad colour', () => { expect(decodeParams(enc({ tint: 'red' }), defaults, groups).tint).toBe('#FF0000'); });
  it('rejects text over the limit', () => { expect(decodeParams(enc({ title: '123456789' }), defaults, groups).title).toBe('hi'); });
  it('rejects an image value', () => { expect(decodeParams(enc({ img: 'https://x/y.png' }), defaults, groups).img).toBe(''); });
  it('survives broken base64 and non-objects', () => {
    expect(decodeParams('%%%', defaults, groups)).toEqual(defaults);
    expect(decodeParams(enc([1, 2]), defaults, groups)).toEqual(defaults);
    expect(decodeParams(enc('x'), defaults, groups)).toEqual(defaults);
  });
  it('snaps to the step', () => { expect(snap(3.26, 0, 10, 0.5)).toBe(3.5); expect(snap(99, 0, 10, 0.5)).toBe(10); expect(snap(0.123, 0, 1, 0.01)).toBe(0.12); });
});

describe('clock', () => {
  it('a seek gives the same time as play', () => {
    const a = new Clock(8), b = new Clock(8);
    for (let i = 0; i < 150; i++) a.advance(1 / 60);
    b.seek(2.5);
    expect(a.now).toBeCloseTo(b.now, 6);
  });
  it('loops at the duration', () => { const c = new Clock(2); c.advance(1.5); c.advance(1); expect(c.now).toBeCloseTo(0.5, 6); });
  it('stops at the end when loop is off', () => { const c = new Clock(2); c.loop = false; c.advance(1.5); c.advance(1); expect(c.now).toBe(2); expect(c.playing).toBe(false); });
  it('applies the rate', () => { const c = new Clock(); c.rate = 2; c.advance(0.5); expect(c.now).toBe(1); });
  it('emits a frame with dt 0 on seek', () => { const c = new Clock(8); let got = -1; c.onTick((_t, dt) => { got = dt; }); c.seek(3); expect(got).toBe(0); });
});

describe('masonry', () => {
  it('uses the shortest column and keeps order', () => {
    const { items, height } = placeMasonry([100, 50, 80, 40], 2, 8);
    expect(items.map((i) => i.column)).toEqual([0, 1, 1, 0]);
    expect(items[2]?.top).toBe(58);
    expect(height).toBe(148);
  });
  it('gives the column count for a width', () => { expect([1500, 1100, 700, 390].map(columnsFor)).toEqual([4, 3, 2, 1]); });
});

describe('prng and spring', () => {
  it('is deterministic for a seed', () => { const a = mulberry32(7), b = mulberry32(7); expect([a(), a(), a()]).toEqual([b(), b(), b()]); });
  it('hash01 is stable and in range', () => { const h = hash01(3, 9, 2); expect(h).toBe(hash01(3, 9, 2)); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); });
  it('a critically damped spring settles with no overshoot', () => {
    const s = { x: 0, v: 0 }; let max = 0;
    for (let i = 0; i < 600; i++) { stepSpring(s, 1, 14, 1 / 120); max = Math.max(max, s.x); }
    expect(s.x).toBeCloseTo(1, 3); expect(max).toBeLessThanOrEqual(1.0001);
  });
  it('springAt starts at 0, settles at 1, and overshoots when underdamped', () => {
    expect(springAt(0, 260, 22)).toBe(0);
    expect(springAt(3, 260, 22)).toBeCloseTo(1, 3);
    let max = 0; for (let t = 0; t < 1; t += 0.005) max = Math.max(max, springAt(t, 260, 22));
    expect(max).toBeGreaterThan(1.001);
  });
});

describe('color', () => {
  it('converts hex both ways', () => { expect(rgbToHex(...hexToRgb('#FA434C'))).toBe('#FA434C'); });
  it('converts hsv both ways', () => { const [h, s, v] = rgbToHsv(...hexToRgb('#2F6BFF')); expect(rgbToHex(...hsvToRgb(h, s, v))).toBe('#2F6BFF'); });
});
