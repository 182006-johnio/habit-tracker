// ホーム画面。習慣カードの一覧は次の段階で作る。

import * as storage from '../storage.js';

export async function renderHome(root) {
  const habits = await storage.getHabits();

  if (habits.length === 0) {
    root.append(emptyState());
    return;
  }

  const note = document.createElement('p');
  note.className = 'placeholder';
  note.textContent = `習慣が ${habits.length} 件あります。一覧の表示は次の段階で作ります。`;
  root.append(note);
}

function emptyState() {
  const box = document.createElement('div');
  box.className = 'empty';

  const heading = document.createElement('p');
  heading.textContent = 'まだ習慣がありません。';

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = '追加する機能は次の段階で作ります。';

  box.append(heading, note);
  return box;
}
