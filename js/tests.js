// データ層のテスト。ライブラリは使わず、素の JS で assert して結果を画面に出す。
//
// 本番データを壊さないよう、保存先は専用のキーに切り替えて実行し、最後に消す。

// export は予約語なので、モジュールの束縛名は backup にする。
import * as backup from './export.js';
import * as dates from './dates.js';
import { formatIfThen } from './ui/if-then.js';
import * as report from './report.js';
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
  // 退避キーも消す。残っていると「移行していないのに退避がある」状態になり、
  // 次のテストが前のテストの後始末に左右される。
  localStorage.removeItem(`${TEST_KEY}.backup.v1`);
  localStorage.removeItem(`${TEST_KEY}.backup.v2`);
  localStorage.removeItem(`${TEST_KEY}.backup.import`);
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
    blockerTags: [],
    blockerNote: '',
    fix: '',
    stage: '',
    values: {},
    ...overrides,
  };
}

function makeHabit(overrides = {}) {
  return {
    id: 'h1',
    name: '読書',
    started_on: '2026-08-01',
    order: 0,
    ifThen: { trigger: '', action: '' },
    stage: { label: '', goal: '' },
    metrics: [],
    ...overrides,
  };
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
      makeLog({ id: 'l-sample-2', habit_id: 'h-sample', date: '2026-08-02', rating: schema.RATING.PARTIAL, blockerNote: '寝落ち' }),
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

test('createHabit は id・order・ifThen を埋め、名前を trim する', () => {
  const habit = schema.createHabit({ name: '  腕立て伏せ  ', started_on: '2026-08-08', order: 3 });
  assertEqual(habit.name, '腕立て伏せ', '名前が trim されていません');
  assertEqual(habit.order, 3, 'order');
  assertEqual(habit.ifThen, { trigger: '', action: '' }, 'ifThen の既定値');
  assert(!('archived' in habit), 'archived は廃止したので付かないはず');
  assert(typeof habit.id === 'string' && habit.id.length > 0, 'id が生成されていません');
});

test('createLog は任意項目を空で埋め、recorded_at を入れる', () => {
  const log = schema.createLog({ habit_id: 'h1', date: '2026-08-08', rating: schema.RATING.DONE });
  assertEqual([log.action, log.blockerNote, log.fix], ['', '', ''], '任意項目の既定値');
  assertEqual(log.blockerTags, [], 'blockerTags の既定値');
  assert(!Number.isNaN(Date.parse(log.recorded_at)), 'recorded_at が日時として読めません');
});

test('validateHabit は不正な習慣を検出する', () => {
  assert(schema.validateHabit(makeHabit()).ok, '正しい習慣が弾かれました');
  assert(!schema.validateHabit(makeHabit({ name: '   ' })).ok, '空白だけの名前');
  assert(!schema.validateHabit(makeHabit({ started_on: '2026-08-32' })).ok, '不正な開始日');
  assert(!schema.validateHabit(makeHabit({ order: null })).ok, 'order が数値でない');
  assert(!schema.validateHabit(null).ok, 'null');
});

test('validateHabit は ifThen を検査する', () => {
  assert(schema.validateHabit(makeHabit({ ifThen: { trigger: '夕食後', action: '1問解く' } })).ok, '正しい ifThen');
  assert(!schema.validateHabit(makeHabit({ ifThen: undefined })).ok, 'ifThen が無い');
  assert(!schema.validateHabit(makeHabit({ ifThen: { trigger: 'a' } })).ok, 'action が無い');
  assert(!schema.validateHabit(makeHabit({ ifThen: { trigger: 1, action: '' } })).ok, 'trigger が文字列でない');
  assert(schema.validateHabit(makeHabit({ ifThen: { trigger: 'あ'.repeat(60), action: '' } })).ok, '60 文字ちょうどは可');
  assert(!schema.validateHabit(makeHabit({ ifThen: { trigger: 'あ'.repeat(61), action: '' } })).ok, '61 文字は不可');
});

test('normalizeTag は NFKC で揃えて前後の空白を落とす', () => {
  assertEqual(schema.normalizeTag('  ＳＮＳ　'), 'SNS', '全角英字と全角スペース');
  assertEqual(schema.normalizeTag('ﾋﾟｱﾉ'), 'ピアノ', '半角カナ');
  assertEqual(schema.normalizeTag('疲労'), '疲労', 'そのまま');
  assertEqual(schema.normalizeTag(5), 5, '文字列でない値はそのまま');
});

test('normalizeTags は空と重複を落とし、不正な値は残す', () => {
  assertEqual(schema.normalizeTags(['疲労', ' 疲労 ', 'SNS']), ['疲労', 'SNS'], '重複をまとめる');
  assertEqual(schema.normalizeTags(['', '　', '疲労']), ['疲労'], '空を落とす');
  assertEqual(schema.normalizeTags(undefined), [], '未指定は空配列');
  assertEqual(schema.normalizeTags([1]), [1], '文字列でない値は検証に回すため残す');
});

test('validateLog は blockerTags を検査する', () => {
  assert(schema.validateLog(makeLog({ blockerTags: ['疲労', 'SNS'] })).ok, '正しいタグ');
  assert(!schema.validateLog(makeLog({ blockerTags: '疲労' })).ok, '配列でない');
  assert(!schema.validateLog(makeLog({ blockerTags: [''] })).ok, '空文字');
  assert(!schema.validateLog(makeLog({ blockerTags: [1] })).ok, '文字列でない');
  assert(!schema.validateLog(makeLog({ blockerTags: ['疲労', '疲労'] })).ok, '重複');
  assert(schema.validateLog(makeLog({ blockerTags: ['あ'.repeat(20)] })).ok, '20 文字ちょうどは可');
  assert(!schema.validateLog(makeLog({ blockerTags: ['あ'.repeat(21)] })).ok, '21 文字は不可');
  assert(!schema.validateLog(makeLog({ blockerNote: null })).ok, 'blockerNote が文字列でない');
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
  // バージョン番号は直書きせず定数から取る。上げるたびに直す羽目になるため。
  const db = (habits, logs) => ({ schemaVersion: schema.SCHEMA_VERSION, habits, logs });

  assert(schema.validateDB(db([habit], [makeLog()])).ok, '正しい DB が弾かれました');
  assert(
    !schema.validateDB({ schemaVersion: schema.SCHEMA_VERSION + 1, habits: [], logs: [] }).ok,
    'schemaVersion 違い',
  );
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

test('addHabit は ifThen を受け取る', async () => {
  await freshStore();
  const habit = await storage.addHabit({
    name: '読書', started_on: '2026-08-01',
    ifThen: { trigger: '  夕食後  ', action: '1ページ' },
  });
  assertEqual(habit.ifThen, { trigger: '夕食後', action: '1ページ' }, '追加時に取り込まれる');

  const plain = await storage.addHabit({ name: '散歩', started_on: '2026-08-01' });
  assertEqual(plain.ifThen, { trigger: '', action: '' }, '省略時は空');
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

test('updateHabit は知らないフィールドを拒否し、ifThen を更新できる', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  const updated = await storage.updateHabit(habit.id, { name: '読書（30分）' });
  assertEqual(updated.name, '読書（30分）', '名前の更新');

  const withIfThen = await storage.updateHabit(habit.id, {
    ifThen: { trigger: '  夕食後  ', action: '1問解く' },
  });
  assertEqual(withIfThen.ifThen, { trigger: '夕食後', action: '1問解く' }, 'ifThen は trim される');

  await assertThrows(() => storage.updateHabit(habit.id, { id: 'x' }), 'id の更新');
  await assertThrows(() => storage.updateHabit(habit.id, { archived: true }), '廃止した archived');
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

function assertStats(logs, today, streak, comebacks) {
  const actual = stats.computeStats(logs, { started_on: START, today });
  assertEqual([actual.streak, actual.comebacks], [streak, comebacks], '[連続日数, 復帰回数]');
}

// CLAUDE.md「テスト観点」の 6 ケース。
test('観点1: 初日に ○ → 連続 1 / 復帰 0', () => {
  assertStats(logsFrom('○'), day(1), 1, 0);
});

test('観点2: ○ ○ ○ → 連続 3 / 復帰 0', () => {
  assertStats(logsFrom('○○○'), day(3), 3, 0);
});

test('観点3: ○ ○ × ○ → 連続 1 / 復帰 1', () => {
  assertStats(logsFrom('○○×○'), day(4), 1, 1);
});

test('観点4: ○ ○ (未記録) ○ → 連続 1 / 復帰 1', () => {
  assertStats(logsFrom('○○_○'), day(4), 1, 1);
});

test('観点5: ○ △ ○ → 連続 3 / 復帰 0', () => {
  assertStats(logsFrom('○△○'), day(3), 3, 0);
});

test('観点6: 3日間何もせず今日開いた → 連続 0 / 復帰は変わらず', () => {
  assertStats(logsFrom('○○○'), day(6), 0, 0);
  // 次に ○ を付けた瞬間に復帰 +1。
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

test('2 回戻ってきたら復帰は 2', () => {
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

test('comeback の数は復帰回数と一致する', () => {
  for (const pattern of ['○○×○_△○', '○×○×○', '○○○', '_○', '×××']) {
    const logs = logsFrom(pattern);
    const today = day(pattern.length);
    const kinds = stats.classifyLogs(logs, { started_on: START, today });
    const comebacks = [...kinds.values()].filter((kind) => kind === 'comeback').length;
    assertEqual(comebacks, stats.comebackCount(logs, { started_on: START, today }), `パターン ${pattern}`);
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
  await assertThrows(() => stats.comebackCount([], { started_on: START, today: 'きょう' }), '不正な today');
});

// --- v1 → v2 の移行 -----------------------------------------------------

// 旧スキーマのデータ。archived を持ち、blocker が自由記述、ifThen が無い。
function v1Data() {
  return {
    schemaVersion: 1,
    habits: [
      { id: 'h1', name: '読書', started_on: '2026-08-01', archived: false, order: 0 },
      { id: 'h2', name: '散歩', started_on: '2026-08-01', archived: true, order: 1 },
    ],
    logs: [
      {
        id: 'l1', habit_id: 'h1', date: '2026-08-01', recorded_at: '2026-08-01T00:00:00.000Z',
        rating: 2, action: '20ページ', blocker: '寝落ち', fix: '早く寝る',
      },
    ],
  };
}

async function initWith(raw) {
  localStorage.removeItem(TEST_KEY);
  localStorage.removeItem(`${TEST_KEY}.backup.v1`);
  localStorage.removeItem(`${TEST_KEY}.backup.v2`);
  localStorage.setItem(TEST_KEY, raw);
  await storage.init({ key: TEST_KEY });
}

test('v1 のデータが現行スキーマに移行される', async () => {
  await initWith(JSON.stringify(v1Data()));
  const db = await storage.snapshot();

  assertEqual(db.schemaVersion, schema.SCHEMA_VERSION, 'schemaVersion');
  assert(db.habits.every((h) => !('archived' in h)), 'archived は落ちるはず');
  assert(db.habits.every((h) => h.ifThen.trigger === '' && h.ifThen.action === ''), '空の ifThen が付くはず');
  assertEqual(db.logs[0].blockerNote, '寝落ち', 'blocker は blockerNote へ移る');
  assertEqual(db.logs[0].blockerTags, [], 'タグには自動変換しない');
  assert(!('blocker' in db.logs[0]), '旧 blocker は落ちるはず');
});

test('休止中だった習慣は消えずに一覧へ戻る', async () => {
  await initWith(JSON.stringify(v1Data()));
  assertEqual((await storage.getHabits()).map((h) => h.name), ['読書', '散歩'], '2 件とも残るはず');
});

test('移行前のデータが退避キーに残る', async () => {
  const raw = JSON.stringify(v1Data());
  await initWith(raw);
  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v1`), raw, '生のまま退避されるはず');
});

test('退避は二度目の移行で上書きされない', async () => {
  const raw = JSON.stringify(v1Data());
  await initWith(raw);

  // もう一度 v1 を書いてから init しても、最初の退避が残る
  const other = JSON.stringify({ ...v1Data(), logs: [] });
  localStorage.setItem(TEST_KEY, other);
  await storage.init({ key: TEST_KEY });

  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v1`), raw, '最初の退避が残るはず');
});

test('すでに現行スキーマなら移行も退避もしない', async () => {
  await freshStore();
  await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  const before = localStorage.getItem(TEST_KEY);

  await storage.init({ key: TEST_KEY });
  assertEqual(localStorage.getItem(TEST_KEY), before, '保存内容は変わらないはず');
  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v1`), null, '退避は作られないはず');
  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v2`), null, 'v2 の退避も作られないはず');
});

test('移行に失敗する壊れたデータは書き換えない', async () => {
  // rating が範囲外なので、移行しても検証に通らない
  const broken = JSON.stringify({
    schemaVersion: 1,
    habits: [{ id: 'h1', name: '読書', started_on: '2026-08-01', archived: false, order: 0 }],
    logs: [{
      id: 'l1', habit_id: 'h1', date: '2026-08-01', recorded_at: '2026-08-01T00:00:00.000Z',
      rating: 9, action: '', blocker: '', fix: '',
    }],
  });
  localStorage.removeItem(`${TEST_KEY}.backup.v1`);
  localStorage.setItem(TEST_KEY, broken);

  await assertThrows(() => storage.init({ key: TEST_KEY }), '検証に落ちる移行');
  assertEqual(localStorage.getItem(TEST_KEY), broken, '元データが書き換わってはいけない');
  localStorage.removeItem(`${TEST_KEY}.backup.v1`);
});

test('新しいバージョンのデータは触らない', async () => {
  const future = JSON.stringify({ schemaVersion: schema.SCHEMA_VERSION + 1, habits: [], logs: [] });
  localStorage.setItem(TEST_KEY, future);
  await assertThrows(() => storage.init({ key: TEST_KEY }), '未来の version');
  assertEqual(localStorage.getItem(TEST_KEY), future, '元データが書き換わってはいけない');
  localStorage.removeItem(TEST_KEY);
});

// --- v3: 記録項目とレベル -------------------------------------------------

// v2 のデータ。stage も metrics も values も無い。
function v2Data() {
  return {
    schemaVersion: 2,
    habits: [
      { id: 'h1', name: '読書', started_on: '2026-08-01', order: 0, ifThen: { trigger: '夕食後', action: '1ページ読む' } },
    ],
    logs: [
      {
        id: 'l1', habit_id: 'h1', date: '2026-08-01', recorded_at: '2026-08-01T00:00:00.000Z',
        rating: 2, action: '20ページ', blockerTags: ['疲労'], blockerNote: '', fix: '',
      },
    ],
  };
}

const COUNT = { id: 'm-count', label: 'トリガー回数', kind: 'number', unit: '回', active: true };
const WAKE = { id: 'm-wake', label: '起床時刻', kind: 'time', unit: '', active: true };

test('v2 のデータが v3 に移行され、元データは backup.v2 に残る', async () => {
  const raw = JSON.stringify(v2Data());
  await initWith(raw);
  const db = await storage.snapshot();

  assertEqual(db.schemaVersion, 3, 'schemaVersion');
  assertEqual(db.habits[0].stage, { label: '', goal: '' }, '空の stage が付く');
  assertEqual(db.habits[0].metrics, [], '空の metrics が付く');
  assertEqual(db.habits[0].ifThen, { trigger: '夕食後', action: '1ページ読む' }, 'ifThen はそのまま');
  assertEqual([db.logs[0].stage, db.logs[0].values], ['', {}], 'ログに空の stage と values が付く');
  assertEqual(db.logs[0].blockerTags, ['疲労'], 'タグはそのまま');
  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v2`), raw, '生のまま退避されるはず');
  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v1`), null, 'v1 の退避は作られない');
  localStorage.removeItem(`${TEST_KEY}.backup.v2`);
});

test('parseBackup は v2 のファイルを移行して受け入れる', async () => {
  const result = await storage.parseBackup(JSON.stringify(v2Data()));
  assertEqual(result.db.schemaVersion, schema.SCHEMA_VERSION, '現行に引き上がる');
  assertEqual(result.db.habits[0].metrics, [], 'metrics が付く');
  assertEqual(result.db.logs[0].values, {}, 'values が付く');
});

test('validateHabit は stage と metrics を検査する', () => {
  const ok = (overrides) => schema.validateHabit(makeHabit(overrides)).ok;

  assert(ok({ stage: { label: 'Lv1 決めるを消す', goal: '成功率7割以上' }, metrics: [COUNT, WAKE] }), '正しい習慣');
  assert(!ok({ stage: undefined }), 'stage が無い');
  assert(!ok({ stage: { label: 'あ'.repeat(41), goal: '' } }), 'label が長い');
  assert(!ok({ stage: { label: '', goal: 'あ'.repeat(121) } }), 'goal が長い');
  assert(!ok({ metrics: undefined }), 'metrics が無い');
  assert(!ok({ metrics: [COUNT, COUNT] }), '項目 id の重複');
  assert(!ok({ metrics: [{ ...COUNT, label: '' }] }), '空の項目名');
  assert(!ok({ metrics: [{ ...COUNT, label: 'あ'.repeat(21) }] }), '項目名が長い');
  assert(!ok({ metrics: [{ ...COUNT, kind: 'text' }] }), '知らない種類');
  assert(!ok({ metrics: [{ ...COUNT, unit: 'あ'.repeat(9) }] }), '単位が長い');
  assert(!ok({ metrics: [{ ...COUNT, active: 1 }] }), 'active が真偽値でない');
});

test('validateLog は values の形を検査する', () => {
  const ok = (values) => schema.validateLog(makeLog({ values })).ok;

  assert(ok({}), '空');
  assert(ok({ a: 0, b: 2.5, c: '06:30', d: '23:59' }), '数値と時刻');
  assert(!ok(undefined), 'values が無い');
  assert(!ok([]), '配列');
  assert(!ok({ a: -1 }), '負の数');
  assert(!ok({ a: NaN }), 'NaN');
  assert(!ok({ a: '3' }), '数字の文字列');
  assert(!ok({ a: '24:00' }), '存在しない時刻');
  assert(!ok({ a: '6:30' }), '桁の足りない時刻');
  assert(!schema.validateLog(makeLog({ stage: 'あ'.repeat(41) })).ok, 'stage が長い');
});

test('validateDB は values を習慣の記録項目と突き合わせる', () => {
  const db = (metrics, values) => ({
    schemaVersion: schema.SCHEMA_VERSION,
    habits: [makeHabit({ metrics })],
    logs: [makeLog({ values })],
  });

  assert(schema.validateDB(db([COUNT, WAKE], { 'm-count': 3, 'm-wake': '06:30' })).ok, '正しい組み合わせ');
  assert(schema.validateDB(db([{ ...COUNT, active: false }], { 'm-count': 3 })).ok, '使用終了の項目の値は残せる');
  assert(!schema.validateDB(db([], { 'm-count': 3 })).ok, '習慣に無い項目');
  assert(!schema.validateDB(db([COUNT], { 'm-count': '06:30' })).ok, '数値の項目に時刻');
  assert(!schema.validateDB(db([WAKE], { 'm-wake': 6 })).ok, '時刻の項目に数値');
});

test('addHabit と updateHabit は stage と metrics を受け取り、id を振る', async () => {
  await freshStore();
  const habit = await storage.addHabit({
    name: '3秒着手',
    started_on: '2026-08-01',
    stage: { label: ' Lv1 決めるを消す ', goal: '成功率7割以上' },
    metrics: [{ label: ' トリガー回数 ', kind: 'number', unit: '回' }],
  });
  assertEqual(habit.stage, { label: 'Lv1 決めるを消す', goal: '成功率7割以上' }, 'stage は trim される');
  assertEqual(habit.metrics.length, 1, '項目数');
  assert(typeof habit.metrics[0].id === 'string' && habit.metrics[0].id !== '', 'id が振られる');
  assertEqual(
    [habit.metrics[0].label, habit.metrics[0].unit, habit.metrics[0].active],
    ['トリガー回数', '回', true],
    '項目の中身',
  );

  const plain = await storage.addHabit({ name: '読書', started_on: '2026-08-01' });
  assertEqual([plain.stage, plain.metrics], [{ label: '', goal: '' }, []], '省略時は空');

  const updated = await storage.updateHabit(habit.id, {
    stage: { label: 'Lv2', goal: '' },
    metrics: [...habit.metrics, { label: '起床時刻', kind: 'time', unit: '分' }],
  });
  assertEqual(updated.stage.label, 'Lv2', 'stage を更新できる');
  assertEqual(updated.metrics[0].id, habit.metrics[0].id, '既存の id は変わらない');
  assertEqual(updated.metrics[1].unit, '', '時刻は単位を持たない');
});

test('putLog は values を保存し、省略時は既存の値を引き継ぐ', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '3秒着手', started_on: '2026-08-01', metrics: [COUNT, WAKE] });
  const base = { habit_id: habit.id, date: '2026-08-01' };

  const first = await storage.putLog({ ...base, rating: 2, values: { 'm-count': 5, 'm-wake': '06:30' } });
  assertEqual(first.values, { 'm-count': 5, 'm-wake': '06:30' }, '保存される');

  const rerated = await storage.putLog({ ...base, rating: 1 });
  assertEqual(rerated.values, { 'm-count': 5, 'm-wake': '06:30' }, '省略時は引き継ぐ');

  const cleared = await storage.putLog({ ...base, rating: 1, values: {} });
  assertEqual(cleared.values, {}, '{} で消せる');

  const fresh = await storage.putLog({ habit_id: habit.id, date: '2026-08-02', rating: 2 });
  assertEqual(fresh.values, {}, '新規で省略すると空');
});

test('putLog は習慣に無い項目と種類違いの値を拒否する', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '3秒着手', started_on: '2026-08-01', metrics: [COUNT, WAKE] });
  const base = { habit_id: habit.id, date: '2026-08-01', rating: 2 };

  await assertThrows(() => storage.putLog({ ...base, values: { missing: 1 } }), '習慣に無い項目');
  await assertThrows(() => storage.putLog({ ...base, values: { 'm-count': '06:30' } }), '数値の項目に時刻');
  await assertThrows(() => storage.putLog({ ...base, values: { 'm-wake': 6 } }), '時刻の項目に数値');
  await assertThrows(() => storage.putLog({ ...base, values: { 'm-count': -1 } }), '負の数');
  assertEqual(await storage.getLog(habit.id, '2026-08-01'), null, '保存されていないはず');
});

