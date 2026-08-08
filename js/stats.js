// 判定ロジック。連続日数と挫折回数を logs から導出する。
//
// 副作用のない純関数として書く。カウンタを保存せず呼ばれるたびに数え直すので、
// 何日ぶりにアプリを開いても正しい値になる。0 時の締め処理は要らない。
//
// logs には 1 つの習慣のログ（storage.getLogs(habit_id) の戻り値）を渡す。
// today を引数で受け取るのは、実行日に依存させないため。省略時は今日。

import { RATING } from './schema.js';
import { addDays, diffDays, isValidISO, todayISO } from './dates.js';

// 有効日 = rating が 2（○）または 1（△）の日。
// 断絶日 = 有効日でない日。× の日と、ログが無い日の両方を含む。
export function isActiveDay(rating) {
  return rating === RATING.DONE || rating === RATING.PARTIAL;
}

// 今日から過去に遡り、有効日が連続している数を数える。
export function currentStreak(logs, options) {
  const { started_on, today } = normalizeOptions(options);
  const active = activeDateSet(logs, started_on, today);

  // 起点を決める。今日が未記入なら、まだ結果が出ていないだけなので昨日から数える。
  // 今日が × のときは本人が断絶を記録しているので、その猶予は与えない。
  let cursor = today;
  if (!active.has(today)) {
    if (hasLogOn(logs, today)) return 0;
    cursor = addDays(today, -1);
  }

  let count = 0;
  while (cursor >= started_on && active.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

// 一度切れてから戻ってきた回数。
export function setbackCount(logs, options) {
  const { started_on, today } = normalizeOptions(options);
  const dates = activeDates(logs, started_on, today);

  // 隣り合う有効日が 2 日以上離れていれば、その間に断絶日があり、
  // 後ろ側の有効日が復帰した日にあたる。先頭の有効日は比較相手がいないので
  // 自然に対象から外れ、「最初の有効日は数えない」が満たされる。
  let count = 0;
  for (let i = 1; i < dates.length; i += 1) {
    if (diffDays(dates[i - 1], dates[i]) > 1) count += 1;
  }
  return count;
}

// 日ごとの分類。グリッド表示の色分けに使う。ログがある日だけを返し、
// 地図に無い日は未記入。
//
// 緑（streak）と紫（comeback）の判別には前の有効日を見る必要があり、週をまたぐので
// 週の中だけでは決まらない。数え方は setbackCount とまったく同じにしてあるので、
// comeback の数がそのまま挫折回数と一致する。
export function classifyLogs(logs, options) {
  const { started_on, today } = normalizeOptions(options);
  const kinds = new Map();

  for (const log of logs) {
    if (log.date < started_on || log.date > today) continue;
    if (!isActiveDay(log.rating)) kinds.set(log.date, 'skip');
  }

  // 先頭の有効日は復帰ではないので連続扱い。以降は前の有効日との間隔で決める。
  const dates = activeDates(logs, started_on, today);
  dates.forEach((date, index) => {
    const comeback = index > 0 && diffDays(dates[index - 1], date) > 1;
    kinds.set(date, comeback ? 'comeback' : 'streak');
  });

  return kinds;
}

export function computeStats(logs, options) {
  const { started_on, today } = normalizeOptions(options);
  return {
    streak: currentStreak(logs, { started_on, today }),
    setbacks: setbackCount(logs, { started_on, today }),
  };
}

// 有効日の一覧を昇順で返す。
// started_on より前は仕様どおり判定対象外。today より後は、明日の分を先に記録したときに
// 数字が先取りで動かないよう対象から外す。
function activeDates(logs, started_on, today) {
  return logs
    .filter((log) => isActiveDay(log.rating) && log.date >= started_on && log.date <= today)
    .map((log) => log.date)
    .sort();
}

function activeDateSet(logs, started_on, today) {
  return new Set(activeDates(logs, started_on, today));
}

function hasLogOn(logs, date) {
  return logs.some((log) => log.date === date);
}

function normalizeOptions({ started_on, today = todayISO() } = {}) {
  if (!isValidISO(started_on)) {
    throw new TypeError(`started_on が 'YYYY-MM-DD' 形式の実在する日付ではありません: ${String(started_on)}`);
  }
  if (!isValidISO(today)) {
    throw new TypeError(`today が 'YYYY-MM-DD' 形式の実在する日付ではありません: ${String(today)}`);
  }
  return { started_on, today };
}
