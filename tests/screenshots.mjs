// 画面のスクリーンショットを撮って表示を確かめるためのスクリプト（Playwright を使用）。
// CDN のライブラリは node_modules の同じバージョンに差し替えて読み込む。
// 使い方: node tests/screenshots.mjs <保存先フォルダ> [位置 u をカンマ区切りで] [パターン番号をカンマ区切りで]

import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || 'screenshots';
const points = (process.argv[3] || '0,0.15,0.3,0.45,0.6,0.75,1').split(',').map(Number);
const patterns = (process.argv[4] || '1').split(',').map(Number);
const ORIGIN = 'http://box-net.test/';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export async function openPage(browser, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    let file;
    const cdn = url.href.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(@?[^@/]+(?:\/[^@/]+)?)@[^/]+\/(.*)$/);
    if (cdn) file = path.join(root, 'node_modules', cdn[1], cdn[2]);
    else if (url.origin + '/' === ORIGIN) file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    else return route.abort();
    try {
      const body = await readFile(file);
      await route.fulfill({ body, contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
    } catch {
      console.log('[404]', url.href);
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  await page.goto(ORIGIN);
  await page.waitForFunction(() => window.boxNet);
  return page;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await openPage(browser);
  await page.screenshot({ path: path.join(outDir, 'page.png') });
  for (const p of patterns) {
    await page.evaluate((p) => window.boxNet.setPattern(p), p);
    for (const u of points) {
      await page.evaluate((u) => window.boxNet.setU(u), u);
      await page.locator('#view').screenshot({ path: path.join(outDir, `p${p}-u${u.toFixed(3)}.png`) });
    }
  }
  await browser.close();
}
