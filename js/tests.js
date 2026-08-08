// データ層のテスト。ライブラリは使わず、素の JS で assert して結果を画面に出す。
//
// 本番データを壊さないよう、保存先は専用のキーに切り替えて実行し、最後に消す。

import * as dates from './dates.js';
import * as schema from './schema.js';
import * as storage from './storage.js';

const TEST_KEY = 'habitTracker.test';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`${message}\n  期待: ${expectedText}\n  実際: ${actualText}`);
  }
}

async function assertThrows(fn, message) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${message}: 例外が投げられませんでした`);
}

async function freshStore() {
  localStorage.removeItem(TEST_KEY);
  await storage.init({ key: TEST_KEY });
}

function makeLog(overrides = {}) {
  return {
    id: 'l1',
    habit_id: 'h1',
    date: '2026-08-01',
    recorded_at: '2026-08-01T00:00:00.000Z',
    rating: schema.RATING.DONE,
    action: '',
    blocker: '',
    fix: '',
    ...overrides,
  };
}

function makeHabit(overrides = {}) {
  return { id: 'h1', name: '読書', started_on: '2026-08-01', archived: false, order: 0, ...overrides };
}

// --- dates ------------------------------------------------------------

test('todayISO はローカルの今日を返す（UTC ではない）', () => {
  const now = new Date();
  const expected = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  assertEqual(dates.todayISO(), expected, 'todayISO がローカル日付と一致しません');
});

test('isValidISO は実在しない日付を弾く', () => {
  assert(dates.isValidISO('2026-02-28'), '2026-02-28 は有効なはず');
  assert(dates.isValidISO('2024-02-29'), '2024-02-29（閏日）は有効なはず');
  assert(!dates.isValidISO('2026-02-29'), '2026-02-29 は無効なはず');
  assert(!dates.isValidISO('2026-02-30'), '2026-02-30 は無効なはず');
  assert(!dates.isValidISO('2026-13-01'), '13 月は無効なはず');
  assert(!dates.isValidISO('2026-8-8'), 'ゼロ埋めなしは無効なはず');
  assert(!dates.isValidISO(20260808), '数値は無効なはず');
  assert(!dates.isValidISO(''), '空文字は無効なはず');
});

test('addDays は月と年をまたげる', () => {
  assertEqual(dates.addDays('2026-08-31', 1), '2026-09-01', '月またぎ');
  assertEqual(dates.addDays('2026-01-01', -1), '2025-12-31', '年またぎ（前方向）');
  assertEqual(dates.addDays('2024-02-28', 1), '2024-02-29', '閏年');
  assertEqual(dates.addDays('2025-02-28', 1), '2025-03-01', '平年');
  assertEqual(dates.addDays('2026-08-08', 0), '2026-08-08', '0 日');
  assertEqual(dates.addDays('2026-08-08', -30), '2026-07-09', '30 日前');
});

test('diffDays は日数の差を返す', () => {
  assertEqual(dates.diffDays('2026-08-01', '2026-08-08'), 7, '7 日後');
  assertEqual(dates.diffDays('2026-08-08', '2026-08-01'), -7, '7 日前');
  assertEqual(dates.diffDays('2026-08-08', '2026-08-08'), 0, '同じ日');
  assertEqual(dates.diffDays('2025-12-31', '2026-01-01'), 1, '年またぎ');
});

test('addDays は不正な日付を例外にする', async () => {
  await assertThrows(() => dates.addDays('2026-02-30', 1), '実在しない日付');
  await assertThrows(() => dates.addDays('2026-08-08', 1.5), '整数でない日数');
});

// --- schema -----------------------------------------------------------

test('createHabit は id・archived・order を埋め、名前を trim する', () => {
  const habit = schema.createHabit({ name: '  腕立て伏せ  ', started_on: '2026-08-08', order: 3 });
  assertEqual(habit.name, '腕立て伏せ', '名前が trim されていません');
  assertEqual(habit.archived, false, 'archived の初期値');
  assertEqual(habit.order, 3, 'order');
  assert(typeof habit.id === 'string' && habit.id.length > 0, 'id が生成されていません');
});

test('createLog は任意項目を空文字で埋め、recorded_at を入れる', () => {
  const log = schema.createLog({ habit_id: 'h1', date: '2026-08-08', rating: schema.RATING.DONE });
  assertEqual([log.action, log.blocker, log.fix], ['', '', ''], '任意項目の既定値');
  assert(!Number.isNaN(Date.parse(log.recorded_at)), 'recorded_at が日時として読めません');
});

test('validateHabit は不正な習慣を検出する', () => {
  assert(schema.validateHabit(makeHabit()).ok, '正しい習慣が弾かれました');
  assert(!schema.validateHabit(makeHabit({ name: '   ' })).ok, '空白だけの名前');
  assert(!schema.validateHabit(makeHabit({ started_on: '2026-08-32' })).ok, '不正な開始日');
  assert(!schema.validateHabit(makeHabit({ archived: 'no' })).ok, 'archived が真偽値でない');
  assert(!schema.validateHabit(makeHabit({ order: null })).ok, 'order が数値でない');
  assert(!schema.validateHabit(null).ok, 'null');
});

test('validateLog は rating と日付を検査する', () => {
  assert(schema.validateLog(makeLog()).ok, '正しいログが弾かれました');
  assert(schema.validateLog(makeLog({ rating: schema.RATING.SKIP })).ok, 'rating 0 は有効なはず');
  assert(!schema.validateLog(makeLog({ rating: 3 })).ok, 'rating 3');
  assert(!schema.validateLog(makeLog({ rating: '2' })).ok, 'rating が文字列');
  assert(!schema.validateLog(makeLog({ date: '2026-02-30' })).ok, '実在しない日付');
  assert(!schema.validateLog(makeLog({ action: null })).ok, 'action が文字列でない');
  assert(!schema.validateLog(makeLog({ recorded_at: 'いつか' })).ok, '読めない recorded_at');
});

test('validateDB は重複と参照切れを検出する', () => {
  const habit = makeHabit();
  const db = (habits, logs) => ({ schemaVersion: 1, habits, logs });

  assert(schema.validateDB(db([habit], [makeLog()])).ok, '正しい DB が弾かれました');
  assert(!schema.validateDB({ schemaVersion: 2, habits: [], logs: [] }).ok, 'schemaVersion 違い');
  assert(!schema.validateDB(db([habit, habit], [])).ok, '習慣 id の重複');
  assert(
    !schema.validateDB(db([habit], [makeLog(), makeLog({ id: 'l2' })])).ok,
    '(habit_id, date) の重複',
  );
  assert(!schema.validateDB(db([habit], [makeLog({ habit_id: 'h9' })])).ok, '存在しない習慣への参照');
  assert(
    schema.validateDB(db([habit], [makeLog(), makeLog({ id: 'l2', date: '2026-08-02' })])).ok,
    '日が違えば重複ではない',
  );
});

// --- storage ----------------------------------------------------------

test('init は空の保存領域から始められる', async () => {
  await freshStore();
  assertEqual(await storage.getHabits(), [], '初期状態は空のはず');
});

test('addHabit は order を 0 から順に振る', async () => {
  await freshStore();
  const first = await storage.addHabit({ name: '腕立て伏せ', started_on: '2026-08-01' });
  const second = await storage.addHabit({ name: '読書', started_on: '2026-08-02' });
  assertEqual([first.order, second.order], [0, 1], 'order の採番');
  assertEqual(
    (await storage.getHabits()).map((habit) => habit.name),
    ['腕立て伏せ', '読書'],
    '一覧は order 順',
  );
});

test('addHabit は不正な入力を拒否する', async () => {
  await freshStore();
  await assertThrows(() => storage.addHabit({ name: '  ', started_on: '2026-08-01' }), '空の名前');
  await assertThrows(() => storage.addHabit({ name: '読書', started_on: '2026-02-30' }), '不正な開始日');
  assertEqual(await storage.getHabits(), [], '失敗した追加が保存されてはいけない');
});

test('保存した内容は読み込み直しても残る', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE });

  await storage.init({ key: TEST_KEY });
  assertEqual((await storage.getHabits()).map((h) => h.name), ['読書'], '再読み込み後の習慣');
  assertEqual((await storage.getLogs(habit.id)).length, 1, '再読み込み後のログ');
});

test('アーカイブした習慣は既定で一覧に出ない', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  await storage.setArchived(habit.id, true);
  assertEqual(await storage.getHabits(), [], '既定では除外されるはず');
  assertEqual((await storage.getHabits({ includeArchived: true })).length, 1, 'includeArchived で出るはず');
});

test('updateHabit は知らないフィールドを拒否する', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  const updated = await storage.updateHabit(habit.id, { name: '読書（30分）' });
  assertEqual(updated.name, '読書（30分）', '名前の更新');
  await assertThrows(() => storage.updateHabit(habit.id, { id: 'x' }), 'id の更新');
  await assertThrows(() => storage.updateHabit(habit.id, { archived: true }), 'archived の更新');
  await assertThrows(() => storage.updateHabit(habit.id, { name: '' }), '空の名前');
  await assertThrows(() => storage.updateHabit('missing', { name: 'x' }), '存在しない習慣');
});

test('putLog は同じ (habit_id, date) を上書きする', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  const first = await storage.putLog({
    habit_id: habit.id,
    date: '2026-08-01',
    rating: schema.RATING.PARTIAL,
    action: '5ページ',
  });
  const second = await storage.putLog({
    habit_id: habit.id,
    date: '2026-08-01',
    rating: schema.RATING.DONE,
    action: '20ページ',
  });

  assertEqual(second.id, first.id, '書き直しても id は変わらないはず');
  assertEqual((await storage.getLogs(habit.id)).length, 1, '2 件目が作られてはいけない');
  assertEqual((await storage.getLog(habit.id, '2026-08-01')).action, '20ページ', '内容が更新されるはず');
});

test('putLog は存在しない習慣と不正な rating を拒否する', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  await assertThrows(
    () => storage.putLog({ habit_id: 'missing', date: '2026-08-01', rating: 2 }),
    '存在しない習慣',
  );
  await assertThrows(
    () => storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: 3 }),
    '範囲外の rating',
  );
  assertEqual((await storage.getLogs(habit.id)).length, 0, '失敗した記録が保存されてはいけない');
});

test('putLog は started_on より前の日付も受け付ける', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-10' });
  const log = await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE });
  assertEqual(log.date, '2026-08-01', '開始日より前でも保存できるはず（判定側で対象外にする）');
});

test('deleteLog は未記入に戻す', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.SKIP });
  assertEqual(await storage.deleteLog(habit.id, '2026-08-01'), true, '1 回目の削除');
  assertEqual(await storage.getLog(habit.id, '2026-08-01'), null, '削除後は未記入');
  assertEqual(await storage.deleteLog(habit.id, '2026-08-01'), false, '2 回目の削除は false');
});

test('getLogsInRange は両端を含み、日付順に返す', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  for (const date of ['2026-08-08', '2026-08-04', '2026-07-31', '2026-08-07', '2026-08-01']) {
    await storage.putLog({ habit_id: habit.id, date, rating: schema.RATING.DONE });
  }
  const logs = await storage.getLogsInRange(habit.id, '2026-08-01', '2026-08-07');
  assertEqual(
    logs.map((log) => log.date),
    ['2026-08-01', '2026-08-04', '2026-08-07'],
    '範囲の両端を含み昇順のはず',
  );
});

test('deleteHabit はその習慣のログも消す', async () => {
  await freshStore();
  const target = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  const other = await storage.addHabit({ name: '腕立て伏せ', started_on: '2026-08-01' });
  await storage.putLog({ habit_id: target.id, date: '2026-08-01', rating: schema.RATING.DONE });
  await storage.putLog({ habit_id: other.id, date: '2026-08-01', rating: schema.RATING.DONE });

  assertEqual(await storage.deleteHabit(target.id), true, '削除の戻り値');
  assertEqual((await storage.getLogs(target.id)).length, 0, '削除した習慣のログ');
  assertEqual((await storage.getLogs(other.id)).length, 1, '他の習慣のログは残るはず');
  assertEqual(await storage.deleteHabit(target.id), false, '2 回目は false');
});

test('読み出しはコピーを返す（書き換えても内部状態に影響しない）', async () => {
  await freshStore();
  await storage.addHabit({ name: '読書', started_on: '2026-08-01' });

  const copy = await storage.snapshot();
  copy.habits[0].name = '書き換え';
  copy.habits.push(makeHabit({ id: 'h9' }));
  assertEqual((await storage.getHabits())[0].name, '読書', 'snapshot 経由で内部状態が変わっています');
  assertEqual((await storage.getHabits()).length, 1, 'snapshot 経由で習慣が増えています');

  const habits = await storage.getHabits();
  habits[0].name = '書き換え';
  assertEqual((await storage.getHabits())[0].name, '読書', 'getHabits 経由で内部状態が変わっています');
});

test('init に失敗した後は読み出しも例外になる', async () => {
  localStorage.setItem(TEST_KEY, '{ 壊れた JSON');
  await assertThrows(() => storage.init({ key: TEST_KEY }), '壊れたデータで init');
  await assertThrows(() => storage.getHabits(), 'init 失敗後の読み出し');
  localStorage.removeItem(TEST_KEY);
});

test('壊れた保存データを上書きしない', async () => {
  const broken = '{ これは JSON ではない';
  localStorage.setItem(TEST_KEY, broken);
  await assertThrows(() => storage.init({ key: TEST_KEY }), '壊れたデータで init');
  assertEqual(localStorage.getItem(TEST_KEY), broken, '壊れたデータが消されてはいけない');
  localStorage.removeItem(TEST_KEY);
});

test('検証に通らない保存データも上書きしない', async () => {
  const invalid = JSON.stringify({ schemaVersion: 1, habits: [{ id: 'h1' }], logs: [] });
  localStorage.setItem(TEST_KEY, invalid);
  await assertThrows(() => storage.init({ key: TEST_KEY }), '不正なデータで init');
  assertEqual(localStorage.getItem(TEST_KEY), invalid, '不正なデータが消されてはいけない');
  localStorage.removeItem(TEST_KEY);
});

// --- 実行 -------------------------------------------------------------

async function run() {
  const summary = document.getElementById('summary');
  const output = document.getElementById('output');
  summary.dataset.started = '1'; // tests.html の「起動できたか」の見張りに知らせる
  let failed = 0;

  for (const { name, fn } of tests) {
    const row = document.createElement('div');
    row.className = 'case';
    try {
      await fn();
      row.classList.add('pass');
      row.textContent = `PASS  ${name}`;
    } catch (error) {
      failed += 1;
      row.classList.add('fail');
      row.textContent = `FAIL  ${name}\n${error.message}`;
    }
    output.append(row);
  }

  localStorage.removeItem(TEST_KEY);
  summary.textContent = `${tests.length} 件中 ${tests.length - failed} 件成功 / ${failed} 件失敗`;
  summary.className = failed === 0 ? 'pass' : 'fail';
}

run().catch((error) => {
  const summary = document.getElementById('summary');
  summary.className = 'fail';
  summary.textContent = `テストの実行自体が失敗しました: ${error.message}`;
});
