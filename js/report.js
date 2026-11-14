// 記録項目の値と集計を、人が読む文字にする。DOM に触れない純関数だけを置く。
//
// 週まとめの画面と、コピー用のテキストで同じ書き方にするため、ここにまとめる。

import { METRIC_KIND } from './schema.js';

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

// 小数は 2 桁まで。3.666… を 3.67、3.50 を 3.5 と出す。
function formatNumber(value) {
  return String(Math.round(value * 100) / 100);
}
