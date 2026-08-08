// ホーム画面。習慣カードの一覧、習慣の追加、カードを開いての記録。

import { formatTimestamp, todayISO } from '../dates.js';
import { RATING } from '../schema.js';
import { computeStats } from '../stats.js';
import * as storage from '../storage.js';

const cardTemplate = document.getElementById('habit-card-template');
const bodyTemplate = document.getElementById('card-body-template');

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
const editOrderBlock = document.getElementById('edit-habit-order');
const editPosition = document.getElementById('edit-habit-position');
const editUp = document.getElementById('edit-habit-up');
const editDown = document.getElementById('edit-habit-down');
const editError = document.getElementById('edit-habit-error');
const editArchive = document.getElementById('edit-habit-archive');
const editDelete = document.getElementById('edit-habit-delete');
const editCancel = document.getElementById('edit-habit-cancel');

const confirmDialogEl = document.getElementById('confirm-dialog');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');

// 今日の状態の見せ方。未記入と × は別物なので記号を分ける。
const MARKS = {
  [RATING.DONE]: { text: '○', className: 'mark-done' },
  [RATING.PARTIAL]: { text: '△', className: 'mark-partial' },
  [RATING.SKIP]: { text: '×', className: 'mark-skip' },
};
const NO_MARK = { text: '—', className: 'mark-none' };

let currentRoot = null;
let wired = false;
let editing = null;

// 開いているカード。開くのは 1 枚ずつ。
// { habit, article, body, log, date }
let open = null;
let savedNoteTimer = null;

export async function renderHome(root) {
  currentRoot = root;
  wireOnce();
  await closeOpen();
  root.replaceChildren();

  const all = await storage.getHabits({ includeArchived: true });
  const active = all.filter((habit) => !habit.archived);
  const archived = all.filter((habit) => habit.archived);
  const today = todayISO();

  if (active.length === 0) {
    root.append(emptyState());
  } else {
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const habit of active) {
      list.append(await habitCard(habit, today));
    }
    root.append(list);
  }

  root.append(addButton());

  // 休止すると一覧から消えるので、戻せる場所を用意する。1 件も無ければ出さない。
  if (archived.length > 0) {
    root.append(archivedSection(archived));
  }
}

function archivedSection(habits) {
  const details = document.createElement('details');
  details.className = 'archived';

  const summary = document.createElement('summary');
  summary.textContent = `休止中 (${habits.length})`;
  details.append(summary);

  for (const habit of habits) {
    const row = document.createElement('div');
    row.className = 'archived-row';

    const name = document.createElement('span');
    name.textContent = habit.name;

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit-link';
    edit.textContent = '編集';
    edit.addEventListener('click', () => openEdit(habit));

    row.append(name, edit);
    details.append(row);
  }

  return details;
}

// --- カード -------------------------------------------------------------

async function habitCard(habit, today) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('.card-name').textContent = habit.name;
  await fillHead(card, habit, today);

  card.querySelector('.card-head').addEventListener('click', () => toggleCard(habit, card, today));
  return card;
}

// 見出しに出る連続日数・挫折回数・今日の状態は、保存された値ではなく毎回の導出。
async function fillHead(card, habit, today) {
  const logs = await storage.getLogs(habit.id);
  const { streak, setbacks } = computeStats(logs, { started_on: habit.started_on, today });
  const todayLog = logs.find((log) => log.date === today) ?? null;

  card.querySelector('.stat-streak .stat-value').textContent = String(streak);
  card.querySelector('.stat-setback .stat-value').textContent = String(setbacks);

  const mark = todayLog === null ? NO_MARK : MARKS[todayLog.rating];
  const todayMark = card.querySelector('.card-today');
  todayMark.textContent = mark.text;
  todayMark.className = `card-today ${mark.className}`;

  return todayLog;
}

