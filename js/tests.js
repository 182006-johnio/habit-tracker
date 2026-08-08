// データ層のテスト。ライブラリは使わず、素の JS で assert して結果を画面に出す。
//
// 本番データを壊さないよう、保存先は専用のキーに切り替えて実行し、最後に消す。

// export は予約語なので、モジュールの束縛名は backup にする。
import * as backup from './export.js';
import * as dates from './dates.js';
import * as schema from './schema.js';
import * as stats from './stats.js';
import * as storage from './storage.js';
import * as weeks from './weeks.js';

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

// 記録日時の更新を見るテスト用。時計が進むのを待つ。
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// 判定ロジック用。'○△×_' を並べた文字列を、開始日から 1 日ずつのログにする。
// '_' は未記入なのでログを作らない。
const START = '2026-08-01';
const MARKS = { '○': schema.RATING.DONE, '△': schema.RATING.PARTIAL, '×': schema.RATING.SKIP };

function day(n) {
  return dates.addDays(START, n - 1); // day(1) が開始日
}

// エクスポートの確認用。storage を経由せず、その場で組み立てる。
function sampleBackup() {
  return {
    schemaVersion: schema.SCHEMA_VERSION,
    habits: [makeHabit({ id: 'h-sample', name: '読書' })],
    logs: [
      makeLog({ id: 'l-sample-1', habit_id: 'h-sample', date: '2026-08-01', rating: schema.RATING.DONE, action: '20ページ' }),
      makeLog({ id: 'l-sample-2', habit_id: 'h-sample', date: '2026-08-02', rating: schema.RATING.PARTIAL, blocker: '寝落ち' }),
    ],
  };
}

function logsFrom(pattern) {
  const logs = [];
  [...pattern].forEach((mark, index) => {
    if (mark === '_') return;
    logs.push(makeLog({ id: `l${index}`, date: day(index + 1), rating: MARKS[mark] }));
  });
  return logs;
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

test('テキストだけ直しても記録日時は変わらない', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  const first = await storage.putLog({
    habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE, action: '5ページ',
  });

  await sleep(10);
  const second = await storage.putLog({
    habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE, action: '20ページ', fix: '朝に読む',
  });

  assertEqual(second.recorded_at, first.recorded_at, '達成度が同じなら据え置かれるはず');
  assertEqual([second.action, second.fix], ['20ページ', '朝に読む'], 'テキストは更新される');
});

test('達成度を付け替えたら記録日時も更新される', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  const first = await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE });

  await sleep(10);
  const second = await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.SKIP });

  assert(second.recorded_at > first.recorded_at, '判断が変わったので更新されるはず');
  assertEqual(second.id, first.id, 'id は据え置き');
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

// --- stats（判定ロジック） ---------------------------------------------

function assertStats(logs, today, streak, setbacks) {
  const actual = stats.computeStats(logs, { started_on: START, today });
  assertEqual([actual.streak, actual.setbacks], [streak, setbacks], '[連続日数, 挫折回数]');
}

// CLAUDE.md「テスト観点」の 6 ケース。
test('観点1: 初日に ○ → 連続 1 / 挫折 0', () => {
  assertStats(logsFrom('○'), day(1), 1, 0);
});

test('観点2: ○ ○ ○ → 連続 3 / 挫折 0', () => {
  assertStats(logsFrom('○○○'), day(3), 3, 0);
});

test('観点3: ○ ○ × ○ → 連続 1 / 挫折 1', () => {
  assertStats(logsFrom('○○×○'), day(4), 1, 1);
});

test('観点4: ○ ○ (未記録) ○ → 連続 1 / 挫折 1', () => {
  assertStats(logsFrom('○○_○'), day(4), 1, 1);
});

test('観点5: ○ △ ○ → 連続 3 / 挫折 0', () => {
  assertStats(logsFrom('○△○'), day(3), 3, 0);
});

test('観点6: 3日間何もせず今日開いた → 連続 0 / 挫折は変わらず', () => {
  assertStats(logsFrom('○○○'), day(6), 0, 0);
  // 次に ○ を付けた瞬間に挫折 +1。
  assertStats(logsFrom('○○○__○'), day(6), 1, 1);
});

// 追加の観点。
test('昨日まで連続していて今日が未記入なら、連続は途切れない', () => {
  assertStats(logsFrom('○○○'), day(4), 3, 0);
});

test('今日に × を付けたら連続は 0 になる', () => {
  assertStats(logsFrom('○○○×'), day(4), 0, 0);
});

