// 画面の操作（再生・スライダー）とプレビューの描画
import * as THREE from 'three';
import { BoxScene, COLORS } from './scene.js';
import { PATTERN_IDS, facesForPattern, netBounds } from './net.js';
import { totalDuration } from './timeline.js';

const canvas = document.getElementById('view');
const playBtn = document.getElementById('play');
const seek = document.getElementById('seek');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
const boxScene = new BoxScene(renderer);

const state = { u: 0, playing: false, speed: 'normal', pattern: 1 };

// 天面のパターンのボタン（小さな展開図の絵つき）
const SVG_NS = 'http://www.w3.org/2000/svg';
function netIcon(pattern) {
  const defs = facesForPattern(pattern);
  // 4つの絵で1マスの大きさをそろえるため、全パターンを合わせた範囲で枠を決める
  const all = PATTERN_IDS.flatMap((p) => facesForPattern(p));
  const [ax0, ax1, ay0, ay1] = netBounds(all);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `${ax0 - 0.3} ${-ay1 - 0.3} ${ax1 - ax0 + 0.6} ${ay1 - ay0 + 0.6}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of defs) {
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

const patternBox = document.getElementById('patterns');
const patternButtons = PATTERN_IDS.map((p) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pattern-btn';
  btn.dataset.pattern = p;
  btn.append(netIcon(p), `パターン${p}`);
  btn.addEventListener('click', () => setPattern(p));
  patternBox.appendChild(btn);
  return btn;
});

function setPattern(p) {
  state.pattern = p;
  boxScene.setPattern(p);
  patternButtons.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.pattern === p)));
}
setPattern(1);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
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
  _scene: boxScene,
  setPattern,
  setU(u) { state.u = u; seek.value = Math.round(u * 1000); draw(); },
  // 流れ全体で、面が画面からはみ出していないかを調べる
  framing(steps = 200) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      boxScene.render(i / steps, 1920, 1080);
      const e = boxScene.projectedExtent();
      out.push({ u: i / steps, x: +e.x.toFixed(3), y: +e.y.toFixed(3) });
    }
    draw();
    return out;
  },
};

requestAnimationFrame(tick);
