// 記録フォーム。ホームの「今日の記録」と、週まとめの「過去の日の記録・修正」で
// 同じものを使う。書き写すと同じロジックが 2 か所になり、片方だけ直す事故が起きる。
//
// 開けるのは常に 1 つだけ。新しく開くと、前のものは書きかけを保存してから閉じる。

import { formatTimestamp, todayISO } from '../dates.js';
import * as storage from '../storage.js';
import { askConfirm } from './confirm.js';

const template = document.getElementById('record-form-template');

// 対象日が今日かどうかで項目名を入れ替える。3 日前を直しているのに
// 「今日」と出るのを避ける。
const LABELS = {
  today: { action: '今日の一行動', blocker: '今日邪魔したもの', fix: '明日への修正' },
  past: { action: 'その日の一行動', blocker: 'その日邪魔したもの', fix: '翌日への修正' },
};

let active = null;
let savedNoteTimer = null;
let wired = false;

export function isOpenFor(habitId, date) {
  return active !== null && active.habit.id === habitId && active.date === date;
}

// フォームの要素を返す。呼び出し側が好きな場所に差し込む。
// onChange  記録が変わったときに呼ぶ（呼び出し側の見出しや行を更新するため）
// onClose   閉じるときに呼ぶ（呼び出し側が自分で作った入れ物を片付けるため）
export async function openRecordForm({ habit, date, onChange, onClose }) {
  wireOnce();
  await closeRecordForm();

  const element = template.content.firstElementChild.cloneNode(true);
  const log = await storage.getLog(habit.id, date);
  const state = { habit, date, element, log, onChange, onClose };
  active = state;

  const labels = date === todayISO() ? LABELS.today : LABELS.past;
  for (const name of element.querySelectorAll('.field-name')) {
    name.textContent = labels[name.dataset.label];
  }
  for (const button of element.querySelectorAll('.rating')) {
    button.addEventListener('click', () => onRating(state, Number(button.dataset.rating)));
  }
  for (const field of element.querySelectorAll('.field')) {
    field.addEventListener('blur', () => saveTexts(state));
  }

  fill(state);
  return element;
}

export async function closeRecordForm() {
  if (active === null) return;
  const closing = active;
  active = null;

  // 画面を切り替えたあとなど、すでに DOM から外れている場合は触らない。
  if (document.contains(closing.element)) {
    await saveTexts(closing);
    closing.onClose?.();
  }
}

function fill(state) {
  const { element, log } = state;

  for (const button of element.querySelectorAll('.rating')) {
    const selected = log !== null && Number(button.dataset.rating) === log.rating;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }

  const recordedAt = element.querySelector('.recorded-at');
  recordedAt.textContent = log === null
    ? '達成度を選ぶと記入できます'
    : `${formatTimestamp(log.recorded_at)} に記録`;
  recordedAt.classList.toggle('muted', log === null);

  for (const field of element.querySelectorAll('.field')) {
    field.disabled = log === null;
    field.value = log === null ? '' : log[field.dataset.field];
  }
}

async function onRating(state, rating) {
  const { habit, date, element, log } = state;

  if (log !== null && log.rating === rating) {
    // 二度押しは取り消し。× と未記入は別物なので、達成度の付け替えでは戻せない。
    const hasText = [...element.querySelectorAll('.field')].some((field) => field.value.trim() !== '');
    if (hasText && !(await askConfirm('記入したテキストも一緒に消えます。この日の記録を消しますか？'))) {
      return;
    }
    await storage.deleteLog(habit.id, date);
    state.log = null;
  } else {
    // 表示中のテキストは引き継ぐ。達成度だけ差し替える形にする。
    state.log = await storage.putLog({ habit_id: habit.id, date, rating, ...readFields(element) });
  }

  fill(state);
  await state.onChange?.();
}

async function saveTexts(state) {
  if (state.log === null) return;

  const values = readFields(state.element);
  const unchanged = ['action', 'blocker', 'fix'].every((key) => values[key].trim() === state.log[key]);
  if (unchanged) return;

  // 達成度は変えない。putLog は達成度が同じなら recorded_at を据え置くので、
  // テキストを直しても「いつ判断したか」は動かない。
  state.log = await storage.putLog({
    habit_id: state.habit.id,
    date: state.date,
    rating: state.log.rating,
    ...values,
  });
  showSavedNote(state);
  await state.onChange?.();
}

function readFields(element) {
  const values = {};
  for (const field of element.querySelectorAll('.field')) {
    values[field.dataset.field] = field.value;
  }
  return values;
}

// 自動保存は動いていることが見えないと不安になるので、控えめに出して消す。
function showSavedNote(state) {
  const note = state.element.querySelector('.saved-note');
  note.hidden = false;
  clearTimeout(savedNoteTimer);
  savedNoteTimer = setTimeout(() => { note.hidden = true; }, 2000);
}

function wireOnce() {
  if (wired) return;
  wired = true;

  // iOS では PWA をホームに戻したときなどに blur が発火しないことがある。
  // 書きかけを失わないよう、画面が隠れる側でも保存する。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && active !== null) saveTexts(active);
  });
  window.addEventListener('pagehide', () => {
    if (active !== null) saveTexts(active);
  });
}