async function toggleCard(habit, card, today) {
  const wasOpen = open !== null && open.article === card;
  await closeOpen();
  if (wasOpen) return;

  const log = await storage.getLog(habit.id, today);
  const body = bodyTemplate.content.firstElementChild.cloneNode(true);
  card.append(body);
  open = { habit, article: card, body, log, date: today };

  body.querySelector('.week-link').href = `#week/${encodeURIComponent(habit.id)}`;
  body.querySelector('.edit-link').addEventListener('click', () => openEdit(habit));
  for (const button of body.querySelectorAll('.rating')) {
    button.addEventListener('click', () => onRating(Number(button.dataset.rating)));
  }
  for (const field of body.querySelectorAll('.field')) {
    field.addEventListener('blur', saveTexts);
  }

  fillBody();
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// 開いているカードを閉じる。書きかけのテキストは閉じる前に保存する。
async function closeOpen() {
  if (open === null) return;
  const closing = open;

  // 画面を切り替えたあとなど、すでに DOM から外れている場合は触らない。
  if (document.contains(closing.article)) {
    await saveTexts();
    closing.body.remove();
  }
  open = null;
}

function fillBody() {
  const { body, log } = open;

  for (const button of body.querySelectorAll('.rating')) {
    const selected = log !== null && Number(button.dataset.rating) === log.rating;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }

  const recordedAt = body.querySelector('.recorded-at');
  recordedAt.textContent = log === null
    ? '達成度を選ぶと記入できます'
    : `${formatTimestamp(log.recorded_at)} に記録`;
  recordedAt.classList.toggle('muted', log === null);

  for (const field of body.querySelectorAll('.field')) {
    field.disabled = log === null;
    field.value = log === null ? '' : log[field.dataset.field];
  }
}

// --- 記録 ---------------------------------------------------------------

async function onRating(rating) {
  const { habit, article, body, log, date } = open;

  if (log !== null && log.rating === rating) {
    // 二度押しは取り消し。× と未記入は別物なので、達成度の付け替えでは戻せない。
    const hasText = [...body.querySelectorAll('.field')].some((field) => field.value.trim() !== '');
    if (hasText && !(await askConfirm('記入したテキストも一緒に消えます。この日の記録を消しますか？'))) {
      return;
    }
    await storage.deleteLog(habit.id, date);
    open.log = null;
  } else {
    // 表示中のテキストは引き継ぐ。達成度だけ差し替える形にする。
    open.log = await storage.putLog({ habit_id: habit.id, date, rating, ...readFields(body) });
  }

  fillBody();
  await fillHead(article, habit, date);
}

async function saveTexts() {
  if (open === null || open.log === null) return;
  const { habit, body, log, date } = open;

  const values = readFields(body);
  const unchanged = ['action', 'blocker', 'fix'].every((key) => values[key].trim() === log[key]);
  if (unchanged) return;

  // 達成度は変えない。putLog は達成度が同じなら recorded_at を据え置くので、
  // テキストを直しても「いつ判断したか」は動かない。
  open.log = await storage.putLog({ habit_id: habit.id, date, rating: log.rating, ...values });
  showSavedNote();
}

function readFields(body) {
  const values = {};
  for (const field of body.querySelectorAll('.field')) {
    values[field.dataset.field] = field.value;
  }
  return values;
}

// 自動保存は動いていることが見えないと不安になるので、控えめに出して消す。
function showSavedNote() {
  const note = open.body.querySelector('.saved-note');
  note.hidden = false;
  clearTimeout(savedNoteTimer);
  savedNoteTimer = setTimeout(() => { note.hidden = true; }, 2000);
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

// dialog の close イベントには依存しない。閉じて returnValue も設定されるのに
// close が発火しない環境があり、その場合 await が解決せず操作が固まる。
// ボタンのクリックで直接決め、Esc（cancel イベント）は取り消し扱いにする。
// --- 習慣の編集 ---------------------------------------------------------

async function openEdit(habit) {
  editing = habit;
  editName.value = habit.name;
  editStartedOn.value = habit.started_on;
  editArchive.textContent = habit.archived ? '再開する' : '休止する';
  // 休止中の並び順は畳まれた一覧の中の話なので出さない。
  editOrderBlock.hidden = habit.archived;
  hideEditError();

  if (!habit.archived) await refreshPosition();
  editDialog.showModal();
}

// 並べ替えは休止状態が同じ習慣の中で行う。休止中の習慣が間に挟まっていても
// 「上へ」が空振りしないようにするため。
async function siblingsOf(habit) {
  const all = await storage.getHabits({ includeArchived: true });
  return all.filter((candidate) => candidate.archived === habit.archived);
}

async function refreshPosition() {
  const siblings = await siblingsOf(editing);
  const index = siblings.findIndex((habit) => habit.id === editing.id);

  editPosition.textContent = `${index + 1} / ${siblings.length}`;
  editUp.disabled = index <= 0;
  editDown.disabled = index >= siblings.length - 1;
}

async function moveEditing(delta) {
  const siblings = await siblingsOf(editing);
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

async function toggleArchive() {
  await storage.setArchived(editing.id, !editing.archived);
  await closeEdit();
}

async function deleteEditing() {
  const logs = await storage.getLogs(editing.id);
  const message = logs.length === 0
    ? `「${editing.name}」を削除しますか？`
    : `「${editing.name}」を削除します。記録 ${logs.length} 件も一緒に消えます。`;

  if (!(await askConfirm(message, '削除する'))) return;

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

function askConfirm(message, okLabel = '消す') {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmOk.textContent = okLabel;

    const settle = (ok) => {
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      confirmDialogEl.removeEventListener('cancel', onCancel);
      if (confirmDialogEl.open) confirmDialogEl.close();
      resolve(ok);
    };
    const onOk = () => settle(true);
    const onCancel = () => settle(false);

    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    confirmDialogEl.addEventListener('cancel', onCancel);
    confirmDialogEl.showModal();
  });
}

// 一覧は描き直されるが、モーダルと画面全体の購読は 1 回だけ張る。
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
  editArchive.addEventListener('click', toggleArchive);
  editDelete.addEventListener('click', deleteEditing);

  // iOS では PWA をホームに戻したときなどに blur が発火しないことがある。
  // 書きかけを失わないよう、画面が隠れる側でも保存する。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveTexts();
  });
  window.addEventListener('pagehide', saveTexts);
}