test('ログの stage は最初に作った時点のレベル名で、書き直しても変わらない', async () => {
  await freshStore();
  const habit = await storage.addHabit({
    name: '瞑想力', started_on: '2026-08-01', stage: { label: 'Lv1', goal: '' },
  });
  const first = await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: 2 });
  assertEqual(first.stage, 'Lv1', '作成時のレベル名');

  await storage.updateHabit(habit.id, { stage: { label: 'Lv2', goal: '' } });
  const rewritten = await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: 1 });
  assertEqual(rewritten.stage, 'Lv1', '書き直しでは変わらない');

  const next = await storage.putLog({ habit_id: habit.id, date: '2026-08-02', rating: 2 });
  assertEqual(next.stage, 'Lv2', '新しい日は今のレベル名');
});

test('値のある記録項目は削除も種類変更もできず、使用終了にはできる', async () => {
  await freshStore();
  const unused = { id: 'm-unused', label: '使っていない', kind: 'number', unit: '', active: true };
  const habit = await storage.addHabit({ name: '3秒着手', started_on: '2026-08-01', metrics: [COUNT, unused] });
  await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: 2, values: { 'm-count': 5 } });

  await assertThrows(() => storage.updateHabit(habit.id, { metrics: [unused] }), '値のある項目の削除');
  await assertThrows(
    () => storage.updateHabit(habit.id, { metrics: [{ ...COUNT, kind: 'time' }, unused] }),
    '値のある項目の種類変更',
  );
  assertEqual((await storage.getHabit(habit.id)).metrics.length, 2, '失敗したら変わらない');

  const retired = await storage.updateHabit(habit.id, { metrics: [{ ...COUNT, active: false }] });
  assertEqual(retired.metrics, [{ ...COUNT, active: false }], '使用終了にでき、値の無い項目は消せる');
  assertEqual((await storage.getLog(habit.id, '2026-08-01')).values, { 'm-count': 5 }, '過去の値は残る');
});

