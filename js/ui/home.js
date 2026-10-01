// ホーム画面。習慣カードの一覧、習慣の追加、カードを開いての今日の記録、習慣の管理。
// 記録フォーム本体は record.js にある（週まとめと共有）。

import { todayISO } from '../dates.js';
import { computeStats } from '../stats.js';
import * as storage from '../storage.js';
import { askConfirm } from './confirm.js';
import { markFor } from './marks.js';
import { closeRecordForm, isOpenFor, openRecordForm } from './record.js';
import { closeOpenSwipe, enableSwipe } from './swipe.js';

const cardTemplate = document.getElementById('habit-card-template');

const dialog = document.getElementById('add-habit-dialog');
const form = document.getElementById('add-habit-form');
const nameInput = document.getElementById('habit-name');
const startedOnInput = document.getElementById('habit-started-on');
const errorBox = document.getElementById('add-habit-error');
const cancelButton = document.getElementById('add-habit-cancel');

const editDialog = document.getElementById('edit-habit-dialog');
const editForm = document.getElementById('edit-habit-form');
const editName = document.getElementById('edit-habit-name');
const editStartedOn = document.getElementById('edit-habit-started-on');
const editPosition = document.getElementById('edit-habit-position');
const editUp = document.getElementById('edit-habit-up');
const editDown = document.getElementById('edit-habit-down');
const editError = document.getElementById('edit-habit-error');
const editDelete = document.getElementById('edit-habit-delete');
const editCancel = document.getElementById('edit-habit-cancel');

let currentRoot = null;
let wired = false;
let editing = null;

export async function renderHome(root) {
  currentRoot = root;
  wireOnce();
  closeOpenSwipe();
  await closeRecordForm();
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

// --- カード -------------------------------------------------------------

async function habitCard(habit, today) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('.card-name').textContent = habit.name;
  await fillHead(card, habit, today);

  card.querySelector('.card-head').addEventListener('click', () => toggleCard(habit, card, today));

  // 展開中はスワイプを受け付けない。入力中に消えるのを防ぐため。
  enableSwipe(card.querySelector('.card-surface'), { locked: () => isOpenFor(habit.id, today) });
  card.querySelector('.trash-button').addEventListener('click', () => deleteFromSwipe(habit));

  return card;
}

async function deleteFromSwipe(habit) {
  if (!(await confirmDeleteHabit(habit))) {
    closeOpenSwipe();
    return;
  }
  await storage.deleteHabit(habit.id);
  await renderHome(currentRoot);
}

// スワイプからの削除と、編集モーダルからの削除で同じ確認を出す。
async function confirmDeleteHabit(habit) {
  const logs = await storage.getLogs(habit.id);
  const message = logs.length === 0
    ? `「${habit.name}」を削除しますか？`
    : `「${habit.name}」を削除します。記録 ${logs.length} 件も一緒に消えます。`;
  return askConfirm(message, '削除する');
}

// 見出しに出る連続日数・復帰回数・今日の状態は、保存された値ではなく毎回の導出。
async function fillHead(card, habit, today) {
  const logs = await storage.getLogs(habit.id);
  const { streak, comebacks } = computeStats(logs, { started_on: habit.started_on, today });
  const todayLog = logs.find((log) => log.date === today) ?? null;

  card.querySelector('.stat-streak .stat-value').textContent = String(streak);
  card.querySelector('.stat-comeback .stat-value').textContent = String(comebacks);

  const mark = markFor(todayLog);
  const todayMark = card.querySelector('.card-today');
  todayMark.textContent = mark.text;
  todayMark.className = `card-today ${mark.className}`;
}

async function toggleCard(habit, card, today) {
  closeOpenSwipe();
  if (isOpenFor(habit.id, today)) {
    await closeRecordForm();
    return;
  }

  const body = document.createElement('div');
  body.className = 'card-body';
  const recordForm = await openRecordForm({
    habit,
    date: today,
    // 達成度が変わると連続日数と今日の状態が変わる。一覧を描き直すと展開が閉じ、
    // 入力中のフォーカスも飛ぶので、この見出しだけ更新する。
    onChange: () => fillHead(card, habit, today),
    onClose: () => body.remove(),
  });

  body.append(recordForm, cardLinks(habit));
  card.querySelector('.card-surface').append(body);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function cardLinks(habit) {
  const links = document.createElement('div');
  links.className = 'card-links';

  const week = document.createElement('a');
  week.className = 'week-link';
  week.href = `#week/${encodeURIComponent(habit.id)}`;
  week.textContent = '週まとめを見る';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit-link';
  edit.textContent = '編集';
  edit.addEventListener('click', () => openEdit(habit));

  links.append(week, edit);
  return links;
}

// --- 空の状態と追加 -----------------------------------------------------

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

// --- 習慣の編集 ---------------------------------------------------------

async function openEdit(habit) {
  editing = habit;
  editName.value = habit.name;
  editStartedOn.value = habit.started_on;
  hideEditError();

  await refreshPosition();
  editDialog.showModal();
}

async function refreshPosition() {
  const siblings = await storage.getHabits();
  const index = siblings.findIndex((habit) => habit.id === editing.id);

  editPosition.textContent = `${index + 1} / ${siblings.length}`;
  editUp.disabled = index <= 0;
  editDown.disabled = index >= siblings.length - 1;
}

async function moveEditing(delta) {
  const siblings = await storage.getHabits();
  const index = siblings.findIndex((habit) => habit.id === editing.id);
  const target = index + delta;
  if (target < 0 || target >= siblings.length) return;

  // 隣と order を入れ替える。order は連番とは限らない（削除で歯抜けになる）が、
  // 値そのものを交換するので問題にならない。
  const moving = siblings[index];
  const neighbour = siblings[target];
  await storage.updateHabit(moving.id, { order: neighbour.order });
  await storage.updateHabit(neighbour.id, { order: moving.order });

  editing = await storage.getHabit(editing.id);
  await refreshPosition();
}

async function deleteEditing() {
  if (!(await confirmDeleteHabit(editing))) return;
  await storage.deleteHabit(editing.id);
  await closeEdit();
}

async function onEditSubmit(event) {
  event.preventDefault();
  hideEditError();

  const name = editName.value.trim();
  if (name === '') {
    showEditError('名前を入力してください。');
    return;
  }

  try {
    await storage.updateHabit(editing.id, { name, started_on: editStartedOn.value });
  } catch (error) {
    showEditError(error.message);
    return;
  }
  await closeEdit();
}

// 並べ替えや休止はモーダルの中で既に反映されているので、閉じたら必ず描き直す。
async function closeEdit() {
  if (editDialog.open) editDialog.close();
  editing = null;
  await renderHome(currentRoot);
}

function showEditError(message) {
  editError.textContent = message;
  editError.hidden = false;
}

function hideEditError() {
  editError.textContent = '';
  editError.hidden = true;
}

// 一覧は描き直されるが、モーダルの購読は 1 回だけ張る。
function wireOnce() {
  if (wired) return;
  wired = true;

  form.addEventListener('submit', onSubmit);
  cancelButton.addEventListener('click', () => dialog.close());

  editForm.addEventListener('submit', onEditSubmit);
  editCancel.addEventListener('click', closeEdit);
  editDialog.addEventListener('cancel', closeEdit);
  editUp.addEventListener('click', () => moveEditing(-1));
  editDown.addEventListener('click', () => moveEditing(1));
  editDelete.addEventListener('click', deleteEditing);
}
