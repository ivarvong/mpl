// The README's interactive screenshot: examples/interactive.ts's first chart in headless Chromium at 2×, hovered
// so the crosshair, nearest-point tooltip and dimming show. A browser screenshot (not an mpljs render), so it is
// not byte-checked; rerun it when the client's look changes:
//   node scripts/readme_interactive.ts      (needs `npx playwright install chromium-headless-shell`)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url);
execFileSync(process.execPath, ['examples/interactive.ts'], { cwd: ROOT, stdio: 'pipe' });
const html = readFileSync(new URL('examples/out/interactive.html', ROOT), 'utf8');
const executablePath = process.env['CHROMIUM_PATH'];
const browser = await chromium.launch(typeof executablePath === 'string' && executablePath !== '' ? { executablePath } : {});
try {
  const page = await (await browser.newContext({ viewport: { width: 760, height: 700 }, deviceScaleFactor: 2, colorScheme: 'light' })).newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.mpl-overlay').length === 4);
  // hover the sin line's 13th point (x = 2), as a reader would
  const p = await page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('#lines');
    const md = svg?.querySelector('g[data-mpl-axes="0"] > metadata');
    const art = JSON.parse(md?.textContent ?? '{}').a[0];
    const q = new DOMPoint(art.p[24], art.p[25]).matrixTransform(svg?.getScreenCTM() ?? new DOMMatrix());
    return { x: q.x, y: q.y };
  });
  await page.mouse.move(p.x, p.y);
  await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); }));
  await page.waitForTimeout(300);   // the dimming transition
  const out = new URL('docs/images/readme/interactive.png', ROOT).pathname;
  await page.locator('#lines').screenshot({ path: out });
  console.log('wrote docs/images/readme/interactive.png');
} finally {
  await browser.close();
}
