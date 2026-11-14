// 記録項目の値と集計を、人が読む文字にする。DOM に触れない純関数だけを置く。
//
// 週まとめの画面と、コピー用のテキストで同じ書き方にするため、ここにまとめる。

import { addDays, diffDays, formatMonthDayWeekday, todayISO } from './dates.js';
import { METRIC_KIND, RATING } from './schema.js';
import { metricSummary } from './stats.js';

const RATING_MARKS = { [RATING.DONE]: '○', [RATING.PARTIAL]: '△', [RATING.SKIP]: '×' };

// 値 1 つ。未入力は '–'。0 と見分けられるようにする。
export function formatMetricValue(value) {
  if (value === null || value === undefined) return '–';
  return typeof value === 'number' ? formatNumber(value) : value;
}

// 項目名。単位があれば括弧で添える（例: トリガー回数（回））。
export function formatMetricName(metric) {
  return metric.unit === '' ? metric.label : `${metric.label}（${metric.unit}）`;
}

// 集計の 1 行（例: 合計 9回・平均 3回・記録 3日）。
// 時刻の項目と、値が 1 件も無い数値の項目は、記録日数だけにする。
export function formatMetricTotals({ metric, sum, average, count }) {
  const days = `記録 ${count}日`;
  if (metric.kind !== METRIC_KIND.NUMBER || count === 0) return days;
  return [
    `合計 ${formatNumber(sum)}${metric.unit}`,
    `平均 ${formatNumber(average)}${metric.unit}`,
    days,
  ].join('・');
}

// 1 週間ぶんの記録を、貼り付けて読めるプレーンテキストにする（AI DaiGo に渡す用）。
//
// 並びは、見出し → レベルと合格条件 → 日ごとの ○△× と値 → 集計。
// 開始日より前の日と、まだ来ていない日は行に出さない。記録する対象ではない日を
// 「未記入」と書くと、やらなかった日として読まれてしまう。
// 行動・邪魔したもの・修正のテキストは含めない。合否の判定に要るのは数字だけなので。
export function weekReportText(habit, logs, from, to, today = todayISO()) {
  const summaries = metricSummary(habit, logs, from, to);
  const byDate = new Map(logs.map((log) => [log.date, log]));

  const lines = [`【${habit.name}】${formatMonthDayWeekday(from)}〜${formatMonthDayWeekday(to)}`];
  const label = habit.stage.label.trim();
  const goal = habit.stage.goal.trim();
  if (label !== '') lines.push(`レベル: ${label}`);
  if (goal !== '') lines.push(`合格条件: ${goal}`);
  lines.push('');

  const counts = { '○': 0, '△': 0, '×': 0, '未記入': 0 };
  const length = diffDays(from, to) + 1;
  for (let offset = 0; offset < length; offset += 1) {
    const date = addDays(from, offset);
    if (date < habit.started_on || date > today) continue;

    const log = byDate.get(date);
    const mark = log === undefined ? '未記入' : RATING_MARKS[log.rating];
    counts[mark] += 1;

    const values = summaries
      .filter((summary) => summary.days[offset] !== null)
      .map(({ metric, days }) => `${metric.label} ${formatMetricValue(days[offset])}${metric.unit}`);
    lines.push([formatMonthDayWeekday(date), mark, values.join(' / ')].filter((part) => part !== '').join(' '));
  }
  lines.push('');

  lines.push(`達成: ${Object.entries(counts).map(([mark, count]) => `${mark}${count}`).join(' ')}`);
  for (const summary of summaries) {
    lines.push(`${summary.metric.label}: ${formatMetricTotals(summary)}`);
  }
  return lines.join('\n');
}

// 小数は 2 桁まで。3.666… を 3.67、3.50 を 3.5 と出す。
function formatNumber(value) {
  return String(Math.round(value * 100) / 100);
}