// --- weekMode / cumulativeDays / blockerRanking -------------------------

// 仕様のテスト表は「週の1日目を D1」とする。暦週なので D1 は月曜に置く。
const D1 = '2026-09-28'; // 月曜

function weekDay(n) {
  return dates.addDays(D1, n - 1);
}

// 月曜から順に ○△×_ を並べてログにする。
function weekLogs(pattern, offset = 0) {
  const logs = [];
  [...pattern].forEach((mark, index) => {
    if (mark === '_') return;
    logs.push(makeLog({ id: `w${offset}${index}`, date: dates.addDays(D1, offset + index), rating: MARKS[mark] }));
  });
  return logs;
}

test('週モード 観点1: ○○○○ は通常モード', () => {
  const result = stats.weekMode(weekLogs('○○○○'), { started_on: D1, today: weekDay(4) });
  assertEqual(result, { isWeekMode: false, weekCount: 4 }, '切断なし');
  assertEqual(stats.currentStreak(weekLogs('○○○○'), { started_on: D1, today: weekDay(4) }), 4, '連続4');
});

test('週モード 観点2: ○×○○ は週モードで 3/7、連続 2', () => {
  const logs = weekLogs('○×○○');
  assertEqual(stats.weekMode(logs, { started_on: D1, today: weekDay(4) }), { isWeekMode: true, weekCount: 3 }, '週モード');
  assertEqual(stats.currentStreak(logs, { started_on: D1, today: weekDay(4) }), 2, '連続2を併記');
});

