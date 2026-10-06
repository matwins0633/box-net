// 展開図を折ったときに、すべての面が 1×2×2 の直方体の面とぴったり一致するかを確かめるテスト。
// 実行: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BOX, BASE_FACES, PATTERN_IDS, facesForPattern, createNetTree, setFold, worldCorners, edgeIndices, netTo3D,
} from '../src/net.js';

const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) < EPS;
const key = (v) => [v.x, v.y, v.z].map((n) => (Math.abs(n) < EPS ? 0 : Math.round(n * 1e6) / 1e6)).join(',');

// 直方体の6つの面（名前 → 4頂点のキー集合）
function boxFaces() {
  const { min, max } = BOX;
  const faces = {};
  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    for (const [side, value] of [['min', min[axis]], ['max', max[axis]]]) {
      const others = axes.filter((a) => a !== axis);
      const pts = [];
      for (const u of [min[others[0]], max[others[0]]]) {
        for (const w of [min[others[1]], max[others[1]]]) {
          const v = new THREE.Vector3();
          v[axis] = value;
          v[others[0]] = u;
          v[others[1]] = w;
          pts.push(key(v));
        }
      }
      faces[`${axis}-${side}`] = new Set(pts);
    }
  }
  return faces;
}

// 全ての面を折りきったときに、どの直方体の面と一致したかを返す
function foldAndMatch(defs) {
  const { root, nodes } = createNetTree(defs);
  for (const id in nodes) setFold(nodes[id], 1);
  root.updateMatrixWorld(true);
  const target = boxFaces();
  const result = {};
  for (const id in nodes) {
    const corners = worldCorners(nodes[id]).map(key);
    assert.equal(new Set(corners).size, 4, `${id} の頂点が4つに分かれていない`);
    const match = Object.entries(target).find(([, set]) => corners.every((c) => set.has(c)));
    assert.ok(match, `${id} の頂点 ${corners.join(' / ')} が直方体のどの面とも一致しない`);
    result[id] = match[0];
  }
  return result;
}

test('展開図のまま（折る前）は、各面が床の上の指定どおりの位置にある', () => {
  const { root, nodes } = createNetTree(facesForPattern(1));
  root.updateMatrixWorld(true);
  for (const id in nodes) {
    const [x0, x1, y0, y1] = nodes[id].def.rect;
    const expected = new Set([netTo3D(x0, y0), netTo3D(x1, y0), netTo3D(x1, y1), netTo3D(x0, y1)].map(key));
    const got = worldCorners(nodes[id]).map(key);
    assert.deepEqual(new Set(got), expected, id);
  }
});

test('5面を折った状態：天面のない箱になる', () => {
  const matched = foldAndMatch(BASE_FACES);
  assert.deepEqual(matched, {
    base: 'y-min', // 底面
    left: 'x-min', // 左の側面
    back: 'z-min', // 奥の面
    front: 'z-max', // 手前の面
    right: 'x-max', // 右の側面
  });
});

for (const p of PATTERN_IDS) {
  test(`パターン${p}：天面まで閉じると直方体の6面すべてに一致する`, () => {
    const matched = foldAndMatch(facesForPattern(p));
    assert.equal(matched.top, 'y-max', '天面が上の面に来ていない');
    assert.equal(new Set(Object.values(matched)).size, 6, '同じ面に重なっている面がある');
  });
}

test('折っている途中で、どの面も床より下に行かない（箱を作る向きに折れる）', () => {
  for (const p of PATTERN_IDS) {
    const { root, nodes } = createNetTree(facesForPattern(p));
    for (let i = 0; i <= 20; i++) {
      for (const id in nodes) setFold(nodes[id], i / 20);
      root.updateMatrixWorld(true);
      for (const id in nodes) {
        for (const c of worldCorners(nodes[id])) assert.ok(c.y > -EPS, `パターン${p} ${id} y=${c.y}`);
      }
    }
  }
});

test('親が回転すると子も一緒に動く（階層構造）', () => {
  const { root, nodes } = createNetTree(BASE_FACES);
  setFold(nodes.left, 1); // left だけ折る
  root.updateMatrixWorld(true);
  // back は自分では回転していないが、left と一緒に立ち上がって x=2 の面の上にある
  for (const c of worldCorners(nodes.back)) assert.ok(near(c.x, 2) || c.x > 2 - EPS, `back x=${c.x}`);
  assert.ok(worldCorners(nodes.back).some((c) => c.y > 1), 'back が left と一緒に持ち上がっていない');
  assert.equal(nodes.back.pivot.parent, nodes.left.pivot);
  assert.equal(nodes.right.pivot.parent, nodes.front.pivot);
});

test('ヒンジの辺は子の面では描かない（辺の二重描画を防ぐ）', () => {
  const { nodes } = createNetTree(facesForPattern(1));
  assert.equal(edgeIndices(nodes.base).length, 4);
  for (const id of ['left', 'back', 'front', 'right', 'top']) assert.equal(edgeIndices(nodes[id]).length, 3, id);
});
