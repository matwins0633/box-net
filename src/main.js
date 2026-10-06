// 画面の操作（再生・スライダー）とプレビューの描画
import * as THREE from 'three';
import { BoxScene } from './scene.js';
import { sample, totalDuration } from './timeline.js';

const canvas = document.getElementById('view');
const playBtn = document.getElementById('play');
const seek = document.getElementById('seek');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
const boxScene = new BoxScene(renderer);

const state = { u: 0, playing: false, speed: 'normal' };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
}

function draw() {
  resize();
  boxScene.render(sample(state.u), canvas.width, canvas.height);
}

function setPlaying(p) {
  state.playing = p;
  playBtn.textContent = p ? '❚❚ 一時停止' : '▶ 再生';
}

let last = performance.now();
function tick(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (state.playing) {
    state.u += dt / totalDuration(state.speed);
    if (state.u >= 1) {
      state.u = 1;
      setPlaying(false);
    }
    seek.value = Math.round(state.u * 1000);
  }
  draw();
  requestAnimationFrame(tick);
}

playBtn.addEventListener('click', () => {
  if (!state.playing && state.u >= 1) state.u = 0;
  setPlaying(!state.playing);
});
seek.addEventListener('input', () => {
  state.u = seek.value / 1000;
});

// 確認用：位置を外から指定できるようにする
window.boxNet = {
  setU(u) { state.u = u; seek.value = Math.round(u * 1000); draw(); },
  // 流れ全体で、面が画面からはみ出していないかを調べる
  framing(steps = 200) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      boxScene.render(sample(i / steps), 1920, 1080);
      const e = boxScene.projectedExtent();
      out.push({ u: i / steps, x: +e.x.toFixed(3), y: +e.y.toFixed(3) });
    }
    draw();
    return out;
  },
};

requestAnimationFrame(tick);
