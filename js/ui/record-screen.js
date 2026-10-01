// 記録画面。#record/<habit_id> が今日、#record/<habit_id>/<date> がその日。
//
// ホームのカードは押した時点で保存するが、この画面は「記録する」を押した時点で確定する
// （CLAUDE.md「記録の保存はカードと記録画面で使い分ける」）。選んでいる達成度をもう一度
// 押すと外れ、外した状態で確定するとその日の記録を消す。
//
// 保存して復帰回数が増えたときだけ、復帰画面に切り替える。

import { formatMonthDayWeekday, formatTimestamp, todayISO } from '../dates.js';
import { CUMULATIVE_GOAL, comebackCount, computeStats, tagUsage } from '../stats.js';
import * as storage from '../storage.js';
import { renderComeback } from './comeback.js';
import { askConfirm } from './confirm.js';
import { formatIfThen } from './if-then.js';
import { closeRecordForm } from './record.js';
import { createTagInput } from './tags.js';

const template = document.getElementById('record-screen-template');

// 対象日が今日かどうかで項目名を入れ替える。3 日前を直しているのに
// 「今日」と出るのを避ける。
const LABELS = {
  today: { action: '今日の行動', fix: '明日への修正' },
  past: { action: 'その日の行動', fix: '翌日への修正' },
};

export async function renderRecordScreen(root, header, habit, date) {
  // 週まとめ画面に開いたままの記録フォームがあれば、書きかけを保存して閉じる。
  await closeRecordForm();

  root.replaceChildren();
  header.replaceChildren();

  const today = todayISO();
  const range = { started_on: habit.started_on, today };
  const logs = await storage.getLogs(habit.id);
  const log = logs.find((candidate) => candidate.date === date) ?? null;

  header.append(recordHeader(habit, date, today, computeStats(logs, range)));

  const screen = template.content.firstElementChild.cloneNode(true);
  const labels = date === today ? LABELS.today : LABELS.past;

  // 候補のタグは習慣をまたいで集計する。「疲労」はどの習慣でも同じ言葉なので、
  // 習慣ごとに別の候補を持たせる意味がない。
  const { logs: allLogs } = await storage.snapshot();
  const tagInput = createTagInput({ tags: log?.blockerTags ?? [], usage: tagUsage(allLogs) });
  screen.querySelector('.tag-slot').replaceWith(tagInput.element);

  const state = {
    root,
    header,
    habit,
    date,
    today,
    log,
    rating: log === null ? null : log.rating,
    tagInput,
    screen,
    fields: {
      action: screen.querySelector('#record-action'),
      note: screen.querySelector('#record-note'),
      fix: screen.querySelector('#record-fix'),
    },
  };

  fillIfThen(screen, habit.ifThen);

  screen.querySelector('label[for="record-action"]').textContent = labels.action;
  screen.querySelector('label[for="record-fix"]').textContent = labels.fix;

  state.fields.action.value = log?.action ?? '';
  state.fields.note.value = log?.blockerNote ?? '';
  state.fields.fix.value = log?.fix ?? '';

  for (const button of screen.querySelectorAll('.rating-big')) {
    button.addEventListener('click', () => pickRating(state, Number(button.dataset.rating)));
  }
  screen.querySelector('.submit-button').addEventListener('click', () => submit(state));

  drawRatings(state);
  drawSubmit(state);

  root.append(screen, links(habit));
}

// --- ヘッダー -----------------------------------------------------------

function recordHeader(habit, date, today, stats) {
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
  title.className = 'header-title';
  title.textContent = habit.name;
  const sub = document.createElement('div');
  sub.className = 'header-date';
  sub.textContent = subLine(date, today, stats);
  main.append(title, sub);

  // 戻るリンクを見出しの上に積む。ヘッダー自体は横並びなので、縦に積む分だけ
  // 1 つの箱にまとめる。
  const stack = document.createElement('div');
  stack.className = 'header-stack';
  stack.append(nav, main);

  const actions = document.createElement('div');
  actions.className = 'header-actions';
  const edit = document.createElement('a');
  edit.className = 'text-button';
  edit.href = `#edit/${encodeURIComponent(habit.id)}`;
  edit.textContent = '編集';
  actions.append(edit);

  fragment.append(stack, actions);
  return fragment;
}

