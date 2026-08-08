// 週まとめ画面。started_on から暦日で 7 日ずつ区切った週を並べ、開くと 7 日分を出す。
// 各日を押すと、ホームと同じ記録フォームがその場で開く。
//
// グリッド表示は後の段階でこの上に足す。

import { formatDayLabel, formatMonthDay, todayISO } from '../dates.js';
import * as storage from '../storage.js';
import { buildWeeks } from '../weeks.js';
import { buildGrid, buildLegend } from './grid.js';
import { markFor } from './marks.js';
import { closeRecordForm, isOpenFor, openRecordForm } from './record.js';

export async function renderWeek(root, habit) {
  await closeRecordForm();
  root.replaceChildren();

  const today = todayISO();
  const logs = await storage.getLogs(habit.id);
  const weeks = buildWeeks(logs, { started_on: habit.started_on, today });

  if (weeks.length === 0) {
    const note = document.createElement('p');
    note.className = 'placeholder';
    note.textContent = `開始日は ${formatMonthDay(habit.started_on)} です。まだ始まっていません。`;
    root.append(note);
    return;
  }

  const grid = buildGrid(weeks, logs, { started_on: habit.started_on, today });
  root.append(grid, buildLegend());

  const list = document.createElement('div');
  list.className = 'week-list';

  // 新しい週を上に出す。1 年続けると 52 週になり、Week 1 が上だと直近の週まで
  // 延々スクロールすることになる。
  for (const week of [...weeks].reverse()) {
    list.append(weekRow(habit, week, weeks.length, today));
  }
  root.append(list);

  // 初期表示は右端（最新）。DOM に入ってからでないと幅が決まらない。
  grid.scrollLeft = grid.scrollWidth;
}

function weekRow(habit, week, weekCount, today) {
  const details = document.createElement('details');
  details.className = 'week';
  // 今週だけ開いた状態で出す。いちばんよく見る週なので。
  details.open = week.number === weekCount;

  const summary = document.createElement('summary');

  const number = document.createElement('span');
  number.className = 'week-number';
  number.textContent = `Week ${week.number}`;

  const range = document.createElement('span');
  range.className = 'week-range';
  range.textContent = `${formatMonthDay(week.start)} – ${formatMonthDay(week.end)}`;

  summary.append(number, range);
  details.append(summary);

  // 1 件もログが無い週も、7 日分すべて未記入として出す。飛ばさない。
  for (const day of week.days) {
    details.append(dayRow(habit, day, today));
  }
  return details;
}

function dayRow(habit, day, today) {
  const row = document.createElement('div');
  row.className = 'day';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'day-head';
  // まだ来ていない日は記録する対象ではない。未記入（やらなかった日）とは別物。
  head.disabled = day.future;

  const label = document.createElement('span');
  label.className = 'day-label';
  label.textContent = formatDayLabel(day.date);

  const mark = markFor(day.log);
  const markEl = document.createElement('span');
  markEl.className = `day-mark ${mark.className}`;
  markEl.textContent = day.future ? '' : mark.text;

  const excerpt = document.createElement('span');
  excerpt.className = 'day-excerpt';
  excerpt.textContent = day.log === null ? '' : firstLine(day.log.action);

  head.append(label, markEl, excerpt);
  row.append(head);

  if (!day.future) {
    head.addEventListener('click', () => toggleDay(habit, row, day.date, today));
  }
  return row;
}

async function toggleDay(habit, row, date) {
  if (isOpenFor(habit.id, date)) {
    await closeRecordForm();
    return;
  }

  const holder = document.createElement('div');
  holder.className = 'day-form';
  const recordForm = await openRecordForm({
    habit,
    date,
    onChange: () => refreshRow(habit, row, date),
    onClose: () => holder.remove(),
  });

  holder.append(recordForm);
  row.append(holder);
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function refreshRow(habit, row, date) {
  const log = await storage.getLog(habit.id, date);

  const mark = markFor(log);
  const markEl = row.querySelector('.day-mark');
  markEl.className = `day-mark ${mark.className}`;
  markEl.textContent = mark.text;

  row.querySelector('.day-excerpt').textContent = log === null ? '' : firstLine(log.action);
}

function firstLine(text) {
  return text.split('\n')[0].trim();
}
