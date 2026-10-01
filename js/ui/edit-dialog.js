// 習慣の編集（名前・開始日・並べ替え・削除）。
//
// ホームと記録画面の両方から開くので、home.js から切り出した。
// デザインでは独立した画面になるので、UI の ③ でこのモーダルは画面に置き換わる。

import * as storage from '../storage.js';
import { askConfirm } from './confirm.js';

const dialog = document.getElementById('edit-habit-dialog');
const form = document.getElementById('edit-habit-form');
const nameInput = document.getElementById('edit-habit-name');
const startedOnInput = document.getElementById('edit-habit-started-on');
const position = document.getElementById('edit-habit-position');
const upButton = document.getElementById('edit-habit-up');
const downButton = document.getElementById('edit-habit-down');
const errorBox = document.getElementById('edit-habit-error');
const deleteButton = document.getElementById('edit-habit-delete');
const cancelButton = document.getElementById('edit-habit-cancel');

let editing = null;
let onDone = null;
let wired = false;

export async function openEditDialog(habit, { onClose } = {}) {
  wireOnce();
  editing = habit;
  onDone = onClose;

  nameInput.value = habit.name;
  startedOnInput.value = habit.started_on;
  hideError();

  await refreshPosition();
  dialog.showModal();
}

// スワイプからの削除と、編集からの削除で同じ確認を出す。
export async function confirmDeleteHabit(habit) {
  const logs = await storage.getLogs(habit.id);
  const message = logs.length === 0
    ? `「${habit.name}」を削除しますか？`
    : `「${habit.name}」を削除します。記録 ${logs.length} 件も一緒に消えます。`;
  return askConfirm(message, '削除する');
}

async function refreshPosition() {
  const siblings = await storage.getHabits();
  const index = siblings.findIndex((habit) => habit.id === editing.id);

  position.textContent = `${index + 1} / ${siblings.length}`;
  upButton.disabled = index <= 0;
  downButton.disabled = index >= siblings.length - 1;
}

async function move(delta) {
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

async function remove() {
  if (!(await confirmDeleteHabit(editing))) return;
  await storage.deleteHabit(editing.id);
  await close({ deleted: true });
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
    await storage.updateHabit(editing.id, { name, started_on: startedOnInput.value });
  } catch (error) {
    showError(error.message);
    return;
  }
  await close({ deleted: false });
}

// 並べ替えはモーダルの中で既に反映されているので、閉じたら必ず描き直させる。
async function close(result) {
  if (dialog.open) dialog.close();
  const done = onDone;
  editing = null;
  onDone = null;
  await done?.(result);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

function wireOnce() {
  if (wired) return;
  wired = true;

  form.addEventListener('submit', onSubmit);
  cancelButton.addEventListener('click', () => close({ deleted: false }));
  dialog.addEventListener('cancel', () => close({ deleted: false }));
  upButton.addEventListener('click', () => move(-1));
  downButton.addEventListener('click', () => move(1));
  deleteButton.addEventListener('click', remove);
}
