// 「動画をつくる」ボタンから MP4 を作り、形式・大きさ・コマ数と、中のコマの画像を確かめる（Playwright を使用）。
// H.264 の書き出しには、Microsoft Edge か Google Chrome が必要（環境変数 BROWSER_PATH で指定）。
// 使い方: BROWSER_PATH=/path/to/msedge node tests/video.mjs <保存先フォルダ> [パターン番号] [速さ slow|normal|fast]

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';
import { openPage, launch } from './screenshots.mjs';

const outDir = process.argv[2] || 'video-check';
const pattern = Number(process.argv[3] || 1);
const speed = process.argv[4] || 'fast';
await mkdir(outDir, { recursive: true });

const browser = await launch();
const page = await openPage(browser);
await page.locator(`#patterns button[data-pattern="${pattern}"]`).click();
await page.locator(`#speeds button[data-speed="${speed}"]`).click();
await page.screenshot({ path: path.join(outDir, 'before.png') });

const started = Date.now();
await page.locator('#make-video').click();
await page.waitForFunction(() => Number(document.getElementById('progress-bar').value) >= 10, null, { timeout: 600000 });
await page.screenshot({ path: path.join(outDir, 'progress.png') });
await page.waitForFunction(
  () => !document.getElementById('video-done').hidden || !document.getElementById('video-error').hidden,
  null,
  { timeout: 1800000, polling: 1000 },
);
const seconds = ((Date.now() - started) / 1000).toFixed(0);
if (!(await page.locator('#video-done').isVisible())) {
  console.log('エラー:', await page.locator('#video-error-text').textContent());
  await page.screenshot({ path: path.join(outDir, 'error.png') });
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, 'done.png') });

const fileName = await page.locator('#download-video').getAttribute('download');
const base64 = await page.evaluate(async () => {
  const buf = await (await fetch(document.getElementById('download-video').href)).arrayBuffer();
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
const data = Buffer.from(base64, 'base64');
await writeFile(path.join(outDir, fileName), data);

// MP4 の中身を読む
const input = new Input({ source: new BufferSource(data), formats: ALL_FORMATS });
const track = await input.getPrimaryVideoTrack();
const stats = await track.computePacketStats();
const info = {
  ファイル名: fileName,
  大きさ: `${(data.length / 1e6).toFixed(1)} MB`,
  形式: await input.getMimeType(),
  コーデック: await track.getCodecParameterString(),
  解像度: `${track.displayWidth}×${track.displayHeight}`,
  コマ数: stats.packetCount,
  fps: stats.averagePacketRate.toFixed(2),
  長さ: `${(await input.computeDuration()).toFixed(2)} 秒`,
  かかった時間: `${seconds} 秒`,
};
console.log(info);

// ブラウザで MP4 を読み込み、いくつかのコマを画像に書き出す
const times = [0.02, 0.2, 0.35, 0.45, 0.55, 0.7, 0.85, 0.999];
const frames = await page.evaluate(async (times) => {
  const v = document.getElementById('video-preview');
  v.pause();
  const out = [];
  for (const t of times) {
    await new Promise((resolve) => {
      v.addEventListener('seeked', resolve, { once: true });
      v.currentTime = t * v.duration;
    });
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 540;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    out.push(c.toDataURL('image/png'));
  }
  return out;
}, times);
for (let i = 0; i < frames.length; i++) {
  await writeFile(path.join(outDir, `frame-${times[i]}.png`), Buffer.from(frames[i].split(',')[1], 'base64'));
}
await browser.close();

const ok = info.コーデック.startsWith('avc1') && track.displayWidth === 1920 && track.displayHeight === 1080
  && Math.abs(stats.averagePacketRate - 30) < 0.5 && fileName === `box-net-pattern${pattern}.mp4`;
console.log(ok ? 'OK: MP4（H.264）1920×1080 30fps' : 'NG');
process.exit(ok ? 0 : 1);
