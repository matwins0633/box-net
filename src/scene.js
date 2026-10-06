// 3D の場面（床、面、辺、カメラ）を作って描画する。
// 画面のプレビューと動画の書き出しの両方から使う。

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { sample, BASE_TOTAL } from './timeline.js';
import { createNetTree, setFold, edgeIndices, facesForPattern } from './net.js';

// 色覚の多様性に配慮した色（明るさにも差をつける）
//  オレンジ: 赤み寄り・中くらいの明るさ / 緑: 青み寄り・暗め / 水色: 明るめ
export const COLORS = {
  orange: '#F28C3C',
  green: '#1B7B62',
  blue: '#9FDDF7',
};
const BACKGROUND = '#F7F8FA';
const GRID_LINE = '#C9D0D8';
const EDGE = '#262A30';

const FOV = 30;
const LINE_WIDTH_AT_1080 = 4; // 1080px の高さのときの辺の太さ（ピクセル）
const HIDDEN_WIDTH_RATIO = 0.75; // 見えない辺（破線）の太さ（見える辺に対する割合）
// 破線の模様（長さの単位は床の1マス）。辺の長さ（1 か 2）がくり返しの長さで割り切れ、
// 辺の両端が「すき間の半分」になるようにして、どちら向きに描いても同じ模様になるようにする。
const DASH = { size: 0.12, gap: 0.08 };

// 斜め上から見るときのカメラの角度
const OBLIQUE = { polar: THREE.MathUtils.degToRad(55), azimuth: THREE.MathUtils.degToRad(32) };
// 面全体が画面の高さ・幅のどれだけを占めるか（残りは余白）
const FILL = 0.8;
// カメラの動きをなめらかにするための平均の幅（「ふつう」の速さで前後約0.7秒）
const SMOOTH_WINDOW = 0.7 / BASE_TOTAL;
const SMOOTH_SAMPLES = 8;

const WHITE = new THREE.Color('#ffffff');
const LIGHT_DIR = new THREE.Vector3(-0.35, 1, 0.55).normalize();

// 辺の線を、画面上の位置は変えずに、カメラの方へほんの少しだけ寄せる（距離の LINE_PULL 倍）。
// 面のふちにある辺が、その面や隣の面に埋もれて「見えない辺」と判定されないようにする。
// （面を斜めから見ると、太い線の幅の分だけ面の方が手前になることがあるため）
const LINE_PULL = 0.004;
function pullLinesTowardCamera(material) {
  const anchor = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );';
  if (!material.vertexShader.includes(anchor)) throw new Error('LineMaterial のシェーダーが想定と違います');
  material.vertexShader = material.vertexShader.replace(
    anchor,
    `${anchor}\n\t\t\tstart.xyz *= ${(1 - LINE_PULL).toFixed(6)};\n\t\t\tend.xyz *= ${(1 - LINE_PULL).toFixed(6)};`,
  );
}

