// 復帰画面。記録して復帰回数が増えたときだけ出す。
//
// 自分のルートを持たない。記録画面の保存の結果としてその場で差し替えるので、
// 戻るスワイプでは記録画面ではなくホームへ戻る（記録はもう済んでいる）。

import { fillGauge } from './gauge.js';

const template = document.getElementById('comeback-screen-template');

export function renderComeback(root, header, { habit, stats }) {
  header.replaceChildren();

  const screen = template.content.firstElementChild.cloneNode(true);

  screen.querySelector('.comeback-habit').textContent = `${habit.name} ・ 記録した`;
  screen.querySelector('.comeback-count').textContent = String(stats.comebacks);
  screen.querySelector('.comeback-week').textContent = `${stats.weekCount} / 7`;
  screen.querySelector('.comeback-streak').textContent = `${stats.streak}日目`;
  fillGauge(screen, stats.cumulative);

  screen.querySelector('.comeback-close').addEventListener('click', goHome);

  root.replaceChildren(screen);
  // 記録画面の下のほうを見ていたまま差し替わるので、先頭に戻す。
  window.scrollTo(0, 0);
}

function goHome() {
  location.hash = '';
}