test('週モード 観点3: ○ 未記録 △ で当日未記録なら 2/7、連続 1', () => {
  const logs = weekLogs('○_△');
  assertEqual(stats.weekMode(logs, { started_on: D1, today: weekDay(4) }), { isWeekMode: true, weekCount: 2 }, '週モード');
  assertEqual(stats.currentStreak(logs, { started_on: D1, today: weekDay(4) }), 1, '連続1を併記');
});

test('週モード 観点4: 前週の切断は持ち越さない', () => {
  // 前週の日曜に ×、今週は月火水が ○
  const logs = [
    makeLog({ id: 'prev', date: dates.addDays(D1, -1), rating: schema.RATING.SKIP }),
    ...weekLogs('○○○'),
  ];
  const started = dates.addDays(D1, -7);
  assertEqual(stats.weekMode(logs, { started_on: started, today: weekDay(3) }), { isWeekMode: false, weekCount: 3 }, '通常モード');
  assertEqual(stats.currentStreak(logs, { started_on: started, today: weekDay(3) }), 3, '連続3');
});

test('当日の未記録は切断にせず、当日の × は切断にする', () => {
  const none = weekLogs('○○');
  assertEqual(stats.weekMode(none, { started_on: D1, today: weekDay(3) }).isWeekMode, false, '当日未記録');

  const skipped = weekLogs('○○×');
  assertEqual(stats.weekMode(skipped, { started_on: D1, today: weekDay(3) }).isWeekMode, true, '当日 ×');
});

