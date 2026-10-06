// 直方体の展開図の定義と、面の親子構造（ヒンジで回転する階層）を作るモジュール。
// 展開図座標 (x, y) は 3D 空間の (x, 0, -y) に対応させる。単位 1 = 床の 1 マス。

import * as THREE from 'three';

// 組み立てたときの直方体（底面 横1×奥行2、高さ2）
export const BOX = {
  min: new THREE.Vector3(2, 0, -2),
  max: new THREE.Vector3(3, 2, 0),
};

// rect: [x0, x1, y0, y1]（展開図座標）
// hinge: { x: c } は直線 x=c、{ y: c } は直線 y=c で親とつながる
// level: 親からの深さ（1=子、2=孫、3=ひ孫）
export const BASE_FACES = [
  { id: 'base', rect: [2, 3, 0, 2], parent: null, hinge: null, color: 'blue', level: 0 },
  { id: 'left', rect: [0, 2, 0, 2], parent: 'base', hinge: { x: 2 }, color: 'green', level: 1 },
  { id: 'back', rect: [0, 2, 2, 3], parent: 'left', hinge: { y: 2 }, color: 'orange', level: 2 },
  { id: 'front', rect: [2, 3, -2, 0], parent: 'base', hinge: { y: 0 }, color: 'orange', level: 1 },
  { id: 'right', rect: [3, 5, -2, 0], parent: 'front', hinge: { x: 3 }, color: 'green', level: 2 },
];

// 天面の4パターン
export const TOP_PATTERNS = {
  1: { id: 'top', rect: [-1, 0, 0, 2], parent: 'left', hinge: { x: 0 }, color: 'blue', level: 2 },
  2: { id: 'top', rect: [-2, 0, 2, 3], parent: 'back', hinge: { x: 0 }, color: 'blue', level: 3 },
  3: { id: 'top', rect: [2, 3, -4, -2], parent: 'front', hinge: { y: -2 }, color: 'blue', level: 2 },
  4: { id: 'top', rect: [3, 5, -3, -2], parent: 'right', hinge: { y: -2 }, color: 'blue', level: 3 },
};

export const PATTERN_IDS = [1, 2, 3, 4];

export function netTo3D(x, y) {
  return new THREE.Vector3(x, 0, -y);
}

// パターンを選んだときの6面（top を含む）の定義
export function facesForPattern(pattern) {
  return [...BASE_FACES, TOP_PATTERNS[pattern]];
}

// 展開図の外枠 [xmin, xmax, ymin, ymax]
export function netBounds(defs) {
  let b = [Infinity, -Infinity, Infinity, -Infinity];
  for (const d of defs) {
    b = [Math.min(b[0], d.rect[0]), Math.max(b[1], d.rect[1]), Math.min(b[2], d.rect[2]), Math.max(b[3], d.rect[3])];
  }
  return b;
}

// 面ごとに「ヒンジ位置に置いた回転軸つきの Group（pivot）」を作り、親の pivot の子にする。
// 親が回転すると子も一緒に動く。
// 戻り値: { root, nodes }  nodes[id] = { def, pivot, axis, corners }
//   corners: pivot のローカル座標での面の4頂点（反時計回り）
export function createNetTree(defs) {
  const root = new THREE.Group();
  const nodes = {};
  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));

  const build = (def) => {
    if (nodes[def.id]) return nodes[def.id];
    const parentNode = def.parent ? build(byId[def.parent]) : null;

    // ヒンジ上の1点（3D）と、ヒンジから面の内側へ向かう方向 d
    const [x0, x1, y0, y1] = def.rect;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let hingePoint;
    let dir;
    if (!def.hinge) {
      hingePoint = new THREE.Vector3(0, 0, 0);
      dir = null;
    } else if ('x' in def.hinge) {
      hingePoint = netTo3D(def.hinge.x, 0);
      dir = new THREE.Vector3(Math.sign(cx - def.hinge.x), 0, 0);
    } else {
      hingePoint = netTo3D(0, def.hinge.y);
      dir = new THREE.Vector3(0, 0, -Math.sign(cy - def.hinge.y));
    }

    // 面を上（+Y）へ 90° 起こす回転軸: d × up。この軸まわりに +90° 回すと d が up に重なる。
    const axis = dir ? new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize() : null;

    const pivot = new THREE.Group();
    pivot.name = def.id;
    const parentHinge = parentNode ? parentNode.hingePoint : new THREE.Vector3();
    // 親の pivot ローカル座標（＝展開図を親のヒンジ分ずらした座標）で、このヒンジの位置
    pivot.position.copy(hingePoint).sub(parentHinge);
    (parentNode ? parentNode.pivot : root).add(pivot);

    const corners = [
      netTo3D(x0, y0),
      netTo3D(x1, y0),
      netTo3D(x1, y1),
      netTo3D(x0, y1),
    ].map((v) => v.sub(hingePoint));

    const node = { def, pivot, axis, hingePoint, corners, parent: parentNode };
    nodes[def.id] = node;
    return node;
  };

  defs.forEach(build);
  return { root, nodes };
}

// 折れ具合 t（0=展開図のまま、1=90°折れた状態）を設定する
export function setFold(node, t) {
  if (!node.axis) return;
  node.pivot.quaternion.setFromAxisAngle(node.axis, t * Math.PI / 2);
}

// 面の4頂点のワールド座標
export function worldCorners(node) {
  node.pivot.updateWorldMatrix(true, false);
  return node.corners.map((c) => c.clone().applyMatrix4(node.pivot.matrixWorld));
}

// 面の各辺（[a, b] の頂点番号）。親とつながるヒンジの辺は親が描くので除く。
export function edgeIndices(node) {
  const all = [[0, 1], [1, 2], [2, 3], [3, 0]];
  if (!node.def.hinge) return all;
  return all.filter(([a, b]) => {
    const pa = node.corners[a];
    const pb = node.corners[b];
    // ヒンジは pivot の原点を通り axis 方向の直線。2頂点ともその上にあれば除外。
    const onHinge = (p) => p.clone().cross(node.axis).lengthSq() < 1e-12;
    return !(onHinge(pa) && onHinge(pb));
  });
}