test('started_on より前のログは判定に使わない', () => {
  const before = makeLog({ id: 'lbefore', date: dates.addDays(START, -1), rating: schema.RATING.DONE });
  assertStats([before, ...logsFrom('○')], day(1), 1, 0);
});

test('today より後のログは判定に使わない', () => {
  const future = makeLog({ id: 'lfuture', date: day(10), rating: schema.RATING.DONE });
  assertStats([...logsFrom('○○○'), future], day(3), 3, 0);
});

test('2 回復帰したら挫折は 2', () => {
  assertStats(logsFrom('○×○×○'), day(5), 1, 2);
});

test('ログが 1 件も無ければ 0 / 0', () => {
  assertStats([], day(5), 0, 0);
});

test('ログの並び順が日付順でなくても結果は変わらない', () => {
  assertStats(logsFrom('○○×○').reverse(), day(4), 1, 1);
});

test('isActiveDay は ○ と △ だけを有効日とする', () => {
  assert(stats.isActiveDay(schema.RATING.DONE), '○ は有効日');
  assert(stats.isActiveDay(schema.RATING.PARTIAL), '△ は有効日');
  assert(!stats.isActiveDay(schema.RATING.SKIP), '× は有効日ではない');
  assert(!stats.isActiveDay(undefined), '未記入は有効日ではない');
});

test('classifyLogs は連続・復帰・× を見分ける', () => {
  const kinds = stats.classifyLogs(logsFrom('○○×○_△○'), { started_on: START, today: day(7) });
  assertEqual(
    [1, 2, 3, 4, 5, 6, 7].map((n) => kinds.get(day(n)) ?? 'none'),
    ['streak', 'streak', 'skip', 'comeback', 'none', 'comeback', 'streak'],
    '日ごとの分類',
  );
});

test('comeback の数は挫折回数と一致する', () => {
  for (const pattern of ['○○×○_△○', '○×○×○', '○○○', '_○', '×××']) {
    const logs = logsFrom(pattern);
    const today = day(pattern.length);
    const kinds = stats.classifyLogs(logs, { started_on: START, today });
    const comebacks = [...kinds.values()].filter((kind) => kind === 'comeback').length;
    assertEqual(comebacks, stats.setbackCount(logs, { started_on: START, today }), `パターン ${pattern}`);
  }
});

test('最初の有効日は開始日より後でも復帰にしない', () => {
  const kinds = stats.classifyLogs(logsFrom('__○'), { started_on: START, today: day(3) });
  assertEqual(kinds.get(day(3)), 'streak', '最初の有効日は連続扱い');
});

test('classifyLogs は範囲外のログを含めない', () => {
  const before = makeLog({ id: 'lb', date: dates.addDays(START, -1), rating: schema.RATING.DONE });
  const future = makeLog({ id: 'lf', date: day(10), rating: schema.RATING.DONE });
  const kinds = stats.classifyLogs([before, ...logsFrom('○'), future], { started_on: START, today: day(3) });
  assertEqual([...kinds.keys()], [day(1)], '範囲内の日だけが入る');
});

test('判定ロジックは不正な日付を例外にする', async () => {
  await assertThrows(() => stats.currentStreak([], { started_on: '2026-02-30' }), '不正な started_on');
  await assertThrows(() => stats.setbackCount([], { started_on: START, today: 'きょう' }), '不正な today');
});

// --- weeks（週まとめ） --------------------------------------------------

test('weekCount は暦日で 7 日ずつ区切る', () => {
  assertEqual(weeks.weekCount(START, day(1)), 1, '開始日当日');
  assertEqual(weeks.weekCount(START, day(7)), 1, '7 日目はまだ Week 1');
  assertEqual(weeks.weekCount(START, day(8)), 2, '8 日目から Week 2');
  assertEqual(weeks.weekCount(START, day(14)), 2, '14 日目はまだ Week 2');
  assertEqual(weeks.weekCount(START, day(15)), 3, '15 日目から Week 3');
  assertEqual(weeks.weekCount(START, dates.addDays(START, -1)), 0, '開始日より前は 0');
});

test('Week 1 は 1〜7 日目、Week 2 は 8〜14 日目', () => {
  const list = weeks.buildWeeks([], { started_on: START, today: day(14) });
  assertEqual(list.length, 2, '週の数');
  assertEqual([list[0].number, list[0].start, list[0].end], [1, day(1), day(7)], 'Week 1 の範囲');
  assertEqual([list[1].number, list[1].start, list[1].end], [2, day(8), day(14)], 'Week 2 の範囲');
});