test('週モードは開始前の日を切断に数えない', () => {
  // 水曜に始めて、水木が ○。月火は開始前なので切断ではない。
  const logs = weekLogs('○○', 2);
  const started = weekDay(3);
  assertEqual(stats.weekMode(logs, { started_on: started, today: weekDay(4) }), { isWeekMode: false, weekCount: 2 }, '開始前は無視');
});

test('cumulativeDays は ○ と △ の総数を数える', () => {
  const logs = weekLogs('○△×_○');
  assertEqual(stats.cumulativeDays(logs, { started_on: D1, today: weekDay(5) }), 3, '○2 と △1');
  assertEqual(stats.cumulativeDays([], { started_on: D1, today: weekDay(5) }), 0, 'ログ無し');
});

test('cumulativeDays は範囲外を数えない', () => {
  const before = makeLog({ id: 'b', date: dates.addDays(D1, -1), rating: schema.RATING.DONE });
  const future = makeLog({ id: 'f', date: weekDay(10), rating: schema.RATING.DONE });
  const logs = [before, ...weekLogs('○○'), future];
  assertEqual(stats.cumulativeDays(logs, { started_on: D1, today: weekDay(2) }), 2, '開始前と未来を除く');
});

test('blockerRanking は回数の降順、同数はタグ名順', () => {
  const logs = [
    makeLog({ id: '1', date: weekDay(1), blockerTags: ['疲労', 'SNS'] }),
    makeLog({ id: '2', date: weekDay(2), blockerTags: ['疲労'] }),
    makeLog({ id: '3', date: weekDay(3), blockerTags: ['疲労', 'SNS', 'AAA'] }),
  ];
  assertEqual(
    stats.blockerRanking(logs, weekDay(1), weekDay(3)),
    [{ tag: '疲労', count: 3 }, { tag: 'SNS', count: 2 }, { tag: 'AAA', count: 1 }],
    '並び順',
  );
});

test('blockerRanking は範囲外とタグ無しを除く', () => {
  const logs = [
    makeLog({ id: '1', date: weekDay(1), blockerTags: ['疲労'] }),
    makeLog({ id: '2', date: weekDay(9), blockerTags: ['範囲外'] }),
    makeLog({ id: '3', date: weekDay(2) }),
  ];
  assertEqual(stats.blockerRanking(logs, weekDay(1), weekDay(3)), [{ tag: '疲労', count: 1 }], '範囲内のみ');
  assertEqual(stats.blockerRanking([], weekDay(1), weekDay(3)), [], 'ログ無し');
});

test('computeStats はカードに必要な値をまとめて返す', () => {
  const logs = weekLogs('○×○');
  const result = stats.computeStats(logs, { started_on: D1, today: weekDay(3) });
  assertEqual(
    [result.streak, result.comebacks, result.cumulative, result.isWeekMode, result.weekCount],
    [1, 1, 2, true, 2],
    '[連続, 復帰, 累計, 週モード, 今週]',
  );
});

// --- metricSummary（記録項目の集計） -------------------------------------

test('metricSummary は 7 日分の値と合計・平均・記録日数を返す', () => {
  const habit = makeHabit({ metrics: [COUNT] });
  const logs = [
    makeLog({ id: '1', date: weekDay(1), values: { 'm-count': 4 } }),
    makeLog({ id: '2', date: weekDay(2), values: { 'm-count': 0 } }),
    makeLog({ id: '3', date: weekDay(4), values: { 'm-count': 5 } }),
    makeLog({ id: '4', date: weekDay(5) }),
  ];
  assertEqual(
    stats.metricSummary(habit, logs, weekDay(1), weekDay(7)),
    [{ metric: COUNT, days: [4, 0, null, 5, null, null, null], sum: 9, average: 3, count: 3 }],
    '集計',
  );
});

test('metricSummary の平均は記録した日だけで割り、0 も 1 日として数える', () => {
  const habit = makeHabit({ metrics: [COUNT] });
  const logs = [
    makeLog({ id: '1', date: weekDay(1), values: { 'm-count': 0 } }),
    makeLog({ id: '2', date: weekDay(2), values: { 'm-count': 1 } }),
  ];
  const [summary] = stats.metricSummary(habit, logs, weekDay(1), weekDay(7));
  assertEqual([summary.sum, summary.average, summary.count], [1, 0.5, 2], '0 の日も記録日');
});

