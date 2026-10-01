// 保存・読み出し。localStorage を知っているのはこのモジュールだけ。
//
// 全データを 1 つのキーに JSON 1 塊で持つ。1 回の setItem で常に整合の取れた状態に
// なるため、「habits だけ書けて logs が書けない」という壊れ方をしない。
// この形はエクスポートする JSON の形とも一致する。
//
// 公開関数はすべて Promise を返す。localStorage 自体は同期だが、後で IndexedDB に
// 差し替えたときに呼び出し側を書き直さずに済むようにしてある。

import {
  SCHEMA_VERSION,
  createDB,
  createHabit,
  createLog,
  migrateDB,
  normalizeIfThen,
  validateHabit,
  validateLog,
  validateDB,
} from './schema.js';

const DEFAULT_STORAGE_KEY = 'habitTracker.v1';
const PATCHABLE_HABIT_FIELDS = ['name', 'started_on', 'order', 'ifThen'];

let storageKey = DEFAULT_STORAGE_KEY;
let db = null; // メモリ上の唯一の正。commit() 以外から書き換えない。

export class StorageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StorageError';
  }
}

// 起動時に一度だけ呼ぶ。key はテスト用に別の保存領域を使うためのもので、
// アプリ本体は既定のキーをそのまま使う。
export async function init({ key = DEFAULT_STORAGE_KEY } = {}) {
  storageKey = key;
  db = null;

  const raw = readRaw();
  if (raw === null) {
    const empty = createDB();
    writeRaw(JSON.stringify(empty));
    db = empty;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new StorageError(
      '保存データを JSON として読めませんでした。上書きを避けるためここで中断します。',
      { cause },
    );
  }

  // schemaVersion が整数でなければ、v1（この項目が無かった頃）とみなす。
  const version = Number.isInteger(parsed?.schemaVersion) ? parsed.schemaVersion : 1;
  if (version > SCHEMA_VERSION) {
    throw new StorageError(
      `保存データが新しい形式です（version ${version}）。`
      + 'このまま読み書きすると壊すので中断します。アプリを最新にしてください。',
    );
  }

  const needsMigration = version < SCHEMA_VERSION;
  if (needsMigration) {
    backupOnce(raw, version);
    parsed = migrateDB(parsed);
  }

  const { ok, errors } = validateDB(parsed);
  if (!ok) {
    throw new StorageError(
      `保存データの検証に失敗しました。上書きを避けるためここで中断します。\n${errors.join('\n')}`,
    );
  }

  // 書き込むのは検証を通ったあとだけ。
  if (needsMigration) writeRaw(JSON.stringify(parsed));
  db = parsed;
}

// 移行前のデータをそのまま別キーへ退避する。二度目以降は上書きしない。
// 退避を上書きすると、移行後に壊れていたときの戻り先が消える。
function backupOnce(raw, version) {
  const key = `${storageKey}.backup.v${version}`;
  try {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
  } catch (cause) {
    throw new StorageError('移行前のデータを退避できませんでした。移行を中断します。', { cause });
  }
}

// --- 習慣 -------------------------------------------------------------

export async function getHabits() {
  const state = requireInit();
  const habits = [...state.habits].sort((a, b) => a.order - b.order);
  return clone(habits);
}

export async function getHabit(id) {
  const state = requireInit();
  const habit = state.habits.find((candidate) => candidate.id === id);
  return habit ? clone(habit) : null;
}

export async function addHabit({ name, started_on, ifThen }) {
  const state = requireInit();
  const habit = createHabit({ name, started_on, ifThen, order: nextOrder(state.habits) });
  assertValid(validateHabit(habit), '習慣');
  commit({ ...state, habits: [...state.habits, habit] });
  return clone(habit);
}

