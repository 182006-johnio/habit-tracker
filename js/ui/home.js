// ホーム画面（今日の習慣）。
//
// カードは展開しない。○△× が常に見えていて押せば即座に保存され、習慣名を
// 押すと記録画面へ移る。

import { formatLongDate, todayISO } from '../dates.js';
import { CUMULATIVE_GOAL, cardMode, computeStats } from '../stats.js';
import * as storage from '../storage.js';
import { buildWeek } from '../weeks.js';
import { backupSection } from './backup.js';
import { confirmDeleteHabit, openEditDialog } from './edit-dialog.js';
import { dotKind } from './marks.js';
import { setRating } from './rating.js';
import { closeOpenSwipe, enableSwipe } from './swipe.js';

const cardTemplate = document.getElementById('habit-card-template');
const mainTemplates = {
  streak: document.getElementById('card-main-streak-template'),
  week: document.getElementById('card-main-week-template'),
  done: document.getElementById('card-main-done-template'),
};
const dotTemplate = document.getElementById('week-dot-template');

const addDialog = document.getElementById('add-habit-dialog');
const addForm = document.getElementById('add-habit-form');
const addName = document.getElementById('habit-name');
const addStartedOn = document.getElementById('habit-started-on');
const addError = document.getElementById('add-habit-error');
const addCancel = document.getElementById('add-habit-cancel');

// 週の曜日ラベル。週は月曜始まり。
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

let currentRoot = null;
let wired = false;

export async function renderHome(root, header) {
  currentRoot = root;
  wireOnce();
  closeOpenSwipe();
  root.replaceChildren();
  header.replaceChildren();

  const today = todayISO();
  header.append(homeHeader(today));

  const habits = await storage.getHabits();
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

  // 習慣が 0 件でも必ず出す。読み込みがいちばん要るのはその状態のため。
  root.append(backupSection(() => renderHome(currentRoot, header)));
}

function homeHeader(today) {
  const fragment = document.createDocumentFragment();

  const main = document.createElement('div');
  main.className = 'header-main';

  const date = document.createElement('div');
  date.className = 'header-date';
  date.textContent = formatLongDate(today);

  const title = document.createElement('h1');
  title.className = 'header-title';
  title.textContent = '今日の習慣';

  main.append(date, title);

  const actions = document.createElement('div');
  actions.className = 'header-actions';
  actions.append(addIconButton());

  fragment.append(main, actions);
  return fragment;
}

// 週まとめへのアイコンはデザインにあるが、いまの週まとめは習慣ごとの画面なので
// ヘッダーからは出さない。全習慣をまとめた画面を作る ⑤ で足す。
function addIconButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button primary';
  button.setAttribute('aria-label', '習慣を追加');
  button.append(icon('M10 4v12', 'M4 10h12'));
  button.addEventListener('click', openAddDialog);
  return button;
}

function icon(...paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// --- カード -------------------------------------------------------------

async function habitCard(habit, today) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);

  const name = card.querySelector('.card-name');
  name.textContent = habit.name;
  name.href = `#record/${encodeURIComponent(habit.id)}`;

  await fillCard(card, habit, today);

  for (const button of card.querySelectorAll('.rating')) {
    button.addEventListener('click', () => onRating(card, habit, today, Number(button.dataset.rating)));
  }

  enableSwipe(card.querySelector('.card-surface'));
  card.querySelector('.trash-button').addEventListener('click', () => deleteFromSwipe(habit));

  return card;
}

