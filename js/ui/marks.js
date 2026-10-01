// ログを達成度の種類に振り分ける。ホームの週モードのドットと、週まとめの表で使う。
//
// 未記入（ログが無い）と ×（rating 0）は表示上は別物。判定ロジックでは
// どちらも断絶日として同じ扱いになる。
//
// グリッドの緑・紫は「連続か復帰か」という別の軸なので、色体系も分けている。
// 同じ色にすると、ドットが分類を表しているように読めてしまう。

import { RATING } from '../schema.js';

const DOT_KINDS = {
  [RATING.DONE]: 'done',
  [RATING.PARTIAL]: 'partial',
  [RATING.SKIP]: 'skip',
};

export function dotKind(log) {
  return log === null || log === undefined ? 'none' : DOT_KINDS[log.rating];
}
