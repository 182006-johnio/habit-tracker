// ホーム画面。習慣カードの一覧と、習慣の追加。
// カードを押したときの展開と記録の入力は次の段階で作る。

import { todayISO } from '../dates.js';
import { RATING } from '../schema.js';
import { computeStats } from '../stats.js';
import * as storage from '../storage.js';

const cardTemplate = document.getElementById('habit-card-template');
const dialog = document.getElementById('add-habit-dialog');
const form = document.getElementById('add-habit-form');
const nameInput = document.getElementById('habit-name');
const startedOnInput = document.getElementById('habit-started-on');
const errorBox = document.getElementById('add-habit-error');
const cancelButton = document.getElementById('add-habit-cancel');

// 今日の状態の見せ方。未記入と × は別物なので記号を分ける。
const MARKS = {
  [RATING.DONE]: { text: '○', className: 'mark-done' },
  [RATING.PARTIAL]: { text: '△', className: 'mark-partial' },
  [RATING.SKIP]: { text: '×', className: 'mark-skip' },
};
const NO_MARK = { text: '—', className: 'mark-none' };

let currentRoot = null;
let wired = false;

export async function renderHome(root) {
  currentRoot = root;
  wireDialog();
  root.replaceChildren();

  const habits = await storage.getHabits();
  const today = todayISO();

  if (habits.length === 0) {
    root.append(emptyState());
  } else {
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const habit of habits) {
      list.append(await habitCard(habit, today));
    }
    root.append(list);
  }

  root.append(addButton());
}

async function habitCard(habit, today) {
  const logs = await storage.getLogs(habit.id);
  // 連続日数と挫折回数は保存せず、描くたびに導出する。日付をまたいでも
  // 開いた時点で正しい値になる。
  const { streak, setbacks } = computeStats(logs, { started_on: habit.started_on, today });
  const todayLog = logs.find((log) => log.date === today) ?? null;

  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('.card-name').textContent = habit.name;
  card.querySelector('.stat-streak .stat-value').textContent = String(streak);
  card.querySelector('.stat-setback .stat-value').textContent = String(setbacks);

  const mark = todayLog === null ? NO_MARK : MARKS[todayLog.rating];
  const todayMark = card.querySelector('.card-today');
  todayMark.textContent = mark.text;
  todayMark.classList.add(mark.className);

  return card;
}

function emptyState() {
  const box = document.createElement('div');
  box.className = 'empty';

  const heading = document.createElement('p');
  heading.textContent = 'まだ習慣がありません。';

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = '下のボタンから追加してください。';

  box.append(heading, note);
  return box;
}

function addButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'add-habit';
  button.textContent = '＋ 習慣を追加';
  button.addEventListener('click', openDialog);
  return button;
}

// --- 追加モーダル -------------------------------------------------------

// 一覧は追加のたびに丸ごと描き直すが、モーダルは #screen の外にあるので消えない。
// 購読は最初の 1 回だけにする。
function wireDialog() {
  if (wired) return;
  wired = true;
  form.addEventListener('submit', onSubmit);
  cancelButton.addEventListener('click', () => dialog.close());
}

function openDialog() {
  form.reset();
  startedOnInput.value = todayISO();
  hideError();
  dialog.showModal();
}

async function onSubmit(event) {
  event.preventDefault();
  hideError();

  const name = nameInput.value.trim();
  if (name === '') {
    showError('名前を入力してください。');
    return;
  }

  try {
    await storage.addHabit({ name, started_on: startedOnInput.value });
  } catch (error) {
    // 保存に失敗した場合はモーダルを閉じない。入力を失わせないため。
    showError(error.message);
    return;
  }

  dialog.close();
  await renderHome(currentRoot);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}
