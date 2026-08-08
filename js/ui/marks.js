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