export async function updateHabit(id, patch) {
  const state = requireInit();
  const current = findHabit(state, id);

  if (!isPlainObject(patch)) {
    throw new StorageError('patch にはオブジェクトを渡してください。');
  }
  const unknown = Object.keys(patch).filter((key) => !PATCHABLE_HABIT_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new StorageError(
      `更新できないフィールドです: ${unknown.join(', ')}（更新できるのは ${PATCHABLE_HABIT_FIELDS.join(', ')}）`,
    );
  }

  const updated = { ...current, ...patch };
  if (typeof updated.name === 'string') updated.name = updated.name.trim();
  if ('ifThen' in patch) updated.ifThen = normalizeIfThen(patch.ifThen);
  assertValid(validateHabit(updated), '習慣');
  commit({ ...state, habits: replaceHabit(state.habits, updated) });
  return clone(updated);
}

// 習慣を消すと、その習慣のログもまとめて消える。
// 存在しない習慣を指すログが残らないようにするため。
export async function deleteHabit(id) {
  const state = requireInit();
  if (!state.habits.some((habit) => habit.id === id)) return false;
  commit({
    ...state,
    habits: state.habits.filter((habit) => habit.id !== id),
    logs: state.logs.filter((log) => log.habit_id !== id),
  });
  return true;
}

// --- ログ -------------------------------------------------------------

export async function getLog(habit_id, date) {
  const state = requireInit();
  const log = state.logs.find((candidate) => candidate.habit_id === habit_id && candidate.date === date);
  return log ? clone(log) : null;
}

export async function getLogs(habit_id) {
  const state = requireInit();
  const logs = state.logs.filter((log) => log.habit_id === habit_id).sort(byDate);
  return clone(logs);
}

// from と to はどちらも含む。'YYYY-MM-DD' は辞書順が日付順なので文字列のまま比較できる。
export async function getLogsInRange(habit_id, from, to) {
  const state = requireInit();
  const logs = state.logs
    .filter((log) => log.habit_id === habit_id && log.date >= from && log.date <= to)
    .sort(byDate);
  return clone(logs);
}

// (habit_id, date) は一意なので、同じ日を書き直したときは 2 件目を作らず既存を更新する。
// id は据え置き。recorded_at は達成度が変わったときだけ更新する（下のコメントを参照）。
//
// started_on より前の日付や未来の日付も受け付ける。判定ロジック側が started_on 以前を
// 対象外として扱うため、ここで弾く必要がない。
export async function putLog({ habit_id, date, rating, action, blockerTags, blockerNote, fix }) {
  const state = requireInit();
  if (!state.habits.some((habit) => habit.id === habit_id)) {
    throw new StorageError(`習慣が見つかりません: ${String(habit_id)}`);
  }

  const existing = state.logs.find((log) => log.habit_id === habit_id && log.date === date);
  const log = createLog({ habit_id, date, rating, action, blockerTags, blockerNote, fix });
  if (existing) {
    log.id = existing.id;
    // 達成度が同じなら記録日時を据え置く。recorded_at は「その日をどう判断したか」を
    // 決めた時刻なので、あとからテキストを書き足しただけでは動かさない。
    // 達成度を付け替えたときは判断そのものが変わったので更新する。
    if (log.rating === existing.rating) log.recorded_at = existing.recorded_at;
  }
  assertValid(validateLog(log), 'ログ');

  const logs = existing
    ? state.logs.map((candidate) => (candidate.id === existing.id ? log : candidate))
    : [...state.logs, log];
  commit({ ...state, logs });
  return clone(log);
}

// 記録を消して「未記入」に戻す。× (rating 0) と未記入は別の状態なので、
// rating を付け替えるだけでは未記入には戻せない。
export async function deleteLog(habit_id, date) {
  const state = requireInit();
  const logs = state.logs.filter((log) => !(log.habit_id === habit_id && log.date === date));
  if (logs.length === state.logs.length) return false;
  commit({ ...state, logs });
  return true;
}

