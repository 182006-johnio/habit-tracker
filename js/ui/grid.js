// グリッド表示（草）。週まとめ画面の週一覧の上に置く。
//
// 週を縦の列にして横スクロールさせる。週を横の行にすると日数が増えるほど縦に伸びて
// 画面を圧迫するが、この向きなら縦は 7 マスで固定され、何年続けても高さが変わらない。
//
// マスは押せない。全体像を眺めるためのもので、直したい日は下の週一覧から辿る。
// 12px のマスは指では狙いにくく、誤タップも起きやすい。

import { RATING } from '../schema.js';
import { classifyLogs } from '../stats.js';

const KIND_CLASS = {
  streak: 'cell-streak',
  comeback: 'cell-comeback',
  skip: 'cell-skip',
};

const LEGEND = [
  ['cell-streak', '連続'],
  ['cell-comeback', '復帰'],
  ['cell-skip', '×'],
];

// weeks は buildWeeks() の戻り値をそのまま渡す。週 × 7 日という形が
// グリッドと同じなので、新しい導出は要らない。
export function buildGrid(weeks, logs, { started_on, today }) {
  const kinds = classifyLogs(logs, { started_on, today });

  const scroller = document.createElement('div');
  scroller.className = 'grid-scroller';

  const grid = document.createElement('div');
  grid.className = 'grid';

  // 左が古く右が新しい。週一覧とは逆順だが、時間が右へ流れる形にする。
  for (const week of weeks) {
    const column = document.createElement('div');
    column.className = 'grid-week';
    for (const day of week.days) {
      column.append(cell(day, kinds.get(day.date)));
    }
    grid.append(column);
  }

  scroller.append(grid);
  return scroller;
}

export function buildLegend() {
  const legend = document.createElement('div');
  legend.className = 'grid-legend';

  for (const [className, label] of LEGEND) {
    const item = document.createElement('span');
    item.className = 'legend-item';

    const swatch = document.createElement('span');
    swatch.className = `cell ${className}`;

    const text = document.createElement('span');
    text.textContent = label;

    item.append(swatch, text);
    legend.append(item);
  }

  return legend;
}

function cell(day, kind) {
  const box = document.createElement('span');
  box.className = 'cell';

  // 未記入とまだ来ていない日はクラスを足さない＝透明のまま。
  if (kind === undefined) return box;

  box.classList.add(KIND_CLASS[kind]);
  // 種類が色相、達成度が濃さ。△ は同じ色の薄い版。
  if (day.log !== null && day.log.rating === RATING.PARTIAL) {
    box.classList.add('cell-partial');
  }
  return box;
}
