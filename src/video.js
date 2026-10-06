// 動画（MP4・H.264・1920×1080・30fps）の書き出し。
// 1コマずつ描いてはエンコーダーに渡すので、PCの性能に関係なく、なめらかな動画になる。

export const VIDEO = { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 };

export class VideoCancelled extends Error {}

// renderFrame(u): 位置 u（0〜1）のコマを canvas に描く
// duration: 動画の長さ（秒）
// onProgress(割合 0〜1) / isCancelled(): やめるボタンが押されたら true
// 戻り値: MP4 の Blob
export async function makeVideo({ canvas, renderFrame, duration, onProgress, isCancelled }) {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, canEncodeVideo } = await import('mediabunny');

  if (typeof VideoEncoder === 'undefined') {
    throw new Error('このブラウザでは動画をつくれません。最新の Microsoft Edge か Google Chrome でお試しください。');
  }
  const ok = await canEncodeVideo('avc', { width: VIDEO.width, height: VIDEO.height, bitrate: VIDEO.bitrate });
  if (!ok) {
    throw new Error('このパソコンでは MP4（H.264）の動画をつくれません。最新の Microsoft Edge でお試しください。');
  }

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: VIDEO.bitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source, { frameRate: VIDEO.fps });
  await output.start();

  const last = Math.round(duration * VIDEO.fps); // 最後のコマの番号（最初と最後のコマを両方含める）
  try {
    for (let i = 0; i <= last; i++) {
      if (isCancelled()) throw new VideoCancelled();
      renderFrame(i / last);
      await source.add(i / VIDEO.fps, 1 / VIDEO.fps);
      onProgress((i + 1) / (last + 1));
      // 画面（進み具合の表示）を更新する機会をつくる
      if (i % 3 === 0) await yieldToBrowser();
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

function yieldToBrowser() {
  // タブが裏に回っても遅くならないよう、setTimeout ではなく MessageChannel を使う
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}
