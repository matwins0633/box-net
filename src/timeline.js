// 動きの流れ（タイムライン）。位置 u（0〜1）から、その瞬間の状態を計算する。
// 速さの切り替えは全体の長さを一括で伸び縮みさせるだけなので、u は速さに関係しない。

export const SPEEDS = { slow: 1.5, normal: 1, fast: 0.6 };

// [名前, 「ふつう」のときの秒数]
export const SEGMENTS = [
  ['hold-start', 1.5], // 真上から展開図を見せて静止
  ['fold-1', 3.0], // 子の面（left, front）が立ち上がる
  ['fold-2', 3.0], // 孫の面（back, right）が立ち上がる
  ['hold-built', 2.0], // 完成して間をおく
];

const BASE_TOTAL = SEGMENTS.reduce((s, [, d]) => s + d, 0);

export function totalDuration(speed = 'normal') {
  return BASE_TOTAL * SPEEDS[speed];
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
const easeInOutCubic = (x) => {
  x = clamp01(x);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

// 区間の開始・終了（0〜1）
const RANGES = (() => {
  const r = {};
  let acc = 0;
  for (const [name, d] of SEGMENTS) {
    r[name] = [acc / BASE_TOTAL, (acc + d) / BASE_TOTAL];
    acc += d;
  }
  return r;
})();

// 区間 name の中での進み具合（0〜1）
function progress(u, name) {
  const [a, b] = RANGES[name];
  return clamp01((u - a) / (b - a));
}

// u における状態
//  fold: 各段階の折れ具合（0=開いている、1=90°折れている）
//  camera: 0=真上、1=斜め上
export function sample(u) {
  const f1 = easeInOut(progress(u, 'fold-1'));
  const f2 = easeInOut(progress(u, 'fold-2'));
  // カメラは折っている間（第1段階の始めから第2段階の終わりまで）にゆっくり動く
  const camStart = RANGES['fold-1'][0];
  const camEnd = RANGES['fold-2'][1];
  const camera = easeInOutCubic((u - camStart) / (camEnd - camStart));
  return {
    fold: { level1: f1, level2: f2, level3: 0 },
    camera,
  };
}