test('metricSummary は時刻の項目で合計と平均を出さない', () => {
  const habit = makeHabit({ metrics: [WAKE] });
  const logs = [
    makeLog({ id: '1', date: weekDay(1), values: { 'm-wake': '06:30' } }),
    makeLog({ id: '2', date: weekDay(3), values: { 'm-wake': '07:10' } }),
  ];
  assertEqual(
    stats.metricSummary(habit, logs, weekDay(1), weekDay(7)),
    [{ metric: WAKE, days: ['06:30', null, '07:10', null, null, null, null], sum: null, average: null, count: 2 }],
    '時刻',
  );
});

test('metricSummary は値の無い週も使用中の項目を出す', () => {
  const habit = makeHabit({ metrics: [COUNT, WAKE] });
  const result = stats.metricSummary(habit, [], weekDay(1), weekDay(7));
  assertEqual(result.map((s) => s.metric.id), ['m-count', 'm-wake'], 'habit.metrics の順');
  assertEqual(
    [result[0].days, result[0].sum, result[0].average, result[0].count],
    [[null, null, null, null, null, null, null], 0, null, 0],
    '空の数値項目',
  );
});

test('metricSummary は使用終了の項目を、その期間に値があるときだけ出す', () => {
  const retired = { ...COUNT, active: false };
  const habit = makeHabit({ metrics: [retired, WAKE] });
  const logs = [makeLog({ id: '1', date: weekDay(1), values: { 'm-count': 2 } })];

  assertEqual(
    stats.metricSummary(habit, logs, weekDay(1), weekDay(7)).map((s) => s.metric.id),
    ['m-count', 'm-wake'],
    '値のある週は出す',
  );
  assertEqual(
    stats.metricSummary(habit, logs, weekDay(8), weekDay(14)).map((s) => s.metric.id),
    ['m-wake'],
    '値の無い週は出さない',
  );
});

test('metricSummary は範囲外を除き、rating を見ず、小数の誤差を残さない', () => {
  const habit = makeHabit({ metrics: [COUNT] });
  const logs = [
    makeLog({ id: '0', date: weekDay(0), values: { 'm-count': 100 } }),
    makeLog({ id: '1', date: weekDay(1), rating: schema.RATING.SKIP, values: { 'm-count': 0.1 } }),
    makeLog({ id: '2', date: weekDay(2), values: { 'm-count': 0.2 } }),
    makeLog({ id: '8', date: weekDay(8), values: { 'm-count': 100 } }),
  ];
  const [summary] = stats.metricSummary(habit, logs, weekDay(1), weekDay(7));
  assertEqual([summary.sum, summary.average, summary.count], [0.3, 0.15, 2], '× の日も数え、誤差なし');
});

test('metricSummary は記録項目の無い習慣で空を返し、不正な期間を拒否する', async () => {
  assertEqual(stats.metricSummary(makeHabit(), [], weekDay(1), weekDay(7)), [], '項目なし');
  await assertThrows(() => stats.metricSummary(makeHabit(), [], 'x', weekDay(7)), '不正な from');
});

// --- report（値と集計の書き方） -----------------------------------------

test('formatMetricValue は未入力と 0 を書き分け、小数を 2 桁に丸める', () => {
  assertEqual(
    [null, 0, 5, 3.5, 3.6666667, 125.5, '06:30'].map(report.formatMetricValue),
    ['–', '0', '5', '3.5', '3.67', '125.5', '06:30'],
    '値の表記',
  );
});

test('formatMetricName は単位があるときだけ括弧で添える', () => {
  assertEqual(report.formatMetricName(COUNT), 'トリガー回数（回）', '単位あり');
  assertEqual(report.formatMetricName(WAKE), '起床時刻', '単位なし');
});

test('formatMetricTotals は数値で合計・平均・記録日数、時刻と空では記録日数だけ', () => {
  assertEqual(
    report.formatMetricTotals({ metric: COUNT, sum: 22, average: 3.6666667, count: 6 }),
    '合計 22回・平均 3.67回・記録 6日',
    '数値',
  );
  assertEqual(
    report.formatMetricTotals({ metric: { ...COUNT, unit: '' }, sum: 9, average: 3, count: 3 }),
    '合計 9・平均 3・記録 3日',
    '単位なし',
  );
  assertEqual(report.formatMetricTotals({ metric: WAKE, sum: null, average: null, count: 2 }), '記録 2日', '時刻');
  assertEqual(report.formatMetricTotals({ metric: COUNT, sum: 0, average: null, count: 0 }), '記録 0日', '値なし');
});

// --- weeks（カレンダー週） ----------------------------------------------

// 2026-08-01 は土曜。その週の月曜は 2026-07-27。
const SAT = '2026-08-01';
const MON = '2026-07-27';
const SUN = '2026-08-02';

test('startOfWeek は月曜を返す', () => {
  assertEqual(dates.startOfWeek(MON), MON, '月曜はそのまま');
  assertEqual(dates.startOfWeek(SAT), MON, '土曜');
  assertEqual(dates.startOfWeek(SUN), MON, '日曜は同じ週の末日');
  assertEqual(dates.startOfWeek('2026-08-03'), '2026-08-03', '翌月曜から次の週');
  assertEqual(dates.startOfWeek('2026-01-01'), '2025-12-29', '年をまたぐ');
});

test('listWeekStarts は重なる週の月曜を古い順に返す', () => {
  assertEqual(weeks.listWeekStarts(SAT, SAT), [MON], '同じ日');
  assertEqual(weeks.listWeekStarts(SAT, '2026-08-03'), [MON, '2026-08-03'], '週をまたぐ');
  assertEqual(
    weeks.listWeekStarts(MON, '2026-08-16'),
    [MON, '2026-08-03', '2026-08-10'],
    '3 週',
  );
  assertEqual(weeks.listWeekStarts('2026-08-10', SAT), [], 'to が from より前');
});

test('週は月曜始まりで必ず 7 日分の枠を持つ', () => {
  const week = weeks.buildWeek([], { weekStart: SAT, started_on: SAT, today: '2026-08-20' });
  assertEqual([week.start, week.end], [MON, SUN], '月曜から日曜');
  assertEqual(week.days.length, 7, '枠の数');
  assertEqual(
    week.days.map((d) => d.date),
    [MON, '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', SAT, SUN],
    '日付が連続する',
  );
});

