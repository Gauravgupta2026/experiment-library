import { expect, test } from '@playwright/test';

/**
 * Spike from the node-system design (Stage 1): how long does one trait change cost?
 * The viewer pushes merged params through instance.update() once per frame. The budget is 4 ms of
 * main-thread time per change, measured with a 4x CPU slowdown (a mid-range laptop on battery).
 * update() is followed by clock.refresh() so the cost includes one full redraw.
 */
const BUDGET_MS = 4;
const CPU_SLOWDOWN = 4;
const RUNS = 40;

interface Change { label: string; keys: Record<string, string[] | [number, number]> }
const CASES: Record<string, Change[]> = {
  'sun-orb': [
    { label: 'palette', keys: { domeTop: ['#FDFDF3', '#E0F0FF'], glowSide: ['#FF9678', '#40C0FF'], band: ['#FDE0FC', '#FFD080'] } },
    { label: 'softness', keys: { softness: [0.5, 2.2] } },
  ],
  'modern-creatives': [
    { label: 'palette', keys: { red: ['#FA434C', '#3050FF'], magenta: ['#E98ADE', '#40E0A0'] } },
    { label: 'softness', keys: { edgeSoft: [0.2, 0.5] } },
  ],
  imagine: [
    { label: 'palette', keys: { pal1: ['#D65C92', '#40A0FF'], bgTop: ['#FACA96', '#C0F0E0'] } },
    { label: 'softness', keys: { softness: [0.5, 2.5] } },
  ],
};

for (const [id, changes] of Object.entries(CASES)) {
  test(`update() cost: ${id}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/e/${id}?capture=1&t=3`);
    await page.waitForFunction(() => window.__ready === true);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    for (const change of changes) {
      const times = await page.evaluate(({ keys, runs }) => {
        const h = window.__stage, start = window.__params;
        if (!h || !start) throw new Error('no stage handle');
        const out: number[] = [];
        let base: Record<string, unknown> = { ...start };
        for (let i = 0; i < runs; i++) {
          const next: Record<string, unknown> = { ...base };
          for (const [k, pair] of Object.entries(keys)) next[k] = (pair as unknown[])[i % 2];
          const t0 = performance.now();
          h.instance.update(next as never);
          h.clock.refresh();
          out.push(performance.now() - t0);
          base = next;
        }
        return out;
      }, { keys: change.keys, runs: RUNS });
      const sorted = times.slice(2).sort((a, b) => a - b);   // drop the first two (warm-up)
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
      console.log(`${id} ${change.label}: median ${median.toFixed(2)} ms, p90 ${p90.toFixed(2)} ms (CPU x${CPU_SLOWDOWN})`);
      expect(median, `${id} ${change.label} median`).toBeLessThanOrEqual(BUDGET_MS);
    }
  });
}
