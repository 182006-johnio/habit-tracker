// 週まとめ画面。#week が今週、#week/<週の月曜> がその週。
//
// 習慣ごとではなく、全習慣 × 曜日の表にする（CLAUDE.md v2「週の区切りをカレンダー週に
// する」）。週は全習慣で共通なので、1 枚の表にその週の全部が収まる。
//
// 表のマスを押すと、その習慣のその日の記録画面へ移る。マスは 7 列に割ると 44px 四方は
// 取れないが（390px の画面に入らない）、高さは 44px 取り、過去の日を直す経路は残す。

import { addDays, formatMonthDay, startOfWeek, todayISO } from '../dates.js';
import { blockerRanking, isActiveDay } from '../stats.js';
import * as storage from '../storage.js';
import { buildWeek, endOfWeek } from '../weeks.js';
import { dotKind } from './marks.js';

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];
const DAYS_PER_WEEK = 7;
const BLOCKER_TOP = 3;

// 過去の週は押せるボタンで出す。1 年続けると 52 週あるので、古いほうは
// 前の週ボタンで辿る。
const PAST_WEEK_LIMIT = 8;

// weekStart は null なら今週。
export async function renderWeek(root, header, weekStart) {
  root.replaceChildren();
  header.replaceChildren();

  const today = todayISO();
  const thisWeek = startOfWeek(today);
  const start = weekStart === null ? thisWeek : startOfWeek(weekStart);
  const end = endOfWeek(start);

  // 全習慣をまたぐ画面なので、まとめて 1 回読む。
  const db = await storage.snapshot();
  const habits = [...db.habits].sort((a, b) => a.order - b.order);
  const logsByHabit = groupByHabit(db.logs);

  const first = habits.length === 0 ? thisWeek : startOfWeek(earliestStart(habits));
  header.append(weekHeader(start, end, { first, last: thisWeek }));

  if (habits.length === 0) {
    const note = document.createElement('p');
    note.className = 'placeholder';
    note.textContent = '習慣がまだありません。';
    root.append(note);
    return;
  }

  root.append(...[
    table(habits, logsByHabit, start, today),
    blockerCard(db.logs, start, end),
    pastWeeks(habits, logsByHabit, start, today, first),
  ].filter((section) => section !== null));
}

// --- ヘッダー -----------------------------------------------------------

function weekHeader(start, end, limits) {
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
  title.textContent = '週まとめ';
  const range = document.createElement('div');
  range.className = 'header-date';
  range.textContent = `${formatMonthDay(start)} – ${formatMonthDay(end)}`;
  main.append(title, range);

  const stack = document.createElement('div');
  stack.className = 'header-stack';
  stack.append(nav, main);

  const actions = document.createElement('div');
  actions.className = 'header-actions';
  actions.append(
    stepButton('前の週', addDays(start, -DAYS_PER_WEEK), start <= limits.first, 'M12.5 4.5 7 10l5.5 5.5'),
    stepButton('次の週', addDays(start, DAYS_PER_WEEK), start >= limits.last, 'M7.5 4.5 13 10l-5.5 5.5'),
  );

  fragment.append(stack, actions);
  return fragment;
}

// 無効にできるようボタンにする。リンクは disabled にできない。
function stepButton(label, target, disabled, path) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.append(chevron(path));
  button.addEventListener('click', () => { location.hash = `week/${target}`; });
  return button;
}

function chevron(path) {
  return svg('2', [path]);
}

function svg(width, paths) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  element.setAttribute('viewBox', '0 0 20 20');
  element.setAttribute('fill', 'none');
  element.setAttribute('stroke', 'currentColor');
  element.setAttribute('stroke-width', width);
  element.setAttribute('stroke-linecap', 'round');
  element.setAttribute('stroke-linejoin', 'round');
  element.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', d);
    element.append(node);
  }
  return element;
}

// --- 習慣 × 曜日の表 ----------------------------------------------------

function table(habits, logsByHabit, start, today) {
  const card = document.createElement('section');
  card.className = 'week-table';

  card.append(headRow());
  for (const habit of habits) {
    card.append(habitRow(habit, logsByHabit.get(habit.id) ?? [], start, today));
  }
  card.append(legend());
  return card;
}

function headRow() {
  const row = document.createElement('div');
  row.className = 'week-row';
  row.append(document.createElement('div')); // 習慣名の列

  for (const label of WEEKDAY_LABELS) {
    const cell = document.createElement('div');
    cell.className = 'week-head-cell';
    cell.textContent = label;
    row.append(cell);
  }

  row.append(document.createElement('div')); // 達成数の列
  return row;
}

function habitRow(habit, logs, start, today) {
  const row = document.createElement('div');
  row.className = 'week-row';

  const name = document.createElement('a');
  name.className = 'week-habit';
  name.href = `#record/${encodeURIComponent(habit.id)}`;
  name.textContent = habit.name;
  row.append(name);

  const week = buildWeek(logs, { weekStart: start, started_on: habit.started_on, today });
  let count = 0;
  for (const day of week.days) {
    if (day.log !== null && isActiveDay(day.log.rating)) count += 1;
    row.append(dayCell(habit, day));
  }

  const total = document.createElement('div');
  total.className = 'week-count';
  total.textContent = `${count}/${DAYS_PER_WEEK}`;
  row.append(total);

  return row;
}

