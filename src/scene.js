// 3D の場面（床、面、辺、カメラ）を作って描画する。
// 画面のプレビューと動画の書き出しの両方から使う。

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { BOX, BASE_FACES, createNetTree, setFold, edgeIndices, netBounds, facesForPattern } from './net.js';

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

const LIGHT_DIR = new THREE.Vector3(-0.35, 1, 0.55).normalize();

export class BoxScene {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.setClearColor(BACKGROUND, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
    this.scene.add(this.createFloor());

    this.lineSolid = new LineMaterial({
      color: EDGE,
      linewidth: LINE_WIDTH_AT_1080,
      transparent: true,
      depthWrite: false,
    });

    this.pattern = 1;
    this.buildFaces(BASE_FACES);
  }

  // 床：1単位ごとのマス目。面と同じ高さ (y=0) にあるので、深度は書かずに最初に描く。
  createFloor() {
    const size = 60;
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const bg = new THREE.Color().setStyle(BACKGROUND, THREE.SRGBColorSpace);
    const line = new THREE.Color().setStyle(GRID_LINE, THREE.SRGBColorSpace);
    // 色は sRGB の値のまま出力する（背景色と完全に一致させるため）
    bg.convertLinearToSRGB();
    line.convertLinearToSRGB();
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
      node.pivot.add(solid);
    }
    this.scene.add(tree.root);
    this.tree = tree;
  }

  setPattern(pattern) {
    this.pattern = pattern;
  }

  // カメラの位置：注視点 target、距離 dist、真上からの傾き polar、水平方向の向き azimuth
  topView(aspect) {
    const [x0, x1, y0, y1] = netBounds(facesForPattern(this.pattern));
    const target = new THREE.Vector3((x0 + x1) / 2, 0, -(y0 + y1) / 2);
    const halfH = (y1 - y0) / 2 + 1.0;
    const halfW = (x1 - x0) / 2 + 1.0;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = Math.max(halfH / t, halfW / (t * aspect));
    return { target, dist, polar: 1e-4, azimuth: 0 };
  }

  obliqueView() {
    const c = BOX.min.clone().add(BOX.max).multiplyScalar(0.5);
    return {
      target: new THREE.Vector3(c.x, 0.8, c.z),
      dist: 9,
      polar: THREE.MathUtils.degToRad(55),
      azimuth: THREE.MathUtils.degToRad(32),
    };
  }

  placeCamera(k, aspect) {
    const a = this.topView(aspect);
    const b = this.obliqueView();
    const target = a.target.clone().lerp(b.target, k);
    // 近づくのは遅めにして、折っている途中の面が画面からはみ出さないようにする
    const dist = Math.exp(THREE.MathUtils.lerp(Math.log(a.dist), Math.log(b.dist), k ** 2.2));
    const polar = THREE.MathUtils.lerp(a.polar, b.polar, k);
    const azimuth = THREE.MathUtils.lerp(a.azimuth, b.azimuth, k);
    const cam = this.camera;
    cam.aspect = aspect;
    cam.position.set(
      target.x + dist * Math.sin(polar) * Math.sin(azimuth),
      target.y + dist * Math.cos(polar),
      target.z + dist * Math.sin(polar) * Math.cos(azimuth),
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.near = Math.max(0.1, dist * 0.2);
    cam.far = dist * 5 + 50;
    cam.updateProjectionMatrix();
  }

  // 面の明るさ：カメラ側を向いた法線と光の向きで、わずかに陰影をつける
  shadeFaces() {
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
    }
  }

  // 全ての面の頂点を画面に投影したときの、画面の端に対する位置（1 を超えるとはみ出し）
  projectedExtent() {
    let mx = 0;
    let my = 0;
    for (const id in this.tree.nodes) {
      const node = this.tree.nodes[id];
      for (const c of node.corners) {
        const p = c.clone().applyMatrix4(node.pivot.matrixWorld).project(this.camera);
        mx = Math.max(mx, Math.abs(p.x));
        my = Math.max(my, Math.abs(p.y));
      }
    }
    return { x: mx, y: my };
  }

  // タイムラインの状態 s を、幅 w × 高さ h（ピクセル）で描く
  render(s, w, h) {
    const nodes = this.tree.nodes;
    for (const id in nodes) {
      const level = nodes[id].def.level;
      if (level > 0) setFold(nodes[id], s.fold[`level${level}`]);
    }
    this.placeCamera(s.camera, w / h);
    this.scene.updateMatrixWorld(true);
    this.shadeFaces();

    const scale = h / 1080;
    this.lineSolid.linewidth = LINE_WIDTH_AT_1080 * scale;
    this.lineSolid.resolution.set(w, h);
    this.floorMaterial.uniforms.uPixel.value = Math.max(1, 1.6 * scale);

    this.renderer.render(this.scene, this.camera);
  }
}
