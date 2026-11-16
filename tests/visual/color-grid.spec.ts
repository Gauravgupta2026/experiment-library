import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

interface Point { x: number; y: number; hex: string }
interface Grid { frame: string; points: Point[] }
const grids = JSON.parse(readFileSync(new URL('../../reference/color-grids.json', import.meta.url), 'utf8')) as Record<string, Grid>;

const BLOCK = 4;   // 9 x 9 average, as in the reference grids

/** Open an experiment in capture mode at the aspect of its reference frame and return a PNG of the frame. */
async function captureFrame(page: Page, url: string, width: number, height: number): Promise<PNG> {
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true);
  return PNG.sync.read(await page.locator('#frame').screenshot({ type: 'png' }));
}

/** Per point: the largest channel difference from the reference. Returns the mean and the maximum. */
function compare(png: PNG, points: Point[], only?: (p: Point) => boolean): { mean: number; max: number; worst: string } {
  let sum = 0, max = 0, count = 0, worst = '';
  for (const p of points) {
    if (only && !only(p)) continue;
    const cx = Math.floor(p.x * png.width), cy = Math.floor(p.y * png.height);
    const acc = [0, 0, 0]; let k = 0;
    for (let dy = -BLOCK; dy <= BLOCK; dy++) for (let dx = -BLOCK; dx <= BLOCK; dx++) {
      const x = Math.min(png.width - 1, Math.max(0, cx + dx)), y = Math.min(png.height - 1, Math.max(0, cy + dy));
      const i = (y * png.width + x) * 4;
      acc[0] += png.data[i] ?? 0; acc[1] += png.data[i + 1] ?? 0; acc[2] += png.data[i + 2] ?? 0; k++;
    }
    const ref = [1, 3, 5].map((o) => parseInt(p.hex.slice(o, o + 2), 16));
    const d = Math.max(...acc.map((v, c) => Math.abs(v / k - (ref[c] ?? 0))));
    sum += d; count++;
    if (d > max) { max = d; worst = `(${p.x}, ${p.y}) ref ${p.hex} diff ${d.toFixed(0)}`; }
  }
  return { mean: sum / Math.max(1, count), max, worst };
}

const grid = (name: string): Grid => { const g = grids[name]; if (!g) throw new Error(`No grid ${name}`); return g; };

test('sun orb: default state matches the reference', async ({ page }) => {
  const png = await captureFrame(page, '/e/sun-orb?capture=1&state=default', 955, 850);
  const r = compare(png, grid('sun-orb.default').points);
  console.log('sun-orb.default', r);
  expect(r.mean).toBeLessThanOrEqual(8);
  expect(r.max).toBeLessThanOrEqual(35);
});

test('sun orb: approved state matches the reference', async ({ page }) => {
  const png = await captureFrame(page, '/e/sun-orb?capture=1&state=approved', 955, 850);
  const r = compare(png, grid('sun-orb.approved').points);
  console.log('sun-orb.approved', r);
  expect(r.mean).toBeLessThanOrEqual(9);
});

test('modern creatives: gradient matches the reference', async ({ page }) => {
  // shaderTime=5 puts the drifting blobs where they were when the prototype was measured.
  const png = await captureFrame(page, '/e/modern-creatives?capture=1&t=6.2&shaderTime=5', 1511, 854);
  // The headline covers the middle row in the reference frame and in ours, at slightly different places.
  // Those points measure text, not gradient, so they are left out.
  const r = compare(png, grid('modern-creatives.gradient').points, (p) => !(p.y === 0.5 && p.x > 0.15 && p.x < 0.85));
  console.log('modern-creatives.gradient', r);
  expect(r.mean).toBeLessThanOrEqual(10);
});

test('imagine: figure matches the reference', async ({ page }) => {
  const png = await captureFrame(page, '/e/imagine?capture=1&t=0.5', 1511, 854);
  const points = grid('imagine.figure').points;
  const r = compare(png, points);
  console.log('imagine.figure', r);
  expect(r.mean).toBeLessThanOrEqual(9);
  expect(r.max).toBeLessThanOrEqual(40);
  // Points outside the figure are pure background: they must be almost exact.
  const bg = compare(png, points, (p) => p.x < 0.2 || p.x > 0.8);
  expect(bg.max).toBeLessThanOrEqual(4);
});