function dayCell(habit, day) {
  // まだ来ていない日は記録する対象ではない。開始前の日も判定の対象外なので、
  // どちらも未記入（やらなかった日）とは見た目を分ける。
  const outside = day.future || day.beforeStart;

  const cell = document.createElement(outside ? 'span' : 'a');
  cell.className = 'week-cell';

  if (outside) {
    cell.classList.add('outside');
  } else {
    cell.href = `#record/${encodeURIComponent(habit.id)}/${day.date}`;
    cell.setAttribute('aria-label', `${habit.name} ${formatMonthDay(day.date)}`);
  }

  // 範囲外の日は、記録が残っている場合だけ薄く出す。
  if (!outside || day.log !== null) cell.append(markSvg(dotKind(day.log)));
  return cell;
}

// ○ △ × と未記入の記号。文字ではなく図形で描く（フォントによる字形のばらつきを避ける）。
function markSvg(kind) {
  if (kind === 'none') {
    const dot = document.createElement('span');
    dot.className = 'week-mark week-mark-none';
    return dot;
  }

  if (kind === 'done') {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    element.setAttribute('viewBox', '0 0 20 20');
    element.setAttribute('fill', 'currentColor');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('class', 'week-mark week-mark-done');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '10');
    circle.setAttribute('cy', '10');
    circle.setAttribute('r', '8');
    element.append(circle);
    return element;
  }

  const element = kind === 'partial'
    ? svg('2.2', ['M10 3.5 17 16H3z'])
    : svg('2.4', ['M5 5l10 10M15 5 5 15']);
  element.setAttribute('class', `week-mark week-mark-${kind}`);
  return element;
}

function legend() {
  const row = document.createElement('div');
  row.className = 'week-legend';

  for (const [kind, label] of [['done', 'できた'], ['partial', '少し'], ['skip', 'できず'], ['none', '未記入']]) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.append(markSvg(kind));

    const text = document.createElement('span');
    text.textContent = label;
    item.append(text);

    row.append(item);
  }
  return row;
}

// --- 今週多かった邪魔 ----------------------------------------------------

function blockerCard(logs, from, to) {
  const card = document.createElement('section');
  card.className = 'blocker-card';

  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = 'この週に多かった邪魔';
  card.append(title);

  const ranking = blockerRanking(logs, from, to).slice(0, BLOCKER_TOP);
  if (ranking.length === 0) {
    const note = document.createElement('p');
    note.className = 'card-note';
    note.textContent = 'この週はまだタグが付いていません。';
    card.append(note);
    return card;
  }

  // 棒の長さは 1 位を満幅にした相対値。回数そのものは右に数字で出す。
  const max = ranking[0].count;
  for (const { tag, count } of ranking) {
    card.append(blockerRow(tag, count, max));
  }
  return card;
}

function blockerRow(tag, count, max) {
  const row = document.createElement('div');
  row.className = 'blocker-row';

  const name = document.createElement('div');
  name.className = 'blocker-tag';
  name.textContent = tag;

  const track = document.createElement('div');
  track.className = 'blocker-track';
  const fill = document.createElement('div');
  fill.className = 'blocker-fill';
  fill.style.width = `${(count / max) * 100}%`;
  track.append(fill);

  const number = document.createElement('div');
  number.className = 'blocker-count';
  number.textContent = `×${count}`;

  row.append(name, track, number);
  return row;
}

// --- 過去の週 -----------------------------------------------------------

function pastWeeks(habits, logsByHabit, start, today, first) {
  const starts = [];
  for (
    let date = addDays(start, -DAYS_PER_WEEK);
    date >= first && starts.length < PAST_WEEK_LIMIT;
    date = addDays(date, -DAYS_PER_WEEK)
  ) {
    starts.push(date);
  }
  if (starts.length === 0) return null;

  const box = document.createElement('section');
  box.className = 'past-weeks';

  const label = document.createElement('p');
  label.className = 'sub-label';
  label.textContent = '過去の週';
  box.append(label);

  for (const weekStart of starts) {
    box.append(pastWeekLink(weekStart, habits, logsByHabit, today));
  }
  return box;
}

function pastWeekLink(weekStart, habits, logsByHabit, today) {
  const link = document.createElement('a');
  link.className = 'past-week';
  link.href = `#week/${weekStart}`;

  const range = document.createElement('span');
  range.textContent = `${formatMonthDay(weekStart)} – ${formatMonthDay(endOfWeek(weekStart))}`;

  const total = document.createElement('span');
  total.className = 'past-week-total';
  total.textContent = `${activeCount(weekStart, habits, logsByHabit, today)}/${habits.length * DAYS_PER_WEEK}`;

  link.append(range, total);
  return link;
}

// その週に全習慣で何日できたか。分母は習慣の数 × 7 のおおまかな目安で、
// 週の途中で始めた習慣の分も引かない。
function activeCount(weekStart, habits, logsByHabit, today) {
  const end = endOfWeek(weekStart);

  let count = 0;
  for (const habit of habits) {
    for (const log of logsByHabit.get(habit.id) ?? []) {
      if (log.date < weekStart || log.date > end) continue;
      if (log.date < habit.started_on || log.date > today) continue;
      if (isActiveDay(log.rating)) count += 1;
    }
  }
  return count;
}

// --- 内部 ---------------------------------------------------------------

function groupByHabit(logs) {
  const map = new Map();
  for (const log of logs) {
    const list = map.get(log.habit_id);
    if (list === undefined) map.set(log.habit_id, [log]);
    else list.push(log);
  }
  return map;
}

function earliestStart(habits) {
  return habits.reduce((min, habit) => (habit.started_on < min ? habit.started_on : min), habits[0].started_on);
}