// 連続日数・復帰回数・累計は保存された値ではなく毎回の導出。
async function fillCard(card, habit, today) {
  const logs = await storage.getLogs(habit.id);
  const stats = computeStats(logs, { started_on: habit.started_on, today });
  const todayLog = logs.find((log) => log.date === today) ?? null;

  card.querySelector('.card-comeback').textContent = `復帰 ${stats.comebacks}回`;

  const main = card.querySelector('.card-main');
  main.replaceChildren(mainBlock(cardMode(stats), stats, logs, habit, today));

  const reached = stats.cumulative >= CUMULATIVE_GOAL;
  card.querySelector('.gauge-label').textContent = reached
    ? `累計 ${stats.cumulative}日`
    : `累計 ${stats.cumulative} / ${CUMULATIVE_GOAL}日`;
  const ratio = Math.min(stats.cumulative, CUMULATIVE_GOAL) / CUMULATIVE_GOAL;
  card.querySelector('.gauge-fill').style.width = `${ratio * 100}%`;

  for (const button of card.querySelectorAll('.rating')) {
    const selected = todayLog !== null && Number(button.dataset.rating) === todayLog.rating;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function mainBlock(mode, stats, logs, habit, today) {
  const block = mainTemplates[mode].content.firstElementChild.cloneNode(true);

  if (mode === 'streak') {
    block.querySelector('.main-number').textContent = String(stats.streak);
    return block;
  }

  if (mode === 'done') {
    block.querySelector('.main-number').textContent = String(stats.streak);
    return block;
  }

  block.querySelector('.main-number').textContent = String(stats.weekCount);
  block.querySelector('.main-sub').textContent = `連続 ${stats.streak}日`;

  const week = buildWeek(logs, { weekStart: today, started_on: habit.started_on, today });
  const dots = block.querySelector('.week-dots');
  week.days.forEach((day, index) => {
    const dot = dotTemplate.content.firstElementChild.cloneNode(true);
    dot.querySelector('.dot').classList.add(`dot-${dotKind(day.log)}`);
    dot.querySelector('.week-day-label').textContent = WEEKDAY_LABELS[index];
    dots.append(dot);
  });
  return block;
}

async function onRating(card, habit, today, rating) {
  const logs = await storage.getLogs(habit.id);
  const log = logs.find((candidate) => candidate.date === today) ?? null;

  await setRating({ habit, date: today, rating, log });
  await fillCard(card, habit, today);
}

async function deleteFromSwipe(habit) {
  if (!(await confirmDeleteHabit(habit))) {
    closeOpenSwipe();
    return;
  }
  await storage.deleteHabit(habit.id);
  await rerender();
}

// --- 空の状態 -----------------------------------------------------------

function emptyState() {
  const box = document.createElement('div');
  box.className = 'empty';

  const dots = document.createElement('div');
  dots.className = 'empty-dots';
  for (const filled of [true, false, false]) {
    const dot = document.createElement('span');
    dot.className = filled ? 'empty-dot filled' : 'empty-dot';
    dots.append(dot);
  }

  const heading = document.createElement('p');
  heading.className = 'empty-heading';
  heading.textContent = '習慣はまだない';

  const note = document.createElement('p');
  note.className = 'empty-note';
  note.textContent = '続けたいことを1つと、それを始めるきっかけを決めて登録する。';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary-button';
  button.textContent = '最初の習慣を追加';
  button.addEventListener('click', openAddDialog);

  box.append(dots, heading, note, button);
  return box;
}

// --- 習慣の追加 ---------------------------------------------------------

function openAddDialog() {
  addForm.reset();
  addStartedOn.value = todayISO();
  hideAddError();
  addDialog.showModal();
}

async function onAddSubmit(event) {
  event.preventDefault();
  hideAddError();

  const name = addName.value.trim();
  if (name === '') {
    showAddError('名前を入力してください。');
    return;
  }

  try {
    await storage.addHabit({ name, started_on: addStartedOn.value });
  } catch (error) {
    // 保存に失敗した場合はモーダルを閉じない。入力を失わせないため。
    showAddError(error.message);
    return;
  }

  addDialog.close();
  await rerender();
}

function showAddError(message) {
  addError.textContent = message;
  addError.hidden = false;
}

function hideAddError() {
  addError.textContent = '';
  addError.hidden = true;
}

// 記録画面など別の場所から編集したあとも、戻ってきたら最新を描く。
export async function rerender() {
  if (currentRoot === null) return;
  await renderHome(currentRoot, document.getElementById('app-header'));
}

export { openEditDialog };

function wireOnce() {
  if (wired) return;
  wired = true;
  addForm.addEventListener('submit', onAddSubmit);
  addCancel.addEventListener('click', () => addDialog.close());
}
