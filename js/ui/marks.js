// 達成度の記号。ホームの「今日の状態」と週まとめの各日で同じものを使う。
//
// 未記入（ログが無い）と ×（rating 0）は表示上は別物。判定ロジックでは
// どちらも断絶日として同じ扱いになる。

import { RATING } from '../schema.js';

const MARKS = {
  [RATING.DONE]: { text: '○', className: 'mark-done' },
  [RATING.PARTIAL]: { text: '△', className: 'mark-partial' },
  [RATING.SKIP]: { text: '×', className: 'mark-skip' },
};

const NO_MARK = { text: '—', className: 'mark-none' };

export function markFor(log) {
  return log === null || log === undefined ? NO_MARK : MARKS[log.rating];
}

// 週モードのドットの種類。こちらは評価（○ △ × 未記入）を表す。
//
// グリッドの緑・紫は「連続か復帰か」という別の軸なので、色体系も分けている。
// 同じ色にすると、ドットが分類を表しているように読めてしまう。
const DOT_KINDS = {
  [RATING.DONE]: 'done',
  [RATING.PARTIAL]: 'partial',
  [RATING.SKIP]: 'skip',
};

export function dotKind(log) {
  return log === null || log === undefined ? 'none' : DOT_KINDS[log.rating];
}
