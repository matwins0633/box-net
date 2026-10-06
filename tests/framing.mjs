// 流れ全体で、面が画面の外にはみ出さないかを調べる（Playwright を使用）
import { openPage, launch } from './screenshots.mjs';

const LIMIT = 0.95; // 画面の端から 5% 以内に収める
const browser = await launch();
const page = await openPage(browser);
let ok = true;
for (const pattern of [1, 2, 3, 4]) {
  const res = await page.evaluate((p) => { window.boxNet.setPattern(p); return window.boxNet.framing(); }, pattern);
  const worst = res.reduce((a, b) => (Math.max(b.x, b.y) > Math.max(a.x, a.y) ? b : a));
  const bad = res.filter((r) => r.x > LIMIT || r.y > LIMIT);
  console.log(`パターン${pattern}: 最大 x=${worst.x} y=${worst.y} (u=${worst.u})  はみ出し ${bad.length} コマ`, bad.slice(0, 5));
  if (bad.length) ok = false;
}
await browser.close();
process.exit(ok ? 0 : 1);
