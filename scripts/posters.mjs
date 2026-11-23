// Captures a poster for every experiment in the registry and writes public/posters/<id>.webp.
// Run: npm run posters   (starts its own Vite server on a free port)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const POSTER_WIDTH = 1200;
const WEBP_QUALITY = 0.82;

// The registry is TypeScript; the ids and aspects are read from its source.
const src = readFileSync('src/experiments/registry.ts', 'utf8');
const entries = [...src.matchAll(/id: '([a-z0-9-]+)'[\s\S]*?aspect: ([\d.]+) \/ ([\d.]+)/g)].map((m) => ({ id: m[1], aspect: Number(m[2]) / Number(m[3]) }));
if (!entries.length) throw new Error('No experiments found in the registry');

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync('public/posters', { recursive: true });

try {
  for (const { id, aspect } of entries) {
    const height = Math.round(POSTER_WIDTH / 2 / aspect);
    const page = await browser.newPage({ viewport: { width: POSTER_WIDTH / 2, height }, deviceScaleFactor: 2 });
    await page.goto(`${base}/e/${id}?capture=1&poster=1`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    await page.waitForTimeout(300);   // images in the DOM layer decode
    const png = await page.locator('#frame').screenshot({ type: 'png' });
    // Encode WebP in the browser: no image library is needed.
    const b64 = await page.evaluate(async ({ data, q }) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', q).split(',')[1];
    }, { data: png.toString('base64'), q: WEBP_QUALITY });
    const out = Buffer.from(b64, 'base64');
    writeFileSync(`public/posters/${id}.webp`, out);
    console.log(`${id}.webp  ${(out.length / 1024).toFixed(0)} KB`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