export class BoxScene {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.setClearColor(BACKGROUND, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
    this.scene.add(this.createFloor());

    // 辺は2回に分けて描く。
    //  1回目（実線）: 面より手前にある部分 ＝ 見える辺
    //  2回目（破線）: 面より奥にある部分 ＝ 見えない辺（深度テストを逆にして描く）
    // ステンシルで「すでに線を描いたピクセル」に印をつけ、重なった辺を二重に描かないようにする
    // （重なった半透明の破線が濃くなったり、ちらついたりしない）。
    const stencil = {
      stencilWrite: true,
      stencilRef: 1,
      stencilZPass: THREE.ReplaceStencilOp,
    };
    this.lineSolid = new LineMaterial({
      color: EDGE,
      linewidth: LINE_WIDTH_AT_1080,
      transparent: true,
      depthWrite: false,
      ...stencil,
      stencilFunc: THREE.AlwaysStencilFunc,
    });
    this.lineHidden = new LineMaterial({
      color: EDGE,
      linewidth: LINE_WIDTH_AT_1080 * HIDDEN_WIDTH_RATIO,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      dashed: true,
      dashSize: DASH.size,
      gapSize: DASH.gap,
      dashOffset: DASH.size + DASH.gap / 2,
      ...stencil,
      stencilFunc: THREE.NotEqualStencilFunc,
    });

    pullLinesTowardCamera(this.lineSolid);
    pullLinesTowardCamera(this.lineHidden);

    // 天面が現れるときの重ね合わせ用：天面のない場面を描いておく画像と、それを重ねる板
    this.fadeTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
    this.fadeMaterial = new THREE.MeshBasicMaterial({ map: this.fadeTarget.texture, transparent: true, depthTest: false, depthWrite: false });
    this.fadeScene = new THREE.Scene();
    this.fadeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMaterial));
    this.fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.pattern = 1;
    this.buildFaces(facesForPattern(this.pattern));
  }

  // 床：1単位ごとのマス目。面と同じ高さ (y=0) にあるので、深度は書かずに最初に描く。
  createFloor() {
    const size = 60;
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const bg = new THREE.Color(BACKGROUND);
    const line = new THREE.Color(GRID_LINE);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uBg: { value: bg },
        uLine: { value: line },
        uCenter: { value: new THREE.Vector2(1.5, 0.5) },
        uFade: { value: new THREE.Vector2(7, 12) },
        uPixel: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vXZ = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBg;
        uniform vec3 uLine;
        uniform vec2 uCenter;
        uniform vec2 uFade;
        uniform float uPixel;
        varying vec2 vXZ;
        void main() {
          vec2 fw = max(fwidth(vXZ), vec2(1e-5));
          vec2 g = abs(fract(vXZ - 0.5) - 0.5) / fw;   // 線からの距離（ピクセル単位）
          float d = min(g.x, g.y);
          float a = 1.0 - smoothstep(0.5 * uPixel, 0.5 * uPixel + 1.0, d);
          // 遠くの細かい線はちらつくので薄くする
          a *= 1.0 - smoothstep(0.15, 0.4, max(fw.x, fw.y));
          a *= 1.0 - smoothstep(uFade.x, uFade.y, distance(vXZ, uCenter));
          gl_FragColor = vec4(mix(uBg, uLine, a), 1.0);
          #include <colorspace_fragment>
        }`,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    this.floorMaterial = mat;
    return mesh;
  }

  buildFaces(defs) {
    if (this.tree) {
      this.scene.remove(this.tree.root);
      this.tree.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.isMesh && !o.isLineSegments2 && o.material) o.material.dispose();
      });
    }
    const tree = createNetTree(defs);
    for (const id in tree.nodes) {
      const node = tree.nodes[id];
      const [a, b, c, d] = node.corners;
      const geo = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
      const mat = new THREE.MeshBasicMaterial({
        color: COLORS[node.def.color],
        side: THREE.DoubleSide,
        // 面を少し奥へずらし、ふちの線が面に埋もれてちらつかないようにする
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      node.pivot.add(mesh);
      node.mesh = mesh;
      node.baseColor = new THREE.Color(COLORS[node.def.color]);

      const pos = [];
      for (const [i, j] of edgeIndices(node)) {
        pos.push(...node.corners[i].toArray(), ...node.corners[j].toArray());
      }
      const lgeo = new LineSegmentsGeometry().setPositions(pos);
      const solid = new LineSegments2(lgeo, this.lineSolid);
      solid.renderOrder = 10;
      const hidden = new LineSegments2(lgeo, this.lineHidden);
      hidden.computeLineDistances();
      hidden.renderOrder = 11;
      node.pivot.add(solid, hidden);
      node.lines = [solid, hidden];
    }
    this.scene.add(tree.root);
    this.tree = tree;
  }

  setPattern(pattern) {
    if (pattern === this.pattern) return;
    this.pattern = pattern;
    this.buildFaces(facesForPattern(pattern));
  }

  // 面の折れ具合と天面の見え具合を、タイムラインの状態 s に合わせる
  applyState(s) {
    const nodes = this.tree.nodes;
    for (const id in nodes) {
      const node = nodes[id];
      if (id === 'top') setFold(node, s.fold.top);
      else if (node.def.level === 1) setFold(node, s.fold.children);
      else if (node.def.level === 2) setFold(node, s.fold.grandchildren);
    }
    this.setTopVisible(s.top > 0);
    this.tree.root.updateMatrixWorld(true);
  }

  setTopVisible(v) {
    const top = this.tree.nodes.top;
    top.mesh.visible = v;
    for (const l of top.lines) l.visible = v;
  }

  // 見えている面の頂点（ワールド座標）
  visibleCorners() {
    const pts = [];
    for (const id in this.tree.nodes) {
      const node = this.tree.nodes[id];
      if (!node.mesh.visible) continue;
      for (const c of node.corners) pts.push(c.clone().applyMatrix4(node.pivot.matrixWorld));
    }
    return pts;
  }

  // カメラの向き（角度 k: 0=真上、1=斜め上）から、見えている面全体が画面に収まる注視点と距離を求める
  fitCamera(s, aspect) {
    this.applyState(s);
    const pts = this.visibleCorners();
    const k = s.camera;
    const polar = THREE.MathUtils.lerp(1e-4, OBLIQUE.polar, k);
    const azimuth = THREE.MathUtils.lerp(0, OBLIQUE.azimuth, k);
    // カメラから注視点へ向かう向き f、画面の右 r、画面の上 v
    const back = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
    const f = back.clone().negate();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(r, f);
    const ty = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * FILL;
    const tx = ty * aspect;

    const box = new THREE.Box3().setFromPoints(pts);
    const target = box.getCenter(new THREE.Vector3());
    const a = new THREE.Vector3();
    let dist = 0;
    // 2回くり返して、画面の上下左右の余白がそろうように注視点を寄せる
    for (let iter = 0; iter < 3; iter++) {
      dist = 0;
      for (const p of pts) {
        a.subVectors(p, target);
        const depth = a.dot(f);
        dist = Math.max(dist, Math.abs(a.dot(r)) / tx - depth, Math.abs(a.dot(v)) / ty - depth);
      }
      if (iter === 2) break;
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
      for (const p of pts) {
        a.subVectors(p, target);
        const depth = a.dot(f) + dist;
        const x = a.dot(r) / depth;
        const y = a.dot(v) / depth;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      target.addScaledVector(r, ((x0 + x1) / 2) * dist).addScaledVector(v, ((y0 + y1) / 2) * dist);
    }
    return { target, dist, back };
  }

  // 位置 u のカメラ。前後の少しの時間で平均して、動きをなめらかにする。
  placeCamera(u, aspect) {
    const target = new THREE.Vector3();
    let logDist = 0;
    let wsum = 0;
    const n = SMOOTH_SAMPLES;
    for (let i = -n; i <= n; i++) {
      const w = n + 1 - Math.abs(i);
      const ui = Math.min(1, Math.max(0, u + (i / n) * SMOOTH_WINDOW));
      const fit = this.fitCamera(sample(ui), aspect);
      target.addScaledVector(fit.target, w);
      logDist += Math.log(fit.dist) * w;
      wsum += w;
    }
    target.divideScalar(wsum);
    const dist = Math.exp(logDist / wsum);
    const { back } = this.fitCamera(sample(u), aspect); // 向きは平均しない（最後にその瞬間の状態へ戻す役目も兼ねる）
    const cam = this.camera;
    cam.aspect = aspect;
    cam.position.copy(target).addScaledVector(back, dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.near = Math.max(0.1, dist * 0.2);
    cam.far = dist * 5 + 50;
    cam.updateProjectionMatrix();
  }

  // 面の明るさ：カメラ側を向いた法線と光の向きで、わずかに陰影をつける
  shadeFaces(sketch) {
    const n = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const id in this.tree.nodes) {
      const node = this.tree.nodes[id];
      node.pivot.getWorldQuaternion(q);
      n.set(0, 1, 0).applyQuaternion(q);
      const p = node.corners[0].clone().applyMatrix4(node.pivot.matrixWorld);
      toCam.subVectors(this.camera.position, p);
      if (n.dot(toCam) < 0) n.negate();
      const shade = 0.8 + 0.2 * Math.max(0, n.dot(LIGHT_DIR));
      node.mesh.material.color.copy(node.baseColor).multiplyScalar(shade);
      // 見取り図では面を白にする（天面だけは水色のまま）
      if (id !== 'top') node.mesh.material.color.lerp(WHITE, sketch);
    }
  }

  // 全ての面の頂点を画面に投影したときの、画面の端に対する位置（1 を超えるとはみ出し）
  projectedExtent() {
    let mx = 0;
    let my = 0;
    for (const id in this.tree.nodes) {
      const node = this.tree.nodes[id];
      if (!node.mesh.visible) continue;
      for (const c of node.corners) {
        const p = c.clone().applyMatrix4(node.pivot.matrixWorld).project(this.camera);
        mx = Math.max(mx, Math.abs(p.x));
        my = Math.max(my, Math.abs(p.y));
      }
    }
    return { x: mx, y: my };
  }

  // 位置 u（0〜1）の場面を、幅 w × 高さ h（ピクセル）で描く
  render(u, w, h) {
    const s = sample(u);
    this.placeCamera(u, w / h);
    this.applyState(s);
    this.scene.updateMatrixWorld(true);
    this.shadeFaces(s.sketch);

    const scale = h / 1080;
    this.lineSolid.linewidth = LINE_WIDTH_AT_1080 * scale;
    this.lineHidden.linewidth = LINE_WIDTH_AT_1080 * HIDDEN_WIDTH_RATIO * scale;
    this.lineSolid.resolution.set(w, h);
    this.lineHidden.resolution.set(w, h);
    // 見えない辺の破線は、見取り図に切り替わるにつれて現れる
    this.lineHidden.opacity = s.sketch;
    this.lineHidden.visible = s.sketch > 0;
    this.floorMaterial.uniforms.uPixel.value = Math.max(1, 1.6 * scale);

    const r = this.renderer;
    if (s.top > 0 && s.top < 1) {
      // 天面が現れる途中：「天面のない場面」と「天面のある場面」を重ね合わせる。
      // （天面に隠れる辺が、実線から破線へ自然に切り替わる）
      this.fadeTarget.setSize(w, h);
      this.setTopVisible(false);
      r.setRenderTarget(this.fadeTarget);
      r.render(this.scene, this.camera);
      r.setRenderTarget(null);
      this.setTopVisible(true);
      r.render(this.scene, this.camera);
      this.fadeMaterial.opacity = 1 - s.top;
      r.autoClear = false;
      r.render(this.fadeScene, this.fadeCamera);
      r.autoClear = true;
    } else {
      r.render(this.scene, this.camera);
    }
  }
}
