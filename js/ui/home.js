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

// 開いているカード。開くのは 1 枚ずつ。
// { habit, article, body, log, date }
let open = null;
let savedNoteTimer = null;

export async function renderHome(root) {
  currentRoot = root;
  wireOnce();
  await closeOpen();
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
function askConfirm(message) {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;

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

  // iOS では PWA をホームに戻したときなどに blur が発火しないことがある。
  // 書きかけを失わないよう、画面が隠れる側でも保存する。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveTexts();
  });
  window.addEventListener('pagehide', saveTexts);
}
