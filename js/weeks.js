// 週まとめ。started_on から暦日で 7 日ずつ区切り、UI がそのまま描ける形に組み立てる。
//
// 記録した日数ではなく暦日で数える。未記入の日も振り返りの対象として残すため、
// 週は必ず 7 日分の枠を持ち、ログが無い日も飛ばさない。1 件もログが無い週も出す。
//
// 未記入と ×（rating 0）はここでは別物になる。log が null なら未記入、
// log.rating が 0 なら × である。判定ロジックではどちらも断絶日として同じ扱いだが、
// 表示上は区別すると仕様が定めている。
//
// 畳んだ一覧から 1 週だけ開く UI に対応できるよう、buildWeek を単独で呼べるようにしてある。

import { addDays, diffDays, isValidISO, todayISO } from './dates.js';

const DAYS_PER_WEEK = 7;

// 週がいくつあるか。today を含む週までを数える。
// today が started_on より前なら、まだ振り返る対象がないので 0。
export function weekCount(started_on, today = todayISO()) {
  requireDate(started_on, 'started_on');
  requireDate(today, 'today');

  const elapsed = diffDays(started_on, today);
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / DAYS_PER_WEEK) + 1;
}

export function buildWeek(logs, { started_on, number, today = todayISO() } = {}) {
  requireDate(started_on, 'started_on');
  requireDate(today, 'today');
  if (!Number.isInteger(number) || number < 1) {
    throw new TypeError(`週番号には 1 以上の整数を渡してください: ${String(number)}`);
  }
  return makeWeek(indexByDate(logs), started_on, number, today);
}

export function buildWeeks(logs, { started_on, today = todayISO() } = {}) {
  const count = weekCount(started_on, today);
  const byDate = indexByDate(logs);

  const weeks = [];
  for (let number = 1; number <= count; number += 1) {
    weeks.push(makeWeek(byDate, started_on, number, today));
  }
  return weeks;
}

function makeWeek(byDate, started_on, number, today) {
  const start = addDays(started_on, (number - 1) * DAYS_PER_WEEK);

  const days = [];
  for (let offset = 0; offset < DAYS_PER_WEEK; offset += 1) {
    const date = addDays(start, offset);
    days.push({
      date,
      log: byDate.get(date) ?? null,
      // まだ来ていない日。未記入（やらなかった日）と同じ見た目にしないための印。
      future: date > today,
    });
  }

  return { number, start, end: addDays(start, DAYS_PER_WEEK - 1), days };
}

// 日付をキーにした索引。storage が (habit_id, date) の一意を保証しているので、
// 1 つの習慣のログであれば日付が重複することはない。
// started_on より前のログは、どの週の枠とも日付が一致しないので自然に外れる。
function indexByDate(logs) {
  return new Map(logs.map((log) => [log.date, log]));
}

function requireDate(value, label) {
  if (!isValidISO(value)) {
    throw new TypeError(`${label} が 'YYYY-MM-DD' 形式の実在する日付ではありません: ${String(value)}`);
  }
}
