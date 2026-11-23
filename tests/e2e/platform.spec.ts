import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** Fail a test on any console error or page error. Known harmless GPU notices are ignored. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
const decodeP = (url: string): Record<string, unknown> => {
  const p = new URL(url).searchParams.get('p');
  return p ? (JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>) : {};
};

test.describe('feed', () => {
  test('shows every experiment, filters by category, keeps the filter in the URL', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('a.card')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Motion experiments' })).toBeVisible();
    // Chips exist only for categories in use.
    await expect(page.locator('.nav-chips a.chip')).toHaveText(['All', 'Shader', 'Type']);
    await page.getByRole('link', { name: 'Type', exact: true }).click();
    await expect(page).toHaveURL(/\?c=Type$/);
    await expect(page.locator('.feed-item:not([data-hidden="true"]) a.card')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Type', exact: true })).toHaveAttribute('aria-current', 'true');
    await page.reload();
    await expect(page.locator('.feed-item:not([data-hidden="true"]) a.card')).toHaveCount(2);
    await page.getByRole('link', { name: 'All', exact: true }).click();
    await expect(page.locator('.feed-item:not([data-hidden="true"]) a.card')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('posters load for every card', async ({ page }) => {
    await page.goto('/');
    const imgs = page.locator('a.card img');
    await expect(imgs).toHaveCount(3);
    for (const img of await imgs.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
  });

  test('hover starts one live preview at a time', async ({ page }) => {
    await page.goto('/');
    await page.locator('a.card').nth(0).hover();
    await expect(page.locator('.card-live[data-on="true"] canvas')).toHaveCount(1);
    await page.locator('a.card').nth(1).hover();
    await expect(page.locator('.card-live[data-on="true"] canvas')).toHaveCount(1);
    await page.mouse.move(5, 500);
    await expect(page.locator('.card-live canvas')).toHaveCount(0);
  });

  test('masonry has no overlap and no horizontal scroll at each width', async ({ page }) => {
    for (const width of [1440, 1024, 700, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.locator('a.card')).toHaveCount(3);
      const boxes = await page.locator('.feed-item:not([data-hidden="true"])').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i] as DOMRect, b = boxes[j] as DOMRect;
        const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        expect(overlap, `items ${i} and ${j} overlap at ${width}px`).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});

test.describe('experiment page', () => {
  test('opens from a card and goes back', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await page.locator('a.card', { hasText: 'Sun Orb States' }).click();
    await expect(page).toHaveURL(/\/e\/sun-orb$/);
    await expect(page.getByRole('heading', { name: 'Sun Orb States' })).toBeVisible();
    await expect(page.locator('#frame canvas')).toHaveCount(1);
    await page.getByRole('button', { name: 'Back to the feed' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(errors).toEqual([]);
  });

  test('a control change updates the URL, and the link restores it', async ({ page, context }) => {
    await page.goto('/e/sun-orb');
    const slider = page.getByRole('slider', { name: 'Softness' });
    await slider.scrollIntoViewIfNeeded();
    await slider.focus();
    await page.keyboard.press('Shift+ArrowRight');   // +10 steps of 0.05
    await expect(slider).toHaveAttribute('aria-valuenow', '1.5');
    await expect.poll(() => decodeP(page.url())).toEqual({ softness: 1.5 });

    // A pointer drag on the track also works.
    const box = await slider.boundingBox();
    if (!box) throw new Error('no slider box');
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 4 });   // past the end: pointer capture clamps to the max
    await page.mouse.up();
    await expect(slider).toHaveAttribute('aria-valuenow', '2.5');

    // The URL updates 200 ms after the last change: wait for it before reading the link.
    await expect.poll(() => decodeP(page.url())).toEqual({ softness: 2.5 });
    const link = page.url();
    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByRole('slider', { name: 'Softness' })).toHaveAttribute('aria-valuenow', '2.5');
    await other.close();
  });

  test('the value field accepts typing and rejects junk', async ({ page }) => {
    await page.goto('/e/sun-orb');
    const field = page.getByRole('textbox', { name: 'Size value' });
    await field.fill('1.2'); await field.press('Enter');
    await expect(page.getByRole('slider', { name: 'Size' })).toHaveAttribute('aria-valuenow', '1.2');
    await field.fill('99'); await field.press('Enter');   // clamped to the max
    await expect(page.getByRole('slider', { name: 'Size' })).toHaveAttribute('aria-valuenow', '1.4');
    await field.fill('abc'); await field.press('Enter');
    await expect(page.getByRole('slider', { name: 'Size' })).toHaveAttribute('aria-valuenow', '1.4');
  });

  test('a bad link is ignored, not trusted', async ({ page }) => {
    const errors = watchErrors(page);
    const bad = Buffer.from(JSON.stringify({ softness: 999, state: 'Hack', __proto__: 1, background: 'red' })).toString('base64url');
    await page.goto(`/e/sun-orb?p=${bad}`);
    await expect(page.getByRole('slider', { name: 'Softness' })).toHaveAttribute('aria-valuenow', '1');
    await page.goto('/e/sun-orb?p=%%%not-base64');
    await expect(page.getByRole('heading', { name: 'Sun Orb States' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('colour control: hex field validates, picker opens and closes', async ({ page }) => {
    await page.goto('/e/sun-orb');
    const hex = page.getByRole('textbox', { name: 'Background hex' });
    await hex.scrollIntoViewIfNeeded();
    await hex.fill('#12345'); await hex.press('Enter');
    await expect(hex).toHaveValue('#FDFDFD');
    await hex.fill('#0c0c12'); await hex.press('Enter');
    await expect(hex).toHaveValue('#0C0C12');
    await page.getByRole('button', { name: 'Background: pick colour' }).click();
    await expect(page.getByRole('dialog', { name: 'Background colour' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/e\/sun-orb/);   // Escape closed the popover, it did not leave the page
  });

  test('presets, reset and randomize', async ({ page }) => {
    await page.goto('/e/sun-orb');
    await page.getByRole('radio', { name: 'Night' }).click();
    await expect(page.getByRole('textbox', { name: 'Background hex' })).toHaveValue('#0C0C12');
    await expect(page.getByRole('radio', { name: 'Night' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByRole('textbox', { name: 'Background hex' })).toHaveValue('#FDFDFD');
    await expect.poll(() => decodeP(page.url())).toEqual({});
    await page.getByRole('button', { name: 'Randomize' }).click();
    await expect.poll(() => Object.keys(decodeP(page.url())).length).toBeGreaterThan(3);
  });

  test('the orb tabs and the panel stay in sync', async ({ page }) => {
    await page.goto('/e/sun-orb');
    await page.locator('.orb-tabs button', { hasText: 'Approved' }).click();
    await expect(page.getByRole('radio', { name: 'Approved' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Dusk' }).click();
    await expect(page.locator('.orb-tabs button', { hasText: 'Dusk' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('timeline: play, pause, scrub, keyboard', async ({ page }) => {
    await page.goto('/e/modern-creatives');
    const time = page.locator('.transport .time');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.locator('.stage').click({ position: { x: 4, y: 200 } });   // focus the page, not a control
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const scrub = page.getByRole('slider', { name: 'Timeline' });
    await scrub.focus();
    await page.keyboard.press('End');
    await expect(time).toContainText('0:08.6 / 0:08.6');
    await page.keyboard.press('Home');
    await expect(time).toContainText('0:00.0 /');
    await page.locator('.stage').click({ position: { x: 4, y: 200 } });
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/e\/imagine$/);
    await expect(page.getByRole('heading', { name: 'Gradient Figure and Pixel Wipe' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/$/);
  });

  test('copy link writes the share URL', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/e/sun-orb');
    const slider = page.getByRole('slider', { name: 'Notch' });
    await slider.scrollIntoViewIfNeeded(); await slider.focus(); await page.keyboard.press('ArrowLeft');
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(decodeP(text)).toEqual({ notch: 0.95 });
  });

  test('unknown experiment shows not found', async ({ page }) => {
    await page.goto('/e/does-not-exist');
    await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  });
});

test.describe('theme and layout', () => {
  test('theme toggle persists and applies before paint', async ({ page }) => {
    await page.goto('/');
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByRole('button', { name: /Use the (dark|light) theme/ }).click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });

  test('mobile: frame fits the width, the sheet opens and closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/e/modern-creatives');
    const frame = await page.locator('#frame').boundingBox();
    expect(frame?.width ?? 0).toBeGreaterThan(350);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const panel = page.locator('aside.panel');
    const closedY = (await panel.boundingBox())?.y ?? 0;
    expect(closedY).toBeGreaterThan(844 - 140);           // peek: only the title shows
    await page.getByRole('button', { name: 'Open or close the controls' }).click();
    await expect.poll(async () => (await panel.boundingBox())?.y ?? 0).toBeLessThan(844 * 0.35);
    await page.getByRole('button', { name: 'Open or close the controls' }).click();
    await expect.poll(async () => (await panel.boundingBox())?.y ?? 0).toBeGreaterThan(844 - 140);
  });

  test('reduced motion: the stage waits on a Play button', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/e/imagine');
    await expect(page.locator('.frame-play')).toBeVisible();
    await expect(page.locator('.transport .time')).toContainText('0:03.3');
    await page.locator('.frame-play').click();
    await expect(page.locator('.frame-play')).toHaveCount(0);
    await ctx.close();
  });
});