// 全データのコピー。エクスポートと週まとめが使う。
export async function snapshot() {
  return clone(requireInit());
}

export async function getCounts() {
  const state = requireInit();
  return { habits: state.habits.length, logs: state.logs.length };
}

// --- インポート ---------------------------------------------------------

// 書き出したファイルの中身を読み、現行スキーマに引き上げて検証する。
// v1 のファイルも受け入れる（移行処理を通すため）。保存には触れない。
export async function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new StorageError('ファイルを JSON として読めませんでした。', { cause });
  }

  const version = Number.isInteger(parsed?.schemaVersion) ? parsed.schemaVersion : 1;
  if (version > SCHEMA_VERSION) {
    throw new StorageError(
      `ファイルが新しい形式です（version ${version}）。アプリを最新にしてください。`,
    );
  }

  const db = version < SCHEMA_VERSION ? migrateDB(parsed) : parsed;
  const { ok, errors } = validateDB(db);
  if (!ok) throw new StorageError(`ファイルの内容が不正です:\n${describe(errors)}`);

  return { db, habits: db.habits.length, logs: db.logs.length };
}

// 全置換。マージはしない。
export async function replaceAll(db) {
  const state = requireInit();

  const { ok, errors } = validateDB(db);
  if (!ok) throw new StorageError(`置き換える内容が不正です:\n${describe(errors)}`);

  // 間違ったファイルを読み込んだときの戻り先。1 枠で、読み込むたびに上書きする。
  // 保存領域には上限があるので何世代も持たない。
  try {
    localStorage.setItem(`${storageKey}.backup.import`, JSON.stringify(state));
  } catch (cause) {
    throw new StorageError('置き換える前のデータを退避できませんでした。中断します。', { cause });
  }

  commit(clone(db));
  return { habits: db.habits.length, logs: db.logs.length };
}

// 検証エラーは数が多くなりうる。画面に出せる量に絞る。
function describe(errors, limit = 5) {
  if (errors.length <= limit) return errors.join('\n');
  return `${errors.slice(0, limit).join('\n')}\nほか ${errors.length - limit} 件`;
}

// --- 内部 -------------------------------------------------------------

function requireInit() {
  if (db === null) {
    throw new StorageError('init() を先に呼び、完了を待ってから使ってください。');
  }
  return db;
}

// 先に保存してからメモリを差し替える。保存に失敗したときに、メモリだけ新しい状態に
// なって localStorage と食い違うのを防ぐ。
function commit(next) {
  writeRaw(JSON.stringify(next));
  db = next;
}

function readRaw() {
  try {
    return localStorage.getItem(storageKey);
  } catch (cause) {
    throw new StorageError(
      'ローカル保存を読み出せませんでした。ブラウザの設定でサイトデータが禁止されている可能性があります。',
      { cause },
    );
  }
}

function writeRaw(serialized) {
  try {
    localStorage.setItem(storageKey, serialized);
  } catch (cause) {
    throw new StorageError(
      '保存に失敗しました。保存容量の上限に達したか、ブラウザがローカル保存を許可していません。',
      { cause },
    );
  }
}

function findHabit(state, id) {
  const habit = state.habits.find((candidate) => candidate.id === id);
  if (!habit) throw new StorageError(`習慣が見つかりません: ${String(id)}`);
  return habit;
}

function replaceHabit(habits, updated) {
  return habits.map((habit) => (habit.id === updated.id ? updated : habit));
}

function nextOrder(habits) {
  return habits.reduce((max, habit) => Math.max(max, habit.order + 1), 0);
}

function byDate(a, b) {
  return a.date.localeCompare(b.date);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 内部状態を呼び出し側から書き換えられないよう、読み出しはコピーを返す。
function clone(value) {
  return structuredClone(value);
}

function assertValid({ ok, errors }, label) {
  if (!ok) throw new StorageError(`${label}の内容が不正です:\n${errors.join('\n')}`);
}
