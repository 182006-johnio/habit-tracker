// 週まとめ画面。週の一覧とグリッド表示は後の段階で作る。

export async function renderWeek(root, habit) {
  const note = document.createElement('p');
  note.className = 'placeholder';
  note.textContent = `開始日は ${habit.started_on}。週の一覧とグリッド表示は後の段階で作ります。`;
  root.append(note);
}
