// 習慣の追加・編集の画面。#edit/new と #edit/<habit_id>。
//
// 1 つの画面を追加と編集で使い分ける。追加のときは並び順と削除を出さない
// （末尾に追加されるので位置の選択に意味が無く、消す対象もまだ無い）。

import { todayISO } from '../dates.js';
import * as storage from '../storage.js';
import { askConfirm } from './confirm.js';
import { formatIfThen } from './if-then.js';

const template = document.getElementById('edit-screen-template');

export async function renderEditScreen(root, header, habit) {
  root.replaceChildren();
  header.replaceChildren();

  const form = template.content.firstElementChild.cloneNode(true);
  const fields = {
    name: form.querySelector('#edit-name'),
    startedOn: form.querySelector('#edit-started-on'),
    trigger: form.querySelector('#edit-trigger'),
    action: form.querySelector('#edit-action'),
  };
  const errorBox = form.querySelector('.edit-error');

  fields.name.value = habit?.name ?? '';
  fields.startedOn.value = habit?.started_on ?? todayISO();
  fields.trigger.value = habit?.ifThen?.trigger ?? '';
  fields.action.value = habit?.ifThen?.action ?? '';

  // プレビューは打つそばで変える。記録画面でどう出るかが分かるように。
  const updatePreview = () => fillPreview(form, {
    trigger: fields.trigger.value,
    action: fields.action.value,
  });
  fields.trigger.addEventListener('input', updatePreview);
  fields.action.addEventListener('input', updatePreview);
  updatePreview();

  const orderBlock = form.querySelector('.order-block');
  const deleteButton = form.querySelector('.delete-button');

  if (habit === null) {
    orderBlock.hidden = true;
    deleteButton.hidden = true;
  } else {
    await fillOrder(form, habit);
    form.querySelector('.order-up').addEventListener('click', () => move(form, habit, -1));
    form.querySelector('.order-down').addEventListener('click', () => move(form, habit, 1));
    deleteButton.addEventListener('click', () => remove(habit));
  }

  // Enter での送信も拾う。
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save(habit, fields, errorBox);
  });

  header.append(editHeader(habit, () => save(habit, fields, errorBox)));
  root.append(form);
}

// スワイプからの削除と、編集画面からの削除で同じ確認を出す。
export async function confirmDeleteHabit(habit) {
  const logs = await storage.getLogs(habit.id);
  const message = logs.length === 0
    ? `「${habit.name}」を削除しますか？`
    : `「${habit.name}」を削除します。記録 ${logs.length} 件も一緒に消えます。`;
  return askConfirm(message, '削除する');
}

function editHeader(habit, onSave) {
  const fragment = document.createDocumentFragment();

  const nav = document.createElement('nav');
  nav.className = 'header-nav';
  nav.append(textButton('キャンセル', goHome));

  const title = document.createElement('h1');
  title.className = 'header-title center';
  title.textContent = habit === null ? '習慣を追加' : '習慣を編集';

  const actions = document.createElement('div');
  actions.className = 'header-actions';
  actions.append(textButton('保存', onSave, 'strong'));

  fragment.append(nav, title, actions);
  return fragment;
}

function textButton(label, onClick, extra = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `text-button ${extra}`.trim();
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function fillPreview(form, ifThen) {
  const parts = formatIfThen(ifThen);
  const preview = form.querySelector('.preview');

  if (parts === null) {
    preview.hidden = true;
    return;
  }
  preview.hidden = false;
  form.querySelector('.preview-trigger').textContent = parts.trigger;
  form.querySelector('.preview-action').textContent = parts.action;
  // 片方だけのときは矢印を出さない。
  form.querySelector('.preview-arrow').hidden = parts.trigger === '' || parts.action === '';
}

async function fillOrder(form, habit) {
  const siblings = await storage.getHabits();
  const index = siblings.findIndex((candidate) => candidate.id === habit.id);

  form.querySelector('.order-position').textContent = `${index + 1} / ${siblings.length}`;
  form.querySelector('.order-up').disabled = index <= 0;
  form.querySelector('.order-down').disabled = index >= siblings.length - 1;
}

// 並べ替えは押した時点で反映する。位置は保存を待つ性質のものではない。
async function move(form, habit, delta) {
  const siblings = await storage.getHabits();
  const index = siblings.findIndex((candidate) => candidate.id === habit.id);
  const target = index + delta;
  if (target < 0 || target >= siblings.length) return;

  // 隣と order を入れ替える。order は連番とは限らない（削除で歯抜けになる）が、
  // 値そのものを交換するので問題にならない。
  const moving = siblings[index];
  const neighbour = siblings[target];
  await storage.updateHabit(moving.id, { order: neighbour.order });
  await storage.updateHabit(neighbour.id, { order: moving.order });

  await fillOrder(form, habit);
}

async function remove(habit) {
  if (!(await confirmDeleteHabit(habit))) return;
  await storage.deleteHabit(habit.id);
  goHome();
}

async function save(habit, fields, errorBox) {
  hideError(errorBox);

  const name = fields.name.value.trim();
  if (name === '') {
    showError(errorBox, '名前を入力してください。');
    return;
  }

  const patch = {
    name,
    started_on: fields.startedOn.value,
    ifThen: { trigger: fields.trigger.value, action: fields.action.value },
  };

  try {
    if (habit === null) await storage.addHabit(patch);
    else await storage.updateHabit(habit.id, patch);
  } catch (error) {
    // 保存に失敗したら画面に留まる。入力を失わせないため。
    showError(errorBox, error.message);
    return;
  }
  goHome();
}

function goHome() {
  location.hash = '';
}

function showError(errorBox, message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError(errorBox) {
  errorBox.textContent = '';
  errorBox.hidden = true;
}
