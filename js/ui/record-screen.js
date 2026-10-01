// 記録画面。いまは最小構成で、既存の記録フォームを置いているだけ。
//
// ホームのカードが展開式でなくなったので、テキストを書く場所としてここが要る。
// if-then の表示・邪魔タグの入力・「記録する」ボタンは UI の ④ で足す。

import { formatLongDate, todayISO } from '../dates.js';
import * as storage from '../storage.js';
import { openEditDialog } from './edit-dialog.js';
import { closeRecordForm, openRecordForm } from './record.js';

export async function renderRecordScreen(root, header, habit) {
  await closeRecordForm();
  root.replaceChildren();
  header.replaceChildren();

  const today = todayISO();
  header.append(recordHeader(habit, today));

  const form = await openRecordForm({ habit, date: today });
  root.append(form, links(habit));
}

function recordHeader(habit, today) {
  const fragment = document.createDocumentFragment();

  const nav = document.createElement('nav');
  nav.className = 'header-nav';
  const back = document.createElement('a');
  back.className = 'back-link';
  back.href = '#';
  back.textContent = '← 今日';
  nav.append(back);

  const main = document.createElement('div');
  main.className = 'header-main';

  const title = document.createElement('h1');
  title.className = 'header-title small';
  title.textContent = habit.name;

  const date = document.createElement('div');
  date.className = 'header-date';
  date.textContent = formatLongDate(today);

  main.append(title, date);
  fragment.append(nav, main);
  return fragment;
}

function links(habit) {
  const row = document.createElement('div');
  row.className = 'card-links';

  const week = document.createElement('a');
  week.className = 'week-link';
  week.href = `#week/${encodeURIComponent(habit.id)}`;
  week.textContent = '週まとめを見る';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit-link';
  edit.textContent = '編集';
  edit.addEventListener('click', () => openEditDialog(habit, {
    onClose: async (result) => {
      // 削除されたらこの画面は意味を失うのでホームへ戻す。
      if (result?.deleted) {
        location.hash = '';
        return;
      }
      const updated = await storage.getHabit(habit.id);
      if (updated) await renderRecordScreen(document.getElementById('screen'), document.getElementById('app-header'), updated);
    },
  }));

  row.append(week, edit);
  return row;
}
