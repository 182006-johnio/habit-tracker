// 66日累計ゲージ。ホームのカードと復帰画面で同じものを使う。
//
// 66 に達しても数え続ける。ゲージは満タンで止め、ラベルから「/ 66日」を外す。

import { CUMULATIVE_GOAL } from '../stats.js';

// root の中の .gauge-label と .gauge-track > .gauge-fill を埋める。
export function fillGauge(root, cumulative) {
  const reached = cumulative >= CUMULATIVE_GOAL;
  root.querySelector('.gauge-label').textContent = reached
    ? `累計 ${cumulative}日`
    : `累計 ${cumulative} / ${CUMULATIVE_GOAL}日`;

  const ratio = Math.min(cumulative, CUMULATIVE_GOAL) / CUMULATIVE_GOAL;
  root.querySelector('.gauge-fill').style.width = `${ratio * 100}%`;
}