test('週は必ず 7 日分の枠を持ち、日付が連続する', () => {
  const list = weeks.buildWeeks(logsFrom('○'), { started_on: START, today: day(20) });
  assertEqual(list.length, 3, '週の数');
  list.forEach((week) => {
    assertEqual(week.days.length, 7, `Week ${week.number} の枠の数`);
    const expected = [0, 1, 2, 3, 4, 5, 6].map((offset) => dates.addDays(week.start, offset));
    assertEqual(week.days.map((d) => d.date), expected, `Week ${week.number} の日付`);
  });
});

test('未記入の日は log が null になり、× とは区別される', () => {
  const [week] = weeks.buildWeeks(logsFrom('○_×'), { started_on: START, today: day(3) });
  assertEqual(week.days[0].log.rating, schema.RATING.DONE, '1 日目は ○');
  assertEqual(week.days[1].log, null, '2 日目は未記入');
  assertEqual(week.days[2].log.rating, schema.RATING.SKIP, '3 日目は ×');
});

test('1 件もログが無い週も空のまま出て、週番号が詰まらない', () => {
  const logs = [
    makeLog({ id: 'w1', date: day(1), rating: schema.RATING.DONE }),
    makeLog({ id: 'w3', date: day(15), rating: schema.RATING.DONE }),
  ];
  const list = weeks.buildWeeks(logs, { started_on: START, today: day(21) });

  assertEqual(list.map((week) => week.number), [1, 2, 3], '週番号は詰まらない');
  assertEqual(list[1].days.filter((d) => d.log !== null).length, 0, 'Week 2 は 1 件も無い');
  assertEqual(list[1].days.length, 7, '空の週も 7 枠');
});

test('まだ来ていない日には future が付く', () => {
  const [week] = weeks.buildWeeks([], { started_on: START, today: day(3) });
  assertEqual(
    week.days.map((d) => d.future),
    [false, false, false, true, true, true, true],
    'today より後だけ true になるはず',
  );
});

test('started_on より前のログはどの週にも入らない', () => {
  const before = makeLog({ id: 'lbefore', date: dates.addDays(START, -1), rating: schema.RATING.DONE });
  const list = weeks.buildWeeks([before, ...logsFrom('○')], { started_on: START, today: day(7) });
  const recorded = list[0].days.filter((d) => d.log !== null).map((d) => d.date);
  assertEqual(recorded, [day(1)], '開始日より前の記録は現れない');
});

test('ログの並び順が日付順でなくても正しい日に入る', () => {
  const list = weeks.buildWeeks(logsFrom('○△×○○○○○').reverse(), { started_on: START, today: day(8) });
  assertEqual(
    list[0].days.map((d) => d.log?.rating ?? null),
    [2, 1, 0, 2, 2, 2, 2],
    'Week 1 の並び',
  );
  assertEqual(list[1].days[0].log.rating, schema.RATING.DONE, 'Week 2 の 1 日目');
  assertEqual(list[1].days[1].log, null, 'Week 2 の 2 日目は未記入');
});

test('buildWeek は指定した週だけを組み立てる', () => {
  const week = weeks.buildWeek(logsFrom('○△×○○○○○'), { started_on: START, number: 2, today: day(8) });
  assertEqual([week.number, week.start, week.end], [2, day(8), day(14)], 'Week 2 の範囲');
  assertEqual(week.days[0].log.rating, schema.RATING.DONE, '8 日目');
  assertEqual(week.days[1].log, null, '9 日目は未記入');
});

test('today が started_on より前なら週は無い', () => {
  const list = weeks.buildWeeks(logsFrom('○'), { started_on: START, today: dates.addDays(START, -1) });
  assertEqual(list, [], '空配列になるはず');
});

test('週まとめは不正な引数を例外にする', async () => {
  await assertThrows(() => weeks.weekCount('2026-02-30', START), '不正な started_on');
  await assertThrows(() => weeks.buildWeek([], { started_on: START, number: 0, today: START }), '週番号 0');
  await assertThrows(() => weeks.buildWeek([], { started_on: START, number: 1.5, today: START }), '整数でない週番号');
});

// --- export（エクスポート） --------------------------------------------

test('backupFilename は仕様どおりの形式で、ローカルの今日を使う', () => {
  assertEqual(backup.backupFilename('2026-08-08'), 'habits-2026-08-08.json', 'ファイル名');
  assertEqual(backup.backupFilename(), `habits-${dates.todayISO()}.json`, '省略時は今日');
});