test('開始前の日には beforeStart、まだ来ていない日には future が付く', () => {
  // 土曜に始めて、その週の金曜（＝翌週ではなく同じ週）はまだ来ていない…ではなく、
  // today を 2026-07-31（金）にすると、土日が未来・月〜木が開始前になる。
  const week = weeks.buildWeek([], { weekStart: MON, started_on: SAT, today: '2026-07-31' });
  assertEqual(
    week.days.map((d) => d.beforeStart),
    [true, true, true, true, true, false, false],
    '開始日より前だけ true',
  );
  assertEqual(
    week.days.map((d) => d.future),
    [false, false, false, false, false, true, true],
    'today より後だけ true',
  );
});

test('未記入の日は log が null になり、× とは区別される', () => {
  const logs = [
    makeLog({ id: 'a', date: SAT, rating: schema.RATING.DONE }),
    makeLog({ id: 'b', date: SUN, rating: schema.RATING.SKIP }),
  ];
  const week = weeks.buildWeek(logs, { weekStart: MON, started_on: MON, today: SUN });
  assertEqual(week.days[4].log, null, '金曜は未記入');
  assertEqual(week.days[5].log.rating, schema.RATING.DONE, '土曜は ○');
  assertEqual(week.days[6].log.rating, schema.RATING.SKIP, '日曜は ×');
});

test('buildWeeks は開始日の週から今日の週まで並べ、空の週も飛ばさない', () => {
  const logs = [
    makeLog({ id: 'a', date: SAT, rating: schema.RATING.DONE }),
    makeLog({ id: 'b', date: '2026-08-12', rating: schema.RATING.DONE }),
  ];
  const list = weeks.buildWeeks(logs, { started_on: SAT, today: '2026-08-12' });

  assertEqual(list.map((w) => w.start), [MON, '2026-08-03', '2026-08-10'], '3 週');
  assertEqual(list[1].days.filter((d) => d.log !== null).length, 0, '真ん中の週は空');
  assertEqual(list[1].days.length, 7, '空の週も 7 枠');
});

test('ログの並び順が日付順でなくても正しい日に入る', () => {
  const logs = [
    makeLog({ id: 'b', date: SUN, rating: schema.RATING.PARTIAL }),
    makeLog({ id: 'a', date: SAT, rating: schema.RATING.DONE }),
  ];
  const week = weeks.buildWeek(logs, { weekStart: MON, started_on: MON, today: SUN });
  assertEqual(week.days.map((d) => d.log?.rating ?? null), [null, null, null, null, null, 2, 1], '並び');
});

test('today が started_on より前なら週は無い', () => {
  assertEqual(weeks.buildWeeks([], { started_on: SAT, today: MON }), [], '空配列になるはず');
});

test('週まとめは不正な引数を例外にする', async () => {
  await assertThrows(() => dates.startOfWeek('2026-02-30'), '不正な日付');
  await assertThrows(() => weeks.listWeekStarts('2026-02-30', SAT), '不正な from');
  await assertThrows(() => weeks.buildWeek([], { weekStart: SAT, started_on: 'x', today: SAT }), '不正な started_on');
});

test('cardMode は週モードを優先し、66 日で達成に切り替わる', () => {
  assertEqual(stats.cardMode({ isWeekMode: false, cumulative: 0 }), 'streak', '通常');
  assertEqual(stats.cardMode({ isWeekMode: true, cumulative: 0 }), 'week', '週モード');
  assertEqual(stats.cardMode({ isWeekMode: false, cumulative: 65 }), 'streak', '65 日はまだ通常');
  assertEqual(stats.cardMode({ isWeekMode: false, cumulative: 66 }), 'done', '66 日で達成');
  assertEqual(stats.cardMode({ isWeekMode: false, cumulative: 80 }), 'done', '超えても達成');
  // 達成していても連続が切れた週は立て直しのほうを出す。
  assertEqual(stats.cardMode({ isWeekMode: true, cumulative: 80 }), 'week', '週モードが優先');
});

test('tagUsage は期間で絞らず、回数の降順・同数はタグ名順に返す', () => {
  const logs = [
    makeLog({ id: 'a', date: '2026-07-01', blockerTags: ['疲労', 'SNS'] }),
    makeLog({ id: 'b', date: '2026-08-15', blockerTags: ['疲労'] }),
    makeLog({ id: 'c', date: '2026-09-30', blockerTags: ['課題', 'SNS'] }),
    makeLog({ id: 'd', date: '2026-10-01' }), // タグ無し
  ];
  assertEqual(
    stats.tagUsage(logs),
    [{ tag: 'SNS', count: 2 }, { tag: '疲労', count: 2 }, { tag: '課題', count: 1 }],
    '全期間の集計',
  );
  assertEqual(stats.tagUsage([]), [], 'ログが無ければ空');
});

test('formatMonthDayWeekday は括弧付きの曜日を出す', () => {
  assertEqual(dates.formatMonthDayWeekday('2026-10-01'), '10月1日（木）', '木曜');
  assertEqual(dates.formatMonthDayWeekday('2026-09-28'), '9月28日（月）', '月曜');
});

test('formatLongDate は曜日まで出す', () => {
  assertEqual(dates.formatLongDate('2026-10-01'), '10月1日 木曜日', '木曜');
  assertEqual(dates.formatLongDate('2026-09-28'), '9月28日 月曜日', '月曜');
});

test('formatIfThen は両方空のときだけ何も返さない', () => {
  assertEqual(formatIfThen({ trigger: '夕食後', action: '1問解く' }), { trigger: '夕食後', action: '1問解く' }, '両方');
  assertEqual(formatIfThen({ trigger: '夕食後', action: '' }), { trigger: '夕食後', action: '' }, 'きっかけだけ');
  assertEqual(formatIfThen({ trigger: '', action: '1問解く' }), { trigger: '', action: '1問解く' }, '行動だけ');
  assertEqual(formatIfThen({ trigger: '', action: '' }), null, '両方空');
  assertEqual(formatIfThen({ trigger: '  ', action: '　' }), null, '空白だけ');
  assertEqual(formatIfThen(undefined), null, '未指定');
  assertEqual(formatIfThen({ trigger: '  夕食後  ', action: ' 解く ' }), { trigger: '夕食後', action: '解く' }, 'trim される');
});

// --- インポート（全置換） -----------------------------------------------

test('parseBackup は現行スキーマのファイルを受け入れる', async () => {
  const result = await storage.parseBackup(JSON.stringify(sampleBackup()));
  assertEqual([result.habits, result.logs], [1, 2], '件数');
  assertEqual(result.db.schemaVersion, schema.SCHEMA_VERSION, 'schemaVersion');
});

