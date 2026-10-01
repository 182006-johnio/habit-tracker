// 週まとめ。月曜始まり・日曜終わりの暦週で区切り、UI がそのまま描ける形に組み立てる。
//
// 区切りを全習慣で共通にするため、習慣の開始日は起点にしない。習慣ごとに境界が
// ずれていると、ホームに並ぶ「今週 n / 7」が習慣ごとに違う期間を指すことになり、
// 全習慣 × 曜日の表も作れない。
//
// 週は必ず 7 日分の枠を持つ。ログが無い日も飛ばさず、1 件もログが無い週も出す。
// 未記入と ×（rating 0）は別物になる（log が null か log.rating が 0 か）。
// 判定ロジックではどちらも断絶日として同じ扱いだが、表示上は区別する。

import { addDays, isValidISO, startOfWeek, todayISO } from './dates.js';

const DAYS_PER_WEEK = 7;

export { startOfWeek };

export function endOfWeek(iso) {
  return addDays(startOfWeek(iso), DAYS_PER_WEEK - 1);
}

// from と to に重なる週の月曜を、古い順に返す。
export function listWeekStarts(from, to) {
  requireDate(from, 'from');
  requireDate(to, 'to');

  const first = startOfWeek(from);
  const last = startOfWeek(to);
  if (last < first) return [];

  const starts = [];
  for (let date = first; date <= last; date = addDays(date, DAYS_PER_WEEK)) {
    starts.push(date);
  }
  return starts;
}

// 習慣 1 つ分の、ある週の 7 日分。
export function buildWeek(logs, { weekStart, started_on, today = todayISO() } = {}) {
  requireDate(weekStart, 'weekStart');
  requireDate(started_on, 'started_on');
  requireDate(today, 'today');

  const start = startOfWeek(weekStart);
  const byDate = indexByDate(logs);

  const days = [];
  for (let offset = 0; offset < DAYS_PER_WEEK; offset += 1) {
    const date = addDays(start, offset);
    days.push({
      date,
      log: byDate.get(date) ?? null,
      // 暦週にすると開始日が週の途中に来る。開始前の日を「未記入」と同じ見た目に
      // すると、やらなかった日として読めてしまう。
      beforeStart: date < started_on,
      // まだ来ていない日。記録する対象ではない。
      future: date > today,
    });
  }

  return { start, end: addDays(start, DAYS_PER_WEEK - 1), days };
}

export function buildWeeks(logs, { started_on, today = todayISO() } = {}) {
  requireDate(started_on, 'started_on');
  requireDate(today, 'today');
  if (today < started_on) return [];

  return listWeekStarts(started_on, today)
    .map((weekStart) => buildWeek(logs, { weekStart, started_on, today }));
}

// 日付をキーにした索引。storage が (habit_id, date) の一意を保証しているので、
// 1 つの習慣のログであれば日付が重複することはない。
function indexByDate(logs) {
  return new Map(logs.map((log) => [log.date, log]));
}

function requireDate(value, label) {
  if (!isValidISO(value)) {
    throw new TypeError(`${label} が 'YYYY-MM-DD' 形式の実在する日付ではありません: ${String(value)}`);
  }
}