// 今週・連続・累計は今日時点の状態を指す。過去の日を直しているときに並べると
// その日の数字だと読めてしまうので、日付だけにする。
function subLine(date, today, stats) {
  if (date !== today) return `${formatMonthDayWeekday(date)}・過去の日の記録`;

  const cumulative = stats.cumulative >= CUMULATIVE_GOAL
    ? `累計 ${stats.cumulative}日`
    : `累計 ${stats.cumulative}/${CUMULATIVE_GOAL}`;

  // 中黒の前後に空白を入れると 390px で折り返す。詰めて 1 行に収める。
  return [
    formatMonthDayWeekday(today),
    `今週 ${stats.weekCount}/7`,
    `連続 ${stats.streak}日`,
    cumulative,
  ].join('・');
}

function links(habit) {
  const row = document.createElement('div');
  row.className = 'card-links';

  const week = document.createElement('a');
  week.className = 'week-link';
  week.href = `#week/${encodeURIComponent(habit.id)}`;
  week.textContent = '週まとめを見る';

  row.append(week);
  return row;
}

// --- 画面の更新 ---------------------------------------------------------

function fillIfThen(screen, ifThen) {
  const card = screen.querySelector('.if-then-card');
  const parts = formatIfThen(ifThen);

  if (parts === null) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  screen.querySelector('.if-then-trigger').textContent = parts.trigger;
  screen.querySelector('.if-then-action').textContent = parts.action;
  // 片方だけのときは矢印を出さない。
  screen.querySelector('.if-then-arrow').hidden = parts.trigger === '' || parts.action === '';
}

function pickRating(state, rating) {
  // 選んでいるものをもう一度押すと外れる。ホームのカードの二度押しと同じ操作で、
  // 外したまま確定すればその日の記録が消える。
  state.rating = state.rating === rating ? null : rating;
  hideError(state);
  drawRatings(state);
  drawSubmit(state);
}

function drawRatings(state) {
  for (const button of state.screen.querySelectorAll('.rating-big')) {
    const selected = Number(button.dataset.rating) === state.rating;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

// ボタンに書いてあることと、押した結果を一致させる。達成度を外した状態では
// 「記録する」ではなく削除になるので、見た目もそう変える。
function drawSubmit(state) {
  const button = state.screen.querySelector('.submit-button');
  const removing = state.rating === null && state.log !== null;

  button.textContent = removing ? 'この日の記録を消す' : '記録する';
  button.classList.toggle('danger-button', removing);

  state.screen.querySelector('.submit-note').textContent = state.log === null
    ? '記録時刻は保存した時点で自動で入る'
    : `${formatTimestamp(state.log.recorded_at)} に記録`;
}

// --- 保存 ---------------------------------------------------------------

async function submit(state) {
  hideError(state);

  if (state.rating === null) {
    await remove(state);
    return;
  }

  // 復帰したかどうかは、保存の前後で復帰回数を比べて決める。保存のたびに
  // 数え直すので、どの日を直しても同じ判定になる。
  const range = { started_on: state.habit.started_on, today: state.today };
  const before = comebackCount(await storage.getLogs(state.habit.id), range);

  try {
    await storage.putLog({
      habit_id: state.habit.id,
      date: state.date,
      rating: state.rating,
      action: state.fields.action.value,
      blockerTags: state.tagInput.values(),
      blockerNote: state.fields.note.value,
      fix: state.fields.fix.value,
    });
  } catch (error) {
    // 保存に失敗したら画面に留まる。入力を失わせないため。
    showError(state, error.message);
    return;
  }

  const stats = computeStats(await storage.getLogs(state.habit.id), range);
  if (stats.comebacks > before) {
    renderComeback(state.root, state.header, { habit: state.habit, stats });
    return;
  }
  goHome();
}

async function remove(state) {
  if (state.log === null) {
    showError(state, '達成度を選んでください。');
    return;
  }
  if (!(await askConfirm('この日の記録を消しますか？記入したテキストも消えます。'))) return;

  await storage.deleteLog(state.habit.id, state.date);
  goHome();
}

function goHome() {
  location.hash = '';
}

function showError(state, message) {
  const box = state.screen.querySelector('.record-error');
  box.textContent = message;
  box.hidden = false;
}

function hideError(state) {
  const box = state.screen.querySelector('.record-error');
  box.textContent = '';
  box.hidden = true;
}