test('parseBackup は v1 のファイルを移行して受け入れる', async () => {
  const result = await storage.parseBackup(JSON.stringify(v1Data()));
  assertEqual([result.habits, result.logs], [2, 1], '件数');
  assertEqual(result.db.schemaVersion, schema.SCHEMA_VERSION, '現行に引き上がる');
  assertEqual(result.db.logs[0].blockerNote, '寝落ち', 'blocker が移る');
  assert(result.db.habits.every((h) => !('archived' in h)), 'archived は落ちる');
});

test('parseBackup は読めないファイルを拒否する', async () => {
  await assertThrows(() => storage.parseBackup('{ 壊れた'), '壊れた JSON');
  await assertThrows(() => storage.parseBackup('[]'), '配列');
  await assertThrows(
    () => storage.parseBackup(JSON.stringify({ schemaVersion: schema.SCHEMA_VERSION, habits: [{ id: 'h1' }], logs: [] })),
    '検証に落ちる中身',
  );
  await assertThrows(
    () => storage.parseBackup(JSON.stringify({ schemaVersion: 99, habits: [], logs: [] })),
    '新しいバージョン',
  );
});

test('replaceAll は全置換し、置き換える前を退避する', async () => {
  await freshStore();
  const habit = await storage.addHabit({ name: '消える習慣', started_on: '2026-08-01' });
  await storage.putLog({ habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE });

  const { db, habits, logs } = await storage.parseBackup(JSON.stringify(sampleBackup()));
  const result = await storage.replaceAll(db);

  assertEqual(result, { habits, logs }, '戻り値の件数');
  assertEqual((await storage.getHabits()).map((h) => h.name), ['読書'], '中身が入れ替わる');
  assertEqual(await storage.getCounts(), { habits: 1, logs: 2 }, '件数');

  const saved = JSON.parse(localStorage.getItem(`${TEST_KEY}.backup.import`));
  assertEqual(saved.habits.map((h) => h.name), ['消える習慣'], '置き換える前が退避されている');
});

test('replaceAll は不正な内容で保存を変えない', async () => {
  await freshStore();
  await storage.addHabit({ name: '残る習慣', started_on: '2026-08-01' });
  const before = localStorage.getItem(TEST_KEY);

  await assertThrows(() => storage.replaceAll({ schemaVersion: schema.SCHEMA_VERSION, habits: [{ id: 'x' }], logs: [] }), '不正な中身');
  assertEqual(localStorage.getItem(TEST_KEY), before, '保存が変わってはいけない');
});

test('replaceAll は渡した入れ物を内部状態にしない', async () => {
  await freshStore();
  const { db } = await storage.parseBackup(JSON.stringify(sampleBackup()));
  await storage.replaceAll(db);

  db.habits[0].name = '書き換え';
  assertEqual((await storage.getHabits())[0].name, '読書', '呼び出し側の書き換えが漏れてはいけない');
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

// v3 の項目（レベル・記録項目・値）を持つ保存データを作る。
async function storeWithMetrics() {
  await freshStore();
  const habit = await storage.addHabit({
    name: '超体力',
    started_on: '2026-08-01',
    stage: { label: 'Lv4 起床時刻の固定', goal: '7日中5日、±30分以内' },
    metrics: [COUNT, WAKE, { id: 'm-old', label: '昔の項目', kind: 'number', unit: '', active: false }],
  });
  await storage.putLog({
    habit_id: habit.id, date: '2026-08-01', rating: schema.RATING.DONE,
    values: { 'm-count': 2.5, 'm-wake': '06:30', 'm-old': 0 },
  });
  await storage.putLog({ habit_id: habit.id, date: '2026-08-02', rating: schema.RATING.SKIP });
  return habit;
}

test('書き出した JSON は schemaVersion 3 で、レベル・記録項目・値を含む', async () => {
  const habit = await storeWithMetrics();
  const parsed = JSON.parse(backup.serializeBackup(await storage.snapshot()));

  assertEqual(parsed.schemaVersion, 3, 'schemaVersion');
  assertEqual(parsed.habits[0].stage, habit.stage, 'stage');
  assertEqual(parsed.habits[0].metrics, habit.metrics, 'metrics（使用終了の項目も含む）');
  assertEqual(parsed.logs[0].stage, 'Lv4 起床時刻の固定', 'ログのレベル名');
  assertEqual(parsed.logs[0].values, { 'm-count': 2.5, 'm-wake': '06:30', 'm-old': 0 }, 'values');
  assertEqual(parsed.logs[1].values, {}, '値の無いログは空の values');
});

test('書き出したファイルを読み込むと、記録項目と値がそのまま戻る', async () => {
  await storeWithMetrics();
  const before = await storage.snapshot();
  const text = backup.serializeBackup(before);

  // 別の中身に入れ替えてから読み戻す
  await freshStore();
  await storage.addHabit({ name: '消える習慣', started_on: '2026-08-01' });

  const incoming = await storage.parseBackup(text);
  assertEqual([incoming.habits, incoming.logs], [1, 2], '件数');
  await storage.replaceAll(incoming.db);

  assertEqual(await storage.snapshot(), before, '書き出す前と同じ内容に戻る');

  // 読み戻したあとも、記録項目つきの保存が通る
  const [habit] = await storage.getHabits();
  const log = await storage.putLog({
    habit_id: habit.id, date: '2026-08-03', rating: schema.RATING.DONE, values: { 'm-count': 1 },
  });
  assertEqual(log.values, { 'm-count': 1 }, '読み戻した項目に値を付けられる');
});

test('parseBackup は記録項目と合わない値を持つファイルを拒否する', async () => {
  await storeWithMetrics();
  const data = await storage.snapshot();
  const broken = (edit) => {
    const copy = structuredClone(data);
    edit(copy);
    return JSON.stringify(copy);
  };

  await assertThrows(
    () => storage.parseBackup(broken((db) => { db.habits[0].metrics = []; })),
    '項目を消して値だけ残したファイル',
  );
  await assertThrows(
    () => storage.parseBackup(broken((db) => { db.logs[0].values['m-wake'] = 630; })),
    '時刻の項目に数値',
  );
  await assertThrows(
    () => storage.parseBackup(broken((db) => { db.habits[0].metrics[0].kind = 'text'; })),
    '知らない種類の項目',
  );
  await assertThrows(
    () => storage.parseBackup(broken((db) => { delete db.logs[0].values; })),
    'v3 なのに values が無い',
  );
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

run().catch((error) => {
  const summary = document.getElementById('summary');
  summary.className = 'fail';
  summary.textContent = `テストの実行自体が失敗しました: ${error.message}`;
});