test('書き出した JSON は往復しても壊れず、validateDB を通る', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE, action: '20ページ' });
  await storage.putLog({ habit_id: habit.id, date: '2026-08-02', rating: schema.RATING.PARTIAL });

  const data = await storage.snapshot();
  const parsed = JSON.parse(backup.serializeBackup(data));

  assert(schema.validateDB(parsed).ok, '書き出した JSON が validateDB を通りません');
  assertEqual(parsed, data, '往復で内容が変わっています');
});

test('書き出す JSON は snapshot そのままで、余計な項目を足さない', async () => {
  await freshStore();
  const parsed = JSON.parse(backup.serializeBackup(await storage.snapshot()));
  assertEqual(Object.keys(parsed).sort(), ['habits', 'logs', 'schemaVersion'], 'トップレベルのキー');
});

test('canUseShare は navigator の能力で判定する', () => {
  const file = new File(['{}'], 'x.json', { type: 'application/json' });
  const share = () => {};
  assert(backup.canUseShare({ share, canShare: () => true }, file), '両方あれば使える');
  assert(!backup.canUseShare({ share, canShare: () => false }, file), 'canShare が false');
  assert(!backup.canUseShare({ canShare: () => true }, file), 'share が無い');
  assert(!backup.canUseShare({ share }, file), 'canShare が無い');
  assert(!backup.canUseShare({}, file), '何も無い');
  assert(!backup.canUseShare(undefined, file), 'navigator が無い');
  assert(!backup.canUseShare({ share, canShare: () => { throw new Error('x'); } }, file), 'canShare が例外を投げる');
});

test('share が使えるなら共有シートに File を渡す', async () => {
  let shared = null;
  const nav = { canShare: () => true, share: async (payload) => { shared = payload; } };
  const result = await backup.exportBackup({ today: '2026-08-08', nav, data: sampleBackup() });

  assertEqual([result.method, result.cancelled], ['share', false], '経路');
  assertEqual(result.filename, 'habits-2026-08-08.json', 'ファイル名');
  assertEqual(shared.files[0].name, 'habits-2026-08-08.json', '共有した File の名前');
  assertEqual(shared.files[0].type, 'application/json', '共有した File の型');
});

test('共有シートを閉じただけならエラーにしない', async () => {
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  const nav = { canShare: () => true, share: async () => { throw abort; } };
  const result = await backup.exportBackup({ today: '2026-08-08', nav, data: sampleBackup() });
  assertEqual([result.method, result.cancelled], ['share', true], 'キャンセル扱いになるはず');
});

test('share が AbortError 以外で失敗しても download に切り替えない', async () => {
  let downloaded = false;
  const nav = { canShare: () => true, share: async () => { throw new Error('boom'); } };
  await assertThrows(
    () => backup.exportBackup({
      today: '2026-08-08',
      nav,
      data: sampleBackup(),
      download: () => { downloaded = true; },
    }),
    'share の失敗',
  );
  assert(!downloaded, 'download にフォールバックしてはいけない');
});

test('share が使えない端末では download に回す', async () => {
  let downloaded = null;
  const result = await backup.exportBackup({
    today: '2026-08-08',
    nav: {}, // share も canShare も持たない端末
    data: sampleBackup(),
    download: (file, filename) => { downloaded = { name: file.name, filename }; },
  });

  assertEqual([result.method, result.cancelled], ['download', false], '経路');
  assertEqual(downloaded.filename, 'habits-2026-08-08.json', 'download に渡したファイル名');
  assertEqual(downloaded.name, 'habits-2026-08-08.json', 'File 自体の名前');
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

// share() はユーザー操作の直後にしか呼べないので、自動テストからは実行できない。
// 経路そのものを試すためのボタン。保存済みのデータには触れず、サンプルを書き出す。
function setupManualExport() {
  const button = document.getElementById('export-sample');
  const result = document.getElementById('export-result');

  button.addEventListener('click', async () => {
    result.className = '';
    result.textContent = '書き出し中…';
    try {
      // data を渡すので storage を読まない。await を挟まずに share() まで届くため、
      // クリックの操作起点も失われない。
      const outcome = await backup.exportBackup({ data: sampleBackup() });
      result.className = 'pass';
      result.textContent = outcome.cancelled
        ? `キャンセルされました（経路: ${outcome.method}）`
        : `${outcome.method} で ${outcome.filename} を書き出しました`;
    } catch (error) {
      result.className = 'fail';
      result.textContent = `失敗しました: ${error.name}: ${error.message}`;
    }
  });
}

setupManualExport();

run().catch((error) => {
  const summary = document.getElementById('summary');
  summary.className = 'fail';
  summary.textContent = `テストの実行自体が失敗しました: ${error.message}`;
});
