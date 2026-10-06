// 画面の操作（天面のパターン・速さ・再生・スライダー・動画づくり）とプレビューの描画
import * as THREE from 'three';
import { BoxScene, COLORS } from './scene.js';
import { PATTERN_IDS, facesForPattern, netBounds } from './net.js';
import { totalDuration } from './timeline.js';
import { makeVideo, VIDEO, VideoCancelled } from './video.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const playBtn = $('play');
const seek = $('seek');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
} catch (e) {
  $('load-error').textContent = 'このパソコンでは3Dの表示ができませんでした。最新の Microsoft Edge でお試しください。';
  $('load-error').hidden = false;
  throw e;
}
const boxScene = new BoxScene(renderer);

const state = { u: 0, playing: false, speed: 'normal', pattern: 1, exporting: false };

// ---- 天面のパターン（小さな展開図の絵つきボタン） ----
const SVG_NS = 'http://www.w3.org/2000/svg';
function netIcon(pattern) {
  // 4つの絵で1マスの大きさをそろえるため、全パターンを合わせた範囲で枠を決める
  const all = PATTERN_IDS.flatMap((p) => facesForPattern(p));
  const [ax0, ax1, ay0, ay1] = netBounds(all);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `${ax0 - 0.3} ${-ay1 - 0.3} ${ax1 - ax0 + 0.6} ${ay1 - ay0 + 0.6}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of facesForPattern(pattern)) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', d.rect[0]);
    r.setAttribute('y', -d.rect[3]);
    r.setAttribute('width', d.rect[1] - d.rect[0]);
    r.setAttribute('height', d.rect[3] - d.rect[2]);
    r.setAttribute('fill', d.id === 'top' ? COLORS.blue : '#ffffff');
    r.setAttribute('stroke', '#262a30');
    r.setAttribute('stroke-width', d.id === 'top' ? 0.12 : 0.07);
    svg.appendChild(r);
  }
  return svg;
}

const patternButtons = PATTERN_IDS.map((p) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.pattern = p;
  btn.append(netIcon(p), `パターン${p}`);
  btn.addEventListener('click', () => setPattern(p));
  $('patterns').appendChild(btn);
  return btn;
});

function setPattern(p) {
  state.pattern = p;
  boxScene.setPattern(p);
  patternButtons.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.pattern === p)));
}

// ---- 速さ（流れ全体の長さを一括で変える。スライダーの位置はそのまま） ----
const speedButtons = [...$('speeds').querySelectorAll('button')];
function setSpeed(speed) {
  state.speed = speed;
  speedButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.speed === speed)));
}
speedButtons.forEach((b) => b.addEventListener('click', () => setSpeed(b.dataset.speed)));

setPattern(1);
setSpeed('normal');

// ---- プレビュー ----
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) renderer.setSize(w, h, false);
}

function draw() {
  resize();
  boxScene.render(state.u, canvas.width, canvas.height);
}

function setPlaying(p) {
  state.playing = p;
  playBtn.textContent = p ? '❚❚ 一時停止' : '▶ 再生';
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.exporting) {
    if (state.playing) {
      state.u += dt / totalDuration(state.speed);
      if (state.u >= 1) {
        state.u = 1;
        setPlaying(false);
      }
      seek.value = Math.round(state.u * 1000);
    }
    draw();
  }
  requestAnimationFrame(tick);
}

playBtn.addEventListener('click', () => {
  if (!state.playing && state.u >= 1) state.u = 0;
  setPlaying(!state.playing);
});
seek.addEventListener('input', () => {
  state.u = seek.value / 1000;
});

// ---- 画面に出さずに、指定した大きさで1コマを描く（動画づくり・確認用） ----
let offscreen = null;
function renderOffscreen(u, w, h) {
  if (!offscreen) {
    const c = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, stencil: true, preserveDrawingBuffer: true });
    offscreen = { canvas: c, renderer: r, scene: new BoxScene(r) };
  }
  offscreen.scene.setPattern(state.pattern);
  if (offscreen.canvas.width !== w || offscreen.canvas.height !== h) offscreen.renderer.setSize(w, h, false);
  offscreen.scene.render(u, w, h);
  return offscreen.canvas;
}

// ---- 動画づくり ----
const dialog = $('video-dialog');
let cancelRequested = false;
let videoUrl = null;

function showDialogPart(part) {
  $('video-progress').hidden = part !== 'progress';
  $('video-done').hidden = part !== 'done';
  $('video-error').hidden = part !== 'error';
}

function setProgress(ratio) {
  const pct = Math.floor(ratio * 100);
  $('progress-bar').value = pct;
  $('progress-text').textContent = `${pct}%`;
}

async function startVideo() {
  setPlaying(false);
  state.exporting = true;
  cancelRequested = false;
  setProgress(0);
  showDialogPart('progress');
  $('cancel-video').disabled = false;
  dialog.showModal();

  const pattern = state.pattern;
  try {
    // 最初に1コマ描いて、動画用の画面を用意しておく
    const target = renderOffscreen(0, VIDEO.width, VIDEO.height);
    const blob = await makeVideo({
      canvas: target,
      renderFrame: (u) => renderOffscreen(u, VIDEO.width, VIDEO.height),
      duration: totalDuration(state.speed),
      onProgress: setProgress,
      isCancelled: () => cancelRequested,
    });
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(blob);
    const video = $('video-preview');
    video.src = videoUrl;
    const link = $('download-video');
    link.href = videoUrl;
    link.download = `box-net-pattern${pattern}.mp4`;
    showDialogPart('done');
    video.play().catch(() => {});
  } catch (e) {
    if (e instanceof VideoCancelled) {
      dialog.close();
    } else {
      console.error(e);
      $('video-error-text').textContent = e.message || String(e);
      showDialogPart('error');
    }
  } finally {
    state.exporting = false;
  }
}

$('make-video').addEventListener('click', startVideo);
$('cancel-video').addEventListener('click', () => {
  cancelRequested = true;
  $('cancel-video').disabled = true;
});
$('close-video').addEventListener('click', () => dialog.close());
$('close-error').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', (e) => {
  // 動画をつくっている途中に Esc キーで閉じたときは、やめるボタンと同じにする
  if (state.exporting) {
    e.preventDefault();
    cancelRequested = true;
  }
});
dialog.addEventListener('close', () => $('video-preview').pause());

// ---- 確認用（画面には出さない） ----
window.boxNet = {
  _scene: boxScene,
  setPattern,
  setSpeed,
  snapshot(u, w = VIDEO.width, h = VIDEO.height) { return renderOffscreen(u, w, h).toDataURL('image/png'); },
  setU(u) { state.u = u; seek.value = Math.round(u * 1000); draw(); },
  // 流れ全体で、面が画面からはみ出していないかを調べる
  framing(steps = 200) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      boxScene.render(i / steps, VIDEO.width, VIDEO.height);
      const e = boxScene.projectedExtent();
      out.push({ u: i / steps, x: +e.x.toFixed(3), y: +e.y.toFixed(3) });
    }
    draw();
    return out;
  },
};

requestAnimationFrame(tick);
