// 動きの流れ（タイムライン）。位置 u（0〜1）から、その瞬間の状態を計算する。
// 速さの切り替えは全体の長さを一括で伸び縮みさせるだけなので、u は速さに関係しない。

export const SPEEDS = { slow: 1.5, normal: 1, fast: 0.6 };

// [名前, 「ふつう」のときの秒数]
export const SEGMENTS = [
  ['hold-start', 1.5], // 真上から展開図を見せて静止
  ['fold-1', 3.0], // 子の面（left, front）が立ち上がる
  ['fold-2', 3.0], // 孫の面（back, right）が立ち上がる
  ['hold-built', 1.5], // 完成して間をおく
  ['top-appear', 1.2], // 天面が閉じた位置に現れる
  ['hold-top', 0.8],
  ['open-1', 2.5], // 天面が開く
  ['open-2', 2.5], // 孫の面が開く
  ['open-3', 2.5], // 子の面が開く
  ['hold-end', 2.5], // 真上から6面の展開図を見せて静止
];

export const BASE_TOTAL = SEGMENTS.reduce((s, [, d]) => s + d, 0);

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
export const RANGES = (() => {
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

// 区間 first の始めから区間 last の終わりまでの進み具合（0〜1）
function span(u, first, last) {
  const a = RANGES[first][0];
  const b = RANGES[last][1];
  return clamp01((u - a) / (b - a));
}

// u における状態
//  fold: 折れ具合（0=開いている、1=90°折れている）
//    children: 子の面（left, front） / grandchildren: 孫の面（back, right） / top: 天面
//  top: 天面の見え具合（0=まだない、1=見えている）
//  camera: カメラの角度（0=真上、1=斜め上）
export function sample(u) {
  const children = easeInOut(progress(u, 'fold-1')) - easeInOut(progress(u, 'open-3'));
  const grandchildren = easeInOut(progress(u, 'fold-2')) - easeInOut(progress(u, 'open-2'));
  const top = 1 - easeInOut(progress(u, 'open-1'));

  // カメラの角度（0=真上、1=斜め上）。折っている間に斜め上へ、開いている間に真上へ、ゆっくり動く。
  // カメラの距離と注視点は、そのとき見えている面がちょうど画面に収まるように scene.js で決める。
  const camera = easeInOutCubic(span(u, 'fold-1', 'fold-2')) - easeInOutCubic(span(u, 'open-1', 'open-3'));

  return {
    fold: { children, grandchildren, top },
    top: easeInOut(progress(u, 'top-appear')),
    camera,
  };
}
